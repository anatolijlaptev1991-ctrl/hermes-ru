'use strict';

/**
 * hermes-ru-launcher.js — Self-healing launcher с автообновлением
 *
 * При запуске через ярлык «Hermes RU»:
 * 1. Проверяет целостность перевода (app.asar.unpacked/dist)
 * 2. Сравнивает локальную версию с последним релизом на GitHub
 * 3. Если есть новая версия — скачивает, обновляет перевод, потом запускает Hermes
 * 4. Запускает Hermes.exe
 *
 * Не убивает Hermes. Не трогает app.asar.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { spawn, execSync, execFileSync } = require('child_process');

const DATA_DIR = path.join(os.homedir(), '.hermes', 'russian-loc');
const HERMES_EXE_PATH_FILE = path.join(DATA_DIR, 'hermes-exe-path.txt');
const VERSION_FILE = path.join(DATA_DIR, 'version.json');
const GITHUB_API = 'https://api.github.com/repos/anatolijlaptev1991-ctrl/hermes-ru/releases/latest';
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const LAUNCHER_LOCK_MAX_AGE_MS = 20 * 60 * 1000;
const LAUNCHER_LOCK_FILE = path.join(DATA_DIR, 'launcher.lock');

function log(msg) { console.log(`[hermes-ru-launcher] ${msg}`); }

function getHermesHomeDir() {
  if (process.env.HERMES_HOME) return path.resolve(process.env.HERMES_HOME);
  const localHermes = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'hermes')
    : null;
  const legacyHermes = path.join(os.homedir(), '.hermes');
  for (const candidate of [localHermes, legacyHermes]) {
    if (!candidate) continue;
    if (fs.existsSync(path.join(candidate, 'config.yaml')) ||
        fs.existsSync(path.join(candidate, 'hermes-agent'))) return candidate;
  }
  return localHermes || legacyHermes;
}

function getHermesConfigPath() {
  return path.join(getHermesHomeDir(), 'config.yaml');
}

function writeTextFileSafely(targetPath, content) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp-${process.pid}`;
  const backupPath = `${targetPath}.backup-${process.pid}`;
  fs.writeFileSync(tempPath, content, 'utf8');
  try {
    try { if (fs.existsSync(backupPath)) fs.rmSync(backupPath, { force: true }); } catch {}
    if (fs.existsSync(targetPath)) fs.renameSync(targetPath, backupPath);
    fs.renameSync(tempPath, targetPath);
    try { if (fs.existsSync(backupPath)) fs.rmSync(backupPath, { force: true }); } catch {}
  } catch (error) {
    try { if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true }); } catch {}
    try {
      if (!fs.existsSync(targetPath) && fs.existsSync(backupPath)) fs.renameSync(backupPath, targetPath);
    } catch (restoreError) {
      error.message += `; восстановление config не удалось: ${restoreError.message}`;
    }
    throw error;
  }
}

function getInstalledVersion() {
  try {
    if (fs.existsSync(VERSION_FILE)) {
      const v = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
      return v.hermesRuVersion || v.version || '0.0.0';
    }
  } catch (e) { /* ignore */ }
  return '0.0.0';
}

function writeVersionFile(version) {
  fs.writeFileSync(VERSION_FILE, JSON.stringify({
    version,
    hermesRuVersion: version,
    stagedAt: new Date().toISOString(),
  }));
}

function isStalePending(pending) {
  const createdAt = Date.parse(pending && pending.createdAt);
  if (!Number.isFinite(createdAt)) return true;
  return Date.now() - createdAt > PENDING_MAX_AGE_MS || Number(pending.attempts || 0) >= 3;
}

function removePending(pendingPath, reason) {
  try { fs.unlinkSync(pendingPath); } catch {}
  log(`⚠ pending-build удалён: ${reason}`);
}

function acquireLauncherLock() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(LAUNCHER_LOCK_FILE, 'wx');
      try {
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      } finally {
        fs.closeSync(fd);
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        try { fs.rmSync(LAUNCHER_LOCK_FILE, { force: true }); } catch {}
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let stale = false;
      try {
        const lock = JSON.parse(fs.readFileSync(LAUNCHER_LOCK_FILE, 'utf8'));
        const startedAt = Date.parse(lock.startedAt);
        stale = !Number.isFinite(startedAt) || Date.now() - startedAt > LAUNCHER_LOCK_MAX_AGE_MS;
      } catch {
        stale = true;
      }
      if (!stale) return null;
      try { fs.rmSync(LAUNCHER_LOCK_FILE, { force: true }); } catch { return null; }
    }
  }
  return null;
}

function tasklistContainsHermes(output) {
  return /(?:^|\n)"?Hermes\.exe"?,/i.test(String(output || '').replaceAll(String.fromCharCode(13), ''));
}

function isHermesRunning() {
  if (process.platform !== 'win32') return false;
  try {
    const output = execFileSync('tasklist.exe', [
      '/FI', 'IMAGENAME eq Hermes.exe', '/FO', 'CSV', '/NH',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 });
    return tasklistContainsHermes(output);
  } catch {
    return false;
  }
}

function ensureConfigLanguage(language = 'ru') {
  const configPath = getHermesConfigPath();
  const content = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const crlf = String.fromCharCode(13, 10);
  const lf = String.fromCharCode(10);
  const eol = content.includes(crlf) ? crlf : lf;
  let lines = content.replaceAll(String.fromCharCode(13), '').split(lf);

  // Обрабатываем inline flow-map display: если language уже есть — обновляем на месте,
  // иначе нормализуем в блок для безопасного добавления (без дублирования top-level display).
  const inlineDisplay = lines.findIndex((line) => /^display:\s*\{.*\}\s*(?:#.*)?$/.test(line));
  if (inlineDisplay >= 0) {
    const match = lines[inlineDisplay].match(/^display:\s*\{(.*)\}\s*(?:#.*)?$/);
    const inner = (match ? match[1] : '').trim();
    if (/\blanguage:\s*[\w-]+/.test(inner)) {
      // language уже есть в inline-блоке — заменяем на месте, сохраняя flow-map формат
      const newInner = inner.replace(/\blanguage:\s*[\w-]+/, `language: ${language}`);
      lines[inlineDisplay] = `display: { ${newInner.trim()} }`;
      writeTextFileSafely(configPath, lines.join(eol));
      log(`✓ Язык ${language} установлен: ${configPath}`);
      return;
    }
    // language отсутствует — нормализуем в блок для безопасного добавления
    const entries = [];
    for (const item of inner.split(',')) {
      const pair = item.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/);
      if (pair) entries.push(`  ${pair[1]}: ${pair[2]}`);
    }
    entries.unshift(`  language: ${language}`);
    lines.splice(inlineDisplay, 1, 'display:', ...entries);
  }

  const displayIndex = lines.findIndex((line) => /^display:\s*(?:#.*)?$/.test(line));

  if (displayIndex >= 0) {
    let end = lines.length;
    for (let i = displayIndex + 1; i < lines.length; i++) {
      if (/^[^\s#][^:]*:\s*/.test(lines[i])) { end = i; break; }
    }
    const languageIndex = lines.findIndex((line, i) =>
      i > displayIndex && i < end && /^\s+language:\s*/.test(line));
    if (languageIndex >= 0) {
      const indent = lines[languageIndex].match(/^\s*/)[0] || '  ';
      lines[languageIndex] = `${indent}language: ${language}`;
    } else {
      lines.splice(displayIndex + 1, 0, `  language: ${language}`);
    }
  } else {
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines.push('display:', `  language: ${language}`, '');
  }

  writeTextFileSafely(configPath, lines.join(eol));
  log(`✓ Язык ${language} установлен: ${configPath}`);
}


function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'hermes-ru-launcher', 'Accept': 'application/vnd.github.v3+json' },
      timeout: 10000,
    }, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const req = https.get(url, {
      headers: { 'User-Agent': 'hermes-ru-launcher' },
      timeout: 60000,
    }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        file.close();
        fs.unlinkSync(destPath);
        downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    });
    req.on('error', (e) => { try { fs.unlinkSync(destPath); } catch {} reject(e); });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function findHermesResources() {
  if (fs.existsSync(HERMES_EXE_PATH_FILE)) {
    const savedExe = fs.readFileSync(HERMES_EXE_PATH_FILE, 'utf8').trim();
    if (savedExe) {
      const dir = path.join(path.dirname(savedExe), 'resources');
      if (fs.existsSync(path.join(dir, 'app.asar'))) return dir;
    }
  }
  const home = os.homedir();
  const candidates = [
    path.join(home, 'AppData', 'Local', 'hermes', 'hermes-agent', 'apps', 'desktop', 'release', 'win-unpacked', 'resources'),
    path.join(home, 'AppData', 'Local', 'Programs', 'Hermes', 'resources'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'app.asar'))) return c;
  }
  return null;
}

function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}

function replaceDirAtomically(sourceDir, targetDir) {
  const stagingDir = `${targetDir}.staging-${process.pid}`;
  const backupDir = `${targetDir}.backup-${process.pid}`;
  let originalMoved = false;
  let committed = false;
  try {
    if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true });
    if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
    copyDirSync(sourceDir, stagingDir);
    if (fs.existsSync(targetDir)) {
      fs.renameSync(targetDir, backupDir);
      originalMoved = true;
    }
    fs.renameSync(stagingDir, targetDir);
    committed = true;
  } catch (error) {
    try { if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true }); } catch {}
    if (!committed && originalMoved) {
      try {
        if (!fs.existsSync(targetDir) && fs.existsSync(backupDir)) fs.renameSync(backupDir, targetDir);
      } catch (restoreError) {
        error.message += `; rollback failed: ${restoreError.message}`;
      }
    }
    throw error;
  } finally {
    if (committed) {
      try { if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true }); }
      catch (cleanupError) { log(`⚠ Не удалось удалить резервную копию dist: ${cleanupError.message}`); }
    }
  }
}

function findElectronPackageDir(desktopDir) {
  let current = path.resolve(desktopDir);
  let fallback = null;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(current, 'node_modules', 'electron');
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      if (fs.existsSync(path.join(candidate, 'dist', 'electron.exe'))) return candidate;
      if (!fallback) fallback = candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return fallback;
}

function ensureElectronBinary(desktopDir) {
  const electronDir = findElectronPackageDir(desktopDir);
  if (!electronDir) {
    log('⚠ Пакет Electron не найден ни в apps/desktop, ни в родительских node_modules.');
    return false;
  }
  const electronExe = path.join(electronDir, 'dist', 'electron.exe');
  if (fs.existsSync(electronExe)) return true;
  const installer = path.join(electronDir, 'install.js');
  if (!fs.existsSync(installer)) {
    log(`⚠ В пакете Electron отсутствует installer: ${installer}`);
    return false;
  }
  log(`⚠ electron.exe не найден. Запускаю installer из ${electronDir}...`);
  try {
    execFileSync(process.execPath, [installer], { cwd: desktopDir, stdio: 'inherit', timeout: 600000 });
  } catch (error) {
    log(`⚠ Не удалось скачать electron.exe: ${error.message}`);
    return false;
  }
  return fs.existsSync(electronExe);
}

function distLooksHealthy(distDir) {
  const indexPath = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexPath)) return false;
  let html;
  try { html = fs.readFileSync(indexPath, 'utf8'); } catch { return false; }
  const references = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => match[1].split(/[?#]/)[0])
    .filter((ref) => ref && !ref.startsWith('#') && !/^(?:[a-z]+:)?\/\//i.test(ref) && !ref.startsWith('data:'));
  return references.length > 0 && references.every((ref) =>
    fs.existsSync(path.join(distDir, ref.replace(/^[/\\]+/, ''))));
}

function collectTextFiles(rootDir) {
  const files = [];
  if (!fs.existsSync(rootDir)) return files;
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const filePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) files.push(...collectTextFiles(filePath));
    else if (/\.(?:js|css|html|json)$/i.test(entry.name)) files.push(filePath);
  }
  return files;
}

function distContainsRussianLocale(distDir) {
  const sentinels = ['Русский', 'Применить'];
  const content = collectTextFiles(distDir).map((filePath) => {
    try { return fs.readFileSync(filePath, 'utf8'); } catch { return ''; }
  }).join('\n');
  return sentinels.every((sentinel) => content.includes(sentinel));
}

function runtimeDistLooksHealthy(resourcesDir) {
  return distLooksHealthy(path.join(resourcesDir, 'app.asar.unpacked', 'dist'));
}

function runtimeDistContainsRussian(resourcesDir) {
  const runtimeDist = path.join(resourcesDir, 'app.asar.unpacked', 'dist');
  return distLooksHealthy(runtimeDist) && distContainsRussianLocale(runtimeDist);
}

function sourcesLookPatched(desktopDir) {
  const srcDir = path.join(desktopDir, 'src', 'i18n');
  const typesPath = path.join(srcDir, 'types.ts');
  const catalogPath = path.join(srcDir, 'catalog.ts');
  const languagesPath = path.join(srcDir, 'languages.ts');
  const ruPath = path.join(srcDir, 'ru.ts');
  if (![typesPath, catalogPath, languagesPath, ruPath].every((filePath) => fs.existsSync(filePath))) return false;
  const types = fs.readFileSync(typesPath, 'utf8');
  const catalog = fs.readFileSync(catalogPath, 'utf8');
  const languages = fs.readFileSync(languagesPath, 'utf8');
  return types.includes("'ru'") &&
    /from\s*'\.\/ru'/.test(catalog) &&
    /\bru\b/.test(catalog) &&
    /id:\s*'ru'/.test(languages);
}

function snapshotSourceFiles(desktopDir) {
  const srcDir = path.join(desktopDir, 'src', 'i18n');
  const snapshot = new Map();
  for (const fileName of ['types.ts', 'catalog.ts', 'languages.ts', 'ru.ts']) {
    const filePath = path.join(srcDir, fileName);
    snapshot.set(filePath, fs.existsSync(filePath) ? fs.readFileSync(filePath) : null);
  }
  return snapshot;
}

function restoreSourceFiles(snapshot) {
  for (const [filePath, content] of snapshot) {
    if (content === null) {
      try { if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true }); } catch {}
    } else {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content);
    }
  }
}

function validateBuildEnvironment(desktopDir, { uninstall = false } = {}) {
  const nodeModulesPath = path.join(desktopDir, 'node_modules');
  if (!fs.existsSync(nodeModulesPath)) throw new Error('node_modules не найден');
  const packagePath = path.join(desktopDir, 'package.json');
  if (!fs.existsSync(packagePath)) throw new Error('apps/desktop/package.json не найден');
  let packageJson;
  try { packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8')); }
  catch (error) { throw new Error(`package.json повреждён: ${error.message}`); }
  if (!packageJson.scripts || typeof packageJson.scripts.build !== 'string' || !packageJson.scripts.build.trim()) {
    throw new Error('В apps/desktop/package.json отсутствует scripts.build');
  }
  const srcDir = path.join(desktopDir, 'src', 'i18n');
  if (!fs.existsSync(srcDir)) throw new Error('Исходники src/i18n не найдены');
  for (const fileName of ['types.ts', 'catalog.ts', 'languages.ts']) {
    if (!fs.existsSync(path.join(srcDir, fileName))) throw new Error(`Не найден src/i18n/${fileName}`);
  }
  if (!uninstall &&
      !fs.existsSync(path.join(DATA_DIR, 'ru.ts')) &&
      !fs.existsSync(path.join(srcDir, 'ru.ts'))) {
    throw new Error('ru.ts не найден ни в хранилище, ни в исходниках Hermes');
  }
  if (!ensureElectronBinary(desktopDir)) throw new Error('Electron runtime недоступен');
}

function validateBuiltDist(builtDist, { requireRussian = true } = {}) {
  if (!distLooksHealthy(builtDist)) throw new Error('Собранный dist неполон: ссылки index.html не разрешаются');
  if (requireRussian && !distContainsRussianLocale(builtDist)) {
    throw new Error('Собранный dist не содержит подтверждённых русских строк');
  }
}

function getNpmCommand() {
  const sibling = path.join(path.dirname(process.execPath), process.platform === 'win32' ? 'npm.cmd' : 'npm');
  return fs.existsSync(sibling) ? sibling : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
}

function runDesktopBuild(desktopDir) {
  execFileSync(getNpmCommand(), ['run', 'build'], { cwd: desktopDir, stdio: 'inherit', timeout: 600000 });
}

function shouldRepairStandardShortcut(shortcutName, targetPath, argumentsText, launcherPath) {
  if (String(shortcutName).toLowerCase() !== 'hermes.lnk') return false;
  const target = path.basename(String(targetPath || '')).toLowerCase();
  if (target !== 'node.exe' && target !== 'node') return false;
  const args = String(argumentsText || '').toLowerCase().replace(/[\\/]+/g, '\\\\');
  const launcherName = path.basename(String(launcherPath || '')).toLowerCase();
  return Boolean(launcherName && args.includes(launcherName));
}

function psSingleQuote(value) {
  return String(value).replace(/'/g, "''");
}

function inspectWindowsShortcut(shortcutPath) {
  if (!fs.existsSync(shortcutPath)) return null;
  const scriptPath = path.join(os.tmpdir(), `проверка-ярлыка-hermes-${process.pid}-${Date.now()}.ps1`);
  const script = [
    '$ws = New-Object -ComObject WScript.Shell',
    `$sc = $ws.CreateShortcut('${psSingleQuote(shortcutPath)}')`,
    "[PSCustomObject]@{ targetPath = $sc.TargetPath; arguments = $sc.Arguments } | ConvertTo-Json -Compress",
  ].join('\n');
  fs.writeFileSync(scriptPath, script, 'utf8');
  try {
    const output = execFileSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 });
    return JSON.parse(String(output).trim());
  } finally {
    try { fs.rmSync(scriptPath, { force: true }); } catch {}
  }
}

function rewriteWindowsShortcut(shortcutPath, hermesExe) {
  fs.mkdirSync(path.dirname(shortcutPath), { recursive: true });
  const scriptPath = path.join(os.tmpdir(), `восстановление-ярлыка-hermes-${process.pid}-${Date.now()}.ps1`);
  const workingDir = path.dirname(hermesExe);
  const script = [
    '$ws = New-Object -ComObject WScript.Shell',
    `$sc = $ws.CreateShortcut('${psSingleQuote(shortcutPath)}')`,
    `$sc.TargetPath = '${psSingleQuote(hermesExe)}'`,
    "$sc.Arguments = ''",
    `$sc.WorkingDirectory = '${psSingleQuote(workingDir)}'`,
    `$sc.IconLocation = '${psSingleQuote(hermesExe)},0'`,
    "$sc.Description = 'Hermes Agent Desktop'",
    '$sc.Save()',
  ].join('\n');
  fs.writeFileSync(scriptPath, script, 'utf8');
  try {
    execFileSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
    ], { stdio: 'ignore', timeout: 30000 });
  } finally {
    try { fs.rmSync(scriptPath, { force: true }); } catch {}
  }
}

function repairHijackedStandardShortcuts(resourcesDir, options = {}) {
  const hermesExe = path.join(path.dirname(resourcesDir), 'Hermes.exe');
  if (!fs.existsSync(hermesExe)) return 0;
  const launcherPath = path.join(DATA_DIR, 'hermes-ru-launcher.js');
  const shortcutPaths = options.shortcutPaths || [
    path.join(os.homedir(), 'Desktop', 'Hermes.lnk'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Hermes.lnk'),
  ];
  const inspectShortcut = options.inspectShortcut || inspectWindowsShortcut;
  const rewriteShortcut = options.rewriteShortcut || rewriteWindowsShortcut;
  let repaired = 0;
  for (const shortcutPath of shortcutPaths) {
    try {
      const info = inspectShortcut(shortcutPath);
      if (!info) continue;
      const shortcutName = info.name || path.basename(shortcutPath);
      if (!shouldRepairStandardShortcut(shortcutName, info.targetPath, info.arguments, launcherPath)) continue;
      rewriteShortcut(shortcutPath, hermesExe);
      repaired += 1;
      log(`✓ Восстановлен стандартный ярлык: ${shortcutPath}`);
    } catch (error) {
      log(`⚠ Не удалось проверить стандартный ярлык ${shortcutPath}: ${error.message}`);
    }
  }
  return repaired;
}

function removeRussianLocaleFromSources(desktopDir) {
  const srcDir = path.join(desktopDir, 'src', 'i18n');
  if (!fs.existsSync(srcDir)) return;
  const ruFile = path.join(srcDir, 'ru.ts');
  if (fs.existsSync(ruFile)) fs.unlinkSync(ruFile);
  for (const fileName of ['types.ts', 'catalog.ts', 'languages.ts']) {
    const filePath = path.join(srcDir, fileName);
    if (!fs.existsSync(filePath)) continue;
    let content = fs.readFileSync(filePath, 'utf8');
    content = content.replace(/\s*\|\s*'ru'/, '');
    content = content.replace(/\r?\nimport \{ ru \} from '\.\/ru'/, '');
    content = content.replace(/,\r?\n\s*ru\r?\n}/, '\n}');
    content = content.replace(/,\s*\{\s*id:\s*'ru'[\s\S]*?\}\s*\]/, '\n]');
    content = content.replace(/,\r?\n\s*ru:\s*'ru'[\s\S]*?ru_ru:\s*'ru'/, '');
    fs.writeFileSync(filePath, content, 'utf8');
  }
}

function needsPatch(resourcesDir) {
  const markerPath = path.join(resourcesDir, '.hermes-ru-patched');
  if (!fs.existsSync(markerPath)) return true;
  if (!runtimeDistContainsRussian(resourcesDir)) return true;
  const desktopDir = path.resolve(resourcesDir, '..', '..', '..');
  if (!sourcesLookPatched(desktopDir)) return true;
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    const installedVersion = getInstalledVersion();
    if (installedVersion !== '0.0.0' && marker.version && compareVersions(installedVersion, marker.version) > 0) return true;
  } catch {
    return true;
  }
  return false;
}

// Launcher вызывается ДО запуска Hermes. Если есть pending-build — делаем npm run build
function applyTranslationInPlace(resourcesDir) {
  const dataDir = DATA_DIR;
  const pendingPath = path.join(dataDir, 'pending-build.json');

  // 1. Если есть pending-build — запускаем npm run build (Hermes ещё не запущен)
  if (fs.existsSync(pendingPath)) {
    let pending;
    try {
      pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
    } catch {
      removePending(pendingPath, 'pending-build.json повреждён');
      return applyTranslationInPlace(resourcesDir);
    }
    if (isStalePending(pending)) {
      removePending(pendingPath, 'устарел или исчерпал лимит попыток');
      return applyTranslationInPlace(resourcesDir);
    }
    const expectedDesktopDir = path.resolve(resourcesDir, '..', '..', '..');
    const desktopDir = path.resolve(pending.desktopDir || expectedDesktopDir);
    if (desktopDir.toLowerCase() !== expectedDesktopDir.toLowerCase()) {
      removePending(pendingPath, 'desktopDir не соответствует текущей установке Hermes');
      return false;
    }

    const isUninstall = pending.version === 'uninstall';
    log(`Найден pending-build (v${pending.version}). Проверяю окружение...`);
    try {
      validateBuildEnvironment(desktopDir, { uninstall: isUninstall });
    } catch (error) {
      log(`⚠ Preflight сборки не пройден: ${error.message}`);
      return 'failed';
    }

    const sourceSnapshot = snapshotSourceFiles(desktopDir);
    // ПАТЧИМ ИСХОДНИКИ только после полного preflight.
    const srcDir = path.join(desktopDir, 'src', 'i18n');
    if (isUninstall && fs.existsSync(srcDir)) {
      log('Удаляю регистрацию ru перед English build (uninstall)...');
      removeRussianLocaleFromSources(desktopDir);
    }
    if (!isUninstall && fs.existsSync(srcDir)) {
      log('Патчу исходники i18n...');
      // Копируем ru.ts
      const persRu = path.join(DATA_DIR, 'ru.ts');
      if (fs.existsSync(persRu)) {
        fs.copyFileSync(persRu, path.join(srcDir, 'ru.ts'));
      }
      // types.ts
      const typesPath = path.join(srcDir, 'types.ts');
      if (fs.existsSync(typesPath)) {
        let tc = fs.readFileSync(typesPath, 'utf8');
        if (!tc.includes("'ru'")) {
          tc = tc.replace(/export type Locale = 'en' \| 'zh' \| 'zh-hant' \| 'ja'/, "export type Locale = 'en' | 'zh' | 'zh-hant' | 'ja' | 'ru'");
          fs.writeFileSync(typesPath, tc, 'utf8');
        }
      }
      // catalog.ts
      const catPath = path.join(srcDir, 'catalog.ts');
      if (fs.existsSync(catPath)) {
        let cc = fs.readFileSync(catPath, 'utf8');
        if (!/from\s*'\.\/ru'/.test(cc)) {
          cc = cc.replace("import { ja } from './ja'", "import { ja } from './ja'\nimport { ru } from './ru'");
        }
        if (!/,\s*ru[\r\n]/.test(cc)) {
          cc = cc.replace(/export const TRANSLATIONS.*?\{[\s\S]*?ja,?[\r\n]\s*(?:ru[\r\n])?\}/, "export const TRANSLATIONS: Record<Locale, Translations> = {\n  en,\n  zh,\n  'zh-hant': zhHant,\n  ja,\n  ru\n}");
        }
        fs.writeFileSync(catPath, cc, 'utf8');
      }
      // languages.ts
      const langPath = path.join(srcDir, 'languages.ts');
      if (fs.existsSync(langPath)) {
        let lc = fs.readFileSync(langPath, 'utf8');
        if (!/'ru'/.test(lc)) {
          lc = lc.replace(/(\{[^}]*id:\s*'ja'[^}]*\})\s*\]/, "$1,\n  {\n    id: 'ru',\n    name: 'Русский',\n    englishName: 'Russian',\n    configValue: 'ru'\n  }\n]");
          lc = lc.replace(/(ja_jp:\s*'ja')/, "$1,\n  ru: 'ru',\n  'ru-ru': 'ru',\n  ru_ru: 'ru'");
          fs.writeFileSync(langPath, lc, 'utf8');
        }
      }
      log('✓ Исходники пропатчены');
    }

    log('Запускаю npm run build (может занять несколько минут)...');
    const runtimeDistForBackup = path.join(resourcesDir, 'app.asar.unpacked', 'dist');
    const distBackupPath = path.join(os.tmpdir(), `hermes-ru-dist-backup-${process.pid}`);
    let hasDistBackup = false;
    let runtimeCommitted = false;
    if (fs.existsSync(runtimeDistForBackup)) {
      if (fs.existsSync(distBackupPath)) fs.rmSync(distBackupPath, { recursive: true, force: true });
      copyDirSync(runtimeDistForBackup, distBackupPath);
      hasDistBackup = true;
    }
    try {
      runDesktopBuild(desktopDir);
      log('✓ Build завершён.');

      // Проверяем сборку ДО замены рабочего runtime.
      const builtDist = path.join(desktopDir, 'dist');
      validateBuiltDist(builtDist, { requireRussian: !isUninstall });
      const runtimeDist = path.join(resourcesDir, 'app.asar.unpacked', 'dist');
      if (fs.existsSync(path.join(resourcesDir, 'app.asar.unpacked'))) {
        log('Копирую проверенный dist/ в runtime атомарно...');
        replaceDirAtomically(builtDist, runtimeDist);
        runtimeCommitted = true;
        log('✓ dist/ атомарно опубликован в app.asar.unpacked.');
      } else {
        throw new Error('app.asar.unpacked отсутствует');
      }

      // Создаём marker (или удаляем если uninstall)
      if (pending.version === 'uninstall') {
        // Удаляем ярлыки только после успешного English build и runtime commit.
        const lnkDesktop = path.join(os.homedir(), 'Desktop', 'Hermes RU.lnk');
        if (fs.existsSync(lnkDesktop)) fs.unlinkSync(lnkDesktop);
        const lnkMenu = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Hermes RU');
        if (fs.existsSync(lnkMenu)) fs.rmSync(lnkMenu, { recursive: true, force: true });
        const marker = path.join(resourcesDir, '.hermes-ru-patched');
        if (fs.existsSync(marker)) fs.rmSync(marker, { force: true });
        try { ensureConfigLanguage('en'); }
        catch (e) { log('⚠ Не удалось установить English в config.yaml: ' + e.message); }
        log('✓ Английский интерфейс восстановлен.');
      } else {
        fs.writeFileSync(path.join(resourcesDir, '.hermes-ru-patched'), JSON.stringify({
          version: pending.version, patchedAt: new Date().toISOString(), method: 'defineLocale+build',
        }));
        log('✓ Русская локализация применена.');
        // Устанавливаем язык ru в config.yaml
        try { ensureConfigLanguage(); }
        catch (e) { log('⚠ Не удалось установить язык в config.yaml: ' + e.message); }
      }
      fs.unlinkSync(pendingPath);
      if (hasDistBackup && fs.existsSync(distBackupPath)) fs.rmSync(distBackupPath, { recursive: true, force: true });
      return 'applied';
    } catch (e) {
      log(`⚠ Build не удался: ${e.message}`);
      if (!runtimeCommitted) {
        restoreSourceFiles(sourceSnapshot);
        log('✓ Исходники i18n восстановлены после сбоя.');
      }
      if (hasDistBackup && fs.existsSync(distBackupPath)) {
        try {
          replaceDirAtomically(distBackupPath, runtimeDistForBackup);
          log('✓ Предыдущий runtime dist восстановлен после сбоя сборки.');
        } catch (restoreError) {
          log(`✗ Не удалось восстановить runtime dist: ${restoreError.message}`);
        }
        try { fs.rmSync(distBackupPath, { recursive: true, force: true }); } catch {}
      }
      // Увеличиваем счётчик попыток
      const attempts = (pending.attempts || 0) + 1;
      if (attempts >= 3) {
        log(`⚠ Превышен лимит попыток (${attempts}). Удаляю pending-build.`);
        fs.unlinkSync(pendingPath);
      } else {
        pending.attempts = attempts;
        fs.writeFileSync(pendingPath, JSON.stringify(pending));
        log(`  Попытка ${attempts}/3. Попробуйте ещё раз через ярлык.`);
      }
    }
    return 'failed';
  }

  // 2. Self-healing: проверяем не только исходники и marker, но и фактический runtime.
  const desktopDir = path.resolve(resourcesDir, '..', '..', '..');
  const markerPath = path.join(resourcesDir, '.hermes-ru-patched');
  const patchedSources = sourcesLookPatched(desktopDir);
  const russianRuntime = runtimeDistContainsRussian(resourcesDir);

  if (patchedSources && russianRuntime) {
    if (!fs.existsSync(markerPath)) {
      fs.writeFileSync(markerPath, JSON.stringify({
        version: getInstalledVersion(), patchedAt: new Date().toISOString(), method: 'defineLocale+build',
      }));
      log('✓ Marker восстановлен без лишней пересборки.');
    }
    ensureConfigLanguage();
    return 'ok';
  }

  log('Русская локализация отсутствует в исходниках или runtime — запускаю безопасный self-heal...');
  try {
    validateBuildEnvironment(desktopDir, { uninstall: false });
  } catch (error) {
    log(`⚠ Self-heal preflight не пройден: ${error.message}`);
    return 'failed';
  }

  const sourceSnapshot = snapshotSourceFiles(desktopDir);
  let runtimeCommitted = false;
  try {
    const srcDir = path.join(desktopDir, 'src', 'i18n');
    const ruSource = path.join(dataDir, 'ru.ts');
    const targetRu = path.join(srcDir, 'ru.ts');
    if (fs.existsSync(ruSource)) fs.copyFileSync(ruSource, targetRu);
    if (!fs.existsSync(targetRu)) throw new Error('ru.ts недоступен для self-heal');

    const typesPath = path.join(srcDir, 'types.ts');
    let types = fs.readFileSync(typesPath, 'utf8');
    if (!types.includes("'ru'")) {
      types = types.replace(
        /export type Locale = 'en' \| 'zh' \| 'zh-hant' \| 'ja'/,
        "export type Locale = 'en' | 'zh' | 'zh-hant' | 'ja' | 'ru'"
      );
      fs.writeFileSync(typesPath, types, 'utf8');
    }

    const catalogPath = path.join(srcDir, 'catalog.ts');
    let catalog = fs.readFileSync(catalogPath, 'utf8');
    if (!/from\s*'\.\/ru'/.test(catalog)) {
      catalog = catalog.replace("import { ja } from './ja'", "import { ja } from './ja'\nimport { ru } from './ru'");
    }
    const normalizedCatalog = catalog.replaceAll(String.fromCharCode(13), '');
    if (!/(?:^|[,\s])ru\s*(?:,|\n|})/m.test(normalizedCatalog)) {
      catalog = catalog.replace(/(\bja),?(\s*})/, '$1,\n  ru$2');
    }
    fs.writeFileSync(catalogPath, catalog, 'utf8');

    const languagesPath = path.join(srcDir, 'languages.ts');
    let languages = fs.readFileSync(languagesPath, 'utf8');
    if (!/id:\s*'ru'/.test(languages)) {
      languages = languages.replace(
        /(\{[^}]*id:\s*'ja'[^}]*\})\s*\]/,
        "$1,\n  {\n    id: 'ru',\n    name: 'Русский',\n    englishName: 'Russian',\n    configValue: 'ru'\n  }\n]"
      );
    }
    if (!/\bru:\s*'ru'/.test(languages)) {
      languages = languages.replace(
        /(ja_jp:\s*'ja')/,
        "$1,\n  ru: 'ru',\n  'ru-ru': 'ru',\n  ru_ru: 'ru'"
      );
    }
    fs.writeFileSync(languagesPath, languages, 'utf8');

    if (!sourcesLookPatched(desktopDir)) throw new Error('Не удалось зарегистрировать ru во всех i18n-файлах');

    runDesktopBuild(desktopDir);
    const builtDist = path.join(desktopDir, 'dist');
    validateBuiltDist(builtDist, { requireRussian: true });
    const unpackedDir = path.join(resourcesDir, 'app.asar.unpacked');
    if (!fs.existsSync(unpackedDir)) throw new Error('app.asar.unpacked отсутствует');
    replaceDirAtomically(builtDist, path.join(unpackedDir, 'dist'));
    runtimeCommitted = true;

    fs.writeFileSync(markerPath, JSON.stringify({
      version: getInstalledVersion(), patchedAt: new Date().toISOString(), method: 'defineLocale+build',
    }));
    ensureConfigLanguage();
    log('✓ Перевод восстановлен и подтверждён в runtime.');
    return 'applied';
  } catch (error) {
    if (!runtimeCommitted) restoreSourceFiles(sourceSnapshot);
    log(`⚠ Self-heal не удался: ${error.message}`);
    return 'failed';
  }
}
async function checkAndUpdate(resourcesDir) {
  const currentVersion = getInstalledVersion();
  log(`Текущая версия: ${currentVersion}`);

  // 1. Проверяем npm версию пакета
  let npmVersion = null;
  try {
    npmVersion = execSync('npm view @anatolijlaptev1991/hermes-ru version', {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000,
    }).trim();
  } catch {}

  if (npmVersion && compareVersions(npmVersion, currentVersion) > 0) {
    log(`Найдена новая версия npm пакета: ${npmVersion} (текущая: ${currentVersion})`);
    log('Обновляю npm пакет...');
    try {
      execSync('npm install -g @anatolijlaptev1991/hermes-ru@' + npmVersion, {
        stdio: 'inherit', timeout: 120000,
      });
      log('✓ npm пакет обновлён до v' + npmVersion);
      // Обновляем ru.ts в персистентном хранилище из нового пакета
      try {
        const npmRuPath = execSync('node -e "console.log(require.resolve(\'@anatolijlaptev1991/hermes-ru/src/i18n/ru.ts\'))"', {
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000,
        }).trim();
        // node require.resolve не работает с .ts — пробуем найти через require.resolve пути
      } catch {}
      // Ищем ru.ts через npm root -g
      try {
        const npmGlobalRoot = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        const npmRuTs = path.join(npmGlobalRoot, '@anatolijlaptev1991', 'hermes-ru', 'src', 'i18n', 'ru.ts');
        if (fs.existsSync(npmRuTs)) {
          fs.copyFileSync(npmRuTs, path.join(DATA_DIR, 'ru.ts'));
          log('✓ ru.ts обновлён из нового пакета');
        }
        // Также обновляем launcher
        const npmLauncher = path.join(npmGlobalRoot, '@anatolijlaptev1991', 'hermes-ru', 'launcher', 'hermes-ru-launcher.js');
        if (fs.existsSync(npmLauncher)) {
          fs.copyFileSync(npmLauncher, path.join(DATA_DIR, 'hermes-ru-launcher.js'));
          log('✓ launcher обновлён из нового пакета');
        }
      } catch {}
      // Создаём pending-build для применения нового перевода
      const desktopDir = path.join(resourcesDir, '..', '..', '..');
      fs.writeFileSync(path.join(DATA_DIR, 'pending-build.json'), JSON.stringify({
        desktopDir, version: npmVersion, createdAt: new Date().toISOString(),
      }));
      const applyResult = applyTranslationInPlace(resourcesDir);
      if (applyResult !== 'applied') {
        log('⚠ Обновление npm не применено; сохраняю рабочий runtime.');
        return;
      }
      writeVersionFile(npmVersion);
    } catch (e) {
      log('⚠ Не удалось обновить npm пакет: ' + e.message);
    }
    return;
  }

  // 2. Проверяем GitHub релиз (для не-npm обновлений)
  let release;
  try {
    release = await fetchJSON(GITHUB_API);
  } catch (e) {
    log(`Не удалось проверить обновление (${e.message}). Пропускаем.`);
    return;
  }

  const latestVersion = (release.tag_name || '').replace(/^v/, '');
  if (!latestVersion) {
    log('Не удалось определить версию релиза. Пропускаем.');
    return;
  }

  if (compareVersions(latestVersion, currentVersion) <= 0) {
    log(`Актуальная версия ${currentVersion}. Обновление не требуется.`);
    return;
  }

  log(`Найдена новая версия: ${latestVersion} (текущая: ${currentVersion})`);

  // Ищем zip-ассет
  const asset = (release.assets || []).find(a => /\.zip$/i.test(a.name));
  if (!asset) {
    log('ZIP-архив не найден в релизе. Пропускаем обновление.');
    return;
  }

  log(`Скачиваю ${asset.name} (${Math.round(asset.size / 1024 / 1024)} МБ)...`);
  const tmpZip = path.join(os.tmpdir(), 'hermes-ru-update.zip');
  try {
    await downloadFile(asset.browser_download_url, tmpZip);
  } catch (e) {
    log(`Ошибка скачивания: ${e.message}. Пропускаем.`);
    return;
  }

  // Распаковываем zip во временную папку
  const tmpExtract = path.join(os.tmpdir(), 'hermes-ru-update-extracted');
  if (fs.existsSync(tmpExtract)) fs.rmSync(tmpExtract, { recursive: true, force: true });
  try {
    execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${tmpZip}' -DestinationPath '${tmpExtract}' -Force"`, { stdio: 'ignore' });
  } catch (e) {
    log(`Ошибка распаковки: ${e.message}. Пропускаем.`);
    try { fs.unlinkSync(tmpZip); } catch {}
    return;
  }
  try { fs.unlinkSync(tmpZip); } catch {}

  // Находим ru.ts в распакованном архиве (GitHub releases содержат dist/, но нам нужен src/)
  // или используем dist/ если есть
  const extractedRuTs = path.join(tmpExtract, 'src', 'i18n', 'ru.ts');

  // Обновляем персистентное хранилище ru.ts
  if (fs.existsSync(extractedRuTs)) {
    const persRuTs = path.join(DATA_DIR, 'ru.ts');
    fs.copyFileSync(extractedRuTs, persRuTs);
    log('✓ ru.ts обновлён из релиза');
  }

  if (!fs.existsSync(extractedRuTs)) {
    log('⚠ В архиве нет src/i18n/ru.ts — перевод не обновлён.');
  }

  // Применяем перевод: копируем новый ru.ts в исходники, запускаем build
  const srcDir = path.join(resourcesDir, '..', '..', '..', 'src', 'i18n');
  const targetRu = path.join(srcDir, 'ru.ts');
  if (fs.existsSync(extractedRuTs) && fs.existsSync(path.join(DATA_DIR, 'ru.ts')) && fs.existsSync(srcDir)) {
    fs.copyFileSync(path.join(DATA_DIR, 'ru.ts'), targetRu);
    log('✓ Новый ru.ts скопирован в исходники');
    // Создаём pending-build для принудительной сборки
    const desktopDir = path.join(resourcesDir, '..', '..', '..');
    fs.writeFileSync(path.join(DATA_DIR, 'pending-build.json'), JSON.stringify({
      desktopDir, version: latestVersion, createdAt: new Date().toISOString(),
    }));
  } else {
    log('⚠ ru.ts не найден — сборка не запущена.');
    fs.rmSync(tmpExtract, { recursive: true, force: true });
    return;
  }
  const applyResult = applyTranslationInPlace(resourcesDir);
  if (applyResult !== 'applied') {
    log('⚠ Обновление релиза не применено; сохраняю рабочий runtime.');
    fs.rmSync(tmpExtract, { recursive: true, force: true });
    return;
  }

  // Чистим
  fs.rmSync(tmpExtract, { recursive: true, force: true });
  log(`✓ Обновлено до версии ${latestVersion}!`);
  // Записываем версию только после успешного обновления
  writeVersionFile(latestVersion);
}


function launchHermes(resourcesDir) {
  let hermesExe = fs.existsSync(HERMES_EXE_PATH_FILE)
    ? fs.readFileSync(HERMES_EXE_PATH_FILE, 'utf8').trim()
    : null;
  if (!hermesExe || !fs.existsSync(hermesExe)) {
    hermesExe = path.join(path.dirname(resourcesDir), 'Hermes.exe');
  }
  if (!fs.existsSync(hermesExe)) {
    log(`⚠ Hermes.exe не найден: ${hermesExe}`);
    process.exit(1);
  }
  log(`Запуск Hermes: ${hermesExe}`);
  const child = spawn(hermesExe, [], { detached: true, stdio: 'ignore' });
  child.unref();
  process.exit(0);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('hermes-ru-launcher — Self-healing launcher');
  console.log('Запускается автоматически через ярлык «Hermes RU».');
  console.log('Не запускайте вручную (если не для диагностики).');
  process.exit(0);
}

(async function main() {
  const resourcesDir = findHermesResources();
  if (!resourcesDir) {
    log('⚠ Hermes Desktop не найден. Запуск невозможен.');
    process.exit(1);
  }

  try {
    repairHijackedStandardShortcuts(resourcesDir);
  } catch (error) {
    log(`⚠ Проверка стандартных ярлыков пропущена: ${error.message}`);
  }

  const pendingBuildPath = path.join(DATA_DIR, 'pending-build.json');
  const patchRequired = fs.existsSync(pendingBuildPath) || needsPatch(resourcesDir);
  if (isHermesRunning()) {
    if (patchRequired) {
      log('✗ Hermes уже запущен. Закройте все окна Hermes и повторно откройте ярлык «Hermes RU» — сборка поверх работающего приложения запрещена.');
      process.exit(2);
    }
    log('Hermes уже запущен — второй экземпляр не создаётся.');
    process.exit(0);
  }

  const releaseLock = acquireLauncherLock();
  if (!releaseLock) {
    log('Другой экземпляр launcher уже выполняет проверку или сборку. Повторный запуск остановлен.');
    process.exit(0);
  }

  let startupBuildResult = 'ok';
  try {
    if (fs.existsSync(pendingBuildPath)) {
      log('Найден pending-build — выполняю сборку...');
      startupBuildResult = applyTranslationInPlace(resourcesDir);
    } else if (patchRequired) {
      log('Перевод слетел — применяю...');
      startupBuildResult = applyTranslationInPlace(resourcesDir);
    }

    if (startupBuildResult !== false && startupBuildResult !== 'failed') {
      // Проверка обновления после build, до запуска Hermes.
      try {
        await checkAndUpdate(resourcesDir);
      } catch (error) {
        log(`Проверка обновления не удалась (${error.message}). Продолжаем.`);
      }
    }
  } finally {
    releaseLock();
  }

  if (startupBuildResult === false || startupBuildResult === 'failed') {
    log('✗ Запуск остановлен: сборка локализации не завершилась. Оригинальный runtime сохранён. Исправьте зависимости и повторите hermes-ru repair.');
    process.exit(1);
  }

  // 3. Запуск Hermes
  launchHermes(resourcesDir);
})();
