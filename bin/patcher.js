'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');

const rm = (p) => fs.rmSync(p, { recursive: true, force: true });
const mkdirp = (p) => fs.mkdirSync(p, { recursive: true });
function recursiveCopy(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    mkdirp(dest);
    for (const e of fs.readdirSync(src)) recursiveCopy(path.join(src, e), path.join(dest, e));
  } else {
    mkdirp(path.dirname(dest));
    fs.copyFileSync(src, dest);
  }
}

const HERMES_EXE_NAME = 'Hermes.exe';
const BACKUP_NAME = 'app.asar.orig';
const PATCH_MARKER = '.hermes-ru-patched';
const VERSION = require('../package.json').version;

const DIST_DIR = path.join(__dirname, '..', 'dist');

function log(msg) { console.log(`[hermes-ru] ${msg}`); }
function warn(msg) { console.warn(`[hermes-ru] ⚠ ${msg}`); }
function err(msg) { console.error(`[hermes-ru] ✗ ${msg}`); }

function findHermesResources() {
  const home = os.homedir();
  const candidates = [
    path.join(home, 'AppData', 'Local', 'hermes', 'hermes-agent', 'apps', 'desktop', 'release', 'win-unpacked', 'resources'),
    path.join(home, 'AppData', 'Local', 'Programs', 'Hermes', 'resources'),
    path.join(home, 'AppData', 'Local', 'hermes-desktop', 'resources'),
    path.join('C:', 'Program Files', 'Hermes', 'resources'),
    path.join('C:', 'Program Files (x86)', 'Hermes', 'resources'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'app.asar'))) return c;
  }
  return null;
}

function findHermesExe(resourcesDir) {
  const exe = path.join(path.dirname(resourcesDir), HERMES_EXE_NAME);
  return fs.existsSync(exe) ? exe : null;
}

function fileHash(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function isHermesRunning() {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq Hermes.exe"', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return /Hermes\.exe/i.test(out);
  } catch (e) {
    return false;
  }
}

function killHermes() {
  try { execSync('taskkill /F /IM Hermes.exe', { stdio: 'ignore' }); } catch (e) { /* not running */ }
}

function launchHermes(resourcesDir) {
  const launcherJs = path.join(getPersistentDataDir(), 'hermes-ru-launcher.js');
  if (fs.existsSync(launcherJs)) {
    try {
      execSync(`cmd /c start "" node "${launcherJs}"`, { stdio: 'ignore', detached: true });
      log('Hermes запущен через self-healing launcher.');
      return;
    } catch (e) { /* fall through */ }
  }
  const exe = resourcesDir && findHermesExe(resourcesDir);
  if (exe) {
    try {
      execSync(`cmd /c start "" "${exe}"`, { stdio: 'ignore', detached: true });
      log('Hermes запущен напрямую.');
      return;
    } catch (e) { /* ignore */ }
  }
  warn('Не удалось автоматически запустить Hermes. Откройте ярлык вручную.');
}

// Основной метод: Hermes берёт dist из app.asar.unpacked/dist.
// Заменяем только эту папку — НЕ трогая app.asar (безопасно, нет багов asar+Node24).
function patchLoc(resourcesDir, distSourceDir) {
  const unpackedDir = path.join(resourcesDir, 'app.asar.unpacked');
  if (!fs.existsSync(unpackedDir)) {
    // fallback: распаковать app.asar (редкий случай)
    err('app.asar.unpacked не найден. Этот метод установки не поддерживается для вашей сборки.');
    return false;
  }
  const destDist = path.join(unpackedDir, 'dist');
  log('Заменяю dist на русскую версию...');
  if (fs.existsSync(destDist)) rm(destDist);
  recursiveCopy(distSourceDir, destDist);

  fs.writeFileSync(path.join(resourcesDir, PATCH_MARKER), JSON.stringify({
    version: VERSION,
    patchedAt: new Date().toISOString(),
    method: 'app.asar.unpacked/dist',
  }));
  log('✓ Локализация применена!');
  return true;
}

function restoreLoc(resourcesDir) {
  const unpackedDir = path.join(resourcesDir, 'app.asar.unpacked');
  if (!fs.existsSync(unpackedDir)) {
    err('app.asar.unpacked не найден.');
    return false;
  }
  const destDist = path.join(unpackedDir, 'dist');
  // Мы не делали backup dist отдельно — восстанавливаем из app.asar (оригинальный dist там есть)
  const asarDist = path.join(unpackedDir, '_orig_dist_extract');
  try {
    const asar = require('@electron/asar');
    if (fs.existsSync(asarDist)) rm(asarDist);
    mkdirp(asarDist);
    asar.extractAll(path.join(resourcesDir, 'app.asar'), asarDist);
    if (fs.existsSync(destDist)) rm(destDist);
    recursiveCopy(path.join(asarDist, 'dist'), destDist);
    rm(asarDist);
  } catch (e) {
    warn('Не удалось восстановить dist из asar: ' + e.message);
    warn('Переустановите Hermes, чтобы вернуть оригинальный dist.');
  }
  rm(path.join(resourcesDir, PATCH_MARKER));
  log('✓ Оригинальный dist восстановлен!');
  return true;
}

function getPersistentDataDir() {
  const dir = path.join(os.homedir(), '.hermes', 'russian-loc');
  mkdirp(dir);
  return dir;
}

function stageToPersistent(resourcesDir) {
  const dataDir = getPersistentDataDir();
  const distSource = path.join(__dirname, '..', 'dist');
  log('Копирую перевод в персистентное хранилище...');
  if (fs.existsSync(path.join(dataDir, 'dist'))) rm(path.join(dataDir, 'dist'));
  recursiveCopy(distSource, path.join(dataDir, 'dist'));
  fs.writeFileSync(path.join(dataDir, 'version.json'), JSON.stringify({
    hermesRuVersion: VERSION,
    stagedAt: new Date().toISOString(),
  }));
  const launcherSource = path.join(__dirname, '..', 'launcher', 'hermes-ru-launcher.js');
  if (fs.existsSync(launcherSource)) {
    fs.copyFileSync(launcherSource, path.join(dataDir, 'hermes-ru-launcher.js'));
  }
  // Копируем иконку
  const iconSource = path.join(__dirname, '..', 'assets', 'hermes-ru-icon.ico');
  if (fs.existsSync(iconSource)) {
    fs.copyFileSync(iconSource, path.join(dataDir, 'hermes-ru-icon.ico'));
    log('✓ Иконка скопирована');
  }
  log(`✓ Перевод сохранён в ${dataDir}`);
}

function createShortcut(lnkPath, launcherJs) {
  const nodeExe = process.execPath;
  const iconPath = path.join(getPersistentDataDir(), 'hermes-ru-icon.ico');
  const iconLine = fs.existsSync(iconPath) ? `$sc.IconLocation = '${iconPath.replace(/\\/g, '\\\\')}'\n` : '';
  const psPath = path.join(os.tmpdir(), 'hermes-ru-shortcut.ps1');
  const ps = [
    '$ws = New-Object -ComObject WScript.Shell',
    `$sc = $ws.CreateShortcut('${lnkPath.replace(/\\/g, '\\\\')}')`,
    `$sc.TargetPath = '${nodeExe.replace(/\\/g, '\\\\')}'`,
    `$sc.Arguments = '"${launcherJs.replace(/\\/g, '\\\\')}"'`,
    `$sc.WorkingDirectory = '${os.homedir().replace(/\\/g, '\\\\')}'`,
    `$sc.Description = 'Hermes Agent Desktop (Русский)'`,
    iconLine,
    '$sc.Save()',
  ].join('\n') + '\n';
  fs.writeFileSync(psPath, ps, 'utf8');
  try {
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psPath}"`, { stdio: 'ignore' });
    return true;
  } catch (e) {
    warn('Не удалось создать ярлык: ' + e.message);
    return false;
  } finally {
    rm(psPath);
  }
}

function createWindowsLauncher(resourcesDir) {
  const dataDir = getPersistentDataDir();
  const launcherJs = path.join(dataDir, 'hermes-ru-launcher.js');

  // Ярлыки (латинское имя — кириллица ломает WScript.Shell COM на Windows)
  const desktop = path.join(os.homedir(), 'Desktop');
  mkdirp(desktop);
  if (createShortcut(path.join(desktop, 'Hermes RU.lnk'), launcherJs)) {
    log(`✓ Ярлык создан: ${path.join(desktop, 'Hermes RU.lnk')}`);
  }

  const startMenu = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Hermes RU');
  mkdirp(startMenu);
  if (createShortcut(path.join(startMenu, 'Hermes RU.lnk'), launcherJs)) {
    log(`✓ Ярлык создан: ${path.join(startMenu, 'Hermes RU.lnk')}`);
  }

  fs.writeFileSync(path.join(dataDir, 'hermes-exe-path.txt'), findHermesExe(resourcesDir) || '');
}

function setConfigLanguage() {
  const configPath = path.join(os.homedir(), '.hermes', 'config.yaml');
  if (!fs.existsSync(configPath)) {
    warn('config.yaml не найден — язык нужно выбрать вручную в настройках Hermes.');
    return;
  }
  let content = fs.readFileSync(configPath, 'utf8');
  if (/^\s*language:\s*ru\s*$/m.test(content)) {
    log('Язык уже установлен в config.yaml');
    return;
  }
  if (/^display:/m.test(content)) {
    content = content.replace(/^display:\s*$/m, 'display:\n  language: ru');
  } else {
    content += '\ndisplay:\n  language: ru\n';
  }
  fs.writeFileSync(configPath, content, 'utf8');
  log('✓ Язык ru установлен в config.yaml');
}

async function commandInstall({ restart = false } = {}) {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  Установка русской локализации Hermes     ║');
  console.log('╚══════════════════════════════════════════╝\n');

  const resourcesDir = findHermesResources();
  if (!resourcesDir) {
    err('Hermes Desktop не найден! Установите Hermes Desktop, затем повторите.');
    process.exit(1);
  }
  log(`Найден Hermes: ${resourcesDir}`);

  const distSourceDir = path.join(__dirname, '..', 'dist');
  if (!fs.existsSync(distSourceDir)) {
    err('dist/ не найден в пакете. Переустановите: npm i -g @anatolijlaptev1991/hermes-ru');
    process.exit(1);
  }

  if (isHermesRunning() && !restart) {
    warn('Hermes запущен. Локализация применится к файлам, но активная сессия использует старую версию.');
    warn('После завершения установки перезапустите Hermes вручную (через ярлык «Hermes (Русский)»).');
  }

  const ok = patchLoc(resourcesDir, distSourceDir);
  if (!ok) process.exit(1);
  stageToPersistent(resourcesDir);
  createWindowsLauncher(resourcesDir);
  setConfigLanguage();

  if (restart) {
    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║  ✓ Установка завершена и Hermes запущен!        ║');
    console.log('╚════════════════════════════════════════════════╝\n');
    launchHermes(resourcesDir);
  } else {
    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║  ✓ Установка завершена!                        ║');
    console.log('║                                                ║');
    console.log('║  ПЕРЕЗАПУСТИТЕ HERMES вручную:                  ║');
    console.log('║    ярлык «Hermes (Русский)» на рабочем столе   ║');
    console.log('║  или через меню Пуск                          ║');
    console.log('║                                                ║');
    console.log('║  Локализация восстановится после обновлений.   ║');
    console.log('╚════════════════════════════════════════════════╝\n');
  }
}

async function commandUninstall({ restart = false } = {}) {
  console.log('Восстановление оригинального Hermes...\n');
  const resourcesDir = findHermesResources();
  if (!resourcesDir) { err('Hermes Desktop не найден!'); process.exit(1); }
  const restored = restoreLoc(resourcesDir);
  const vbsDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Hermes RU');
  if (fs.existsSync(vbsDir)) rm(vbsDir);
  const desktopLnk = path.join(os.homedir(), 'Desktop', 'Hermes RU.lnk');
  if (fs.existsSync(desktopLnk)) rm(desktopLnk);
  const configPath = path.join(os.homedir(), '.hermes', 'config.yaml');
  if (fs.existsSync(configPath)) {
    let content = fs.readFileSync(configPath, 'utf8');
    content = content.replace(/^\s*language:\s*ru\s*$/m, '  # language: ru (removed by hermes-ru)');
    fs.writeFileSync(configPath, content, 'utf8');
  }
  if (restored) {
    log('✓ Английский интерфейс восстановлен.');
    if (restart) launchHermes(resourcesDir);
  }
}

async function commandStatus() {
  const resourcesDir = findHermesResources();
  if (!resourcesDir) { console.log('Hermes Desktop не найден.'); process.exit(1); }
  const markerPath = path.join(resourcesDir, PATCH_MARKER);
  if (!fs.existsSync(markerPath)) {
    console.log('Статус: ❌ Локализация не установлена');
    console.log('Запустите: hermes-ru install');
    return;
  }
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  console.log('╔══════════════════════════════════════════╗');
  console.log(`║  hermes-ru ${marker.version}`);
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Hermes:        ${resourcesDir}`);
  console.log(`║  Установлен:    ${marker.patchedAt}`);
  console.log(`║  Метод:         ${marker.method || 'n/a'}`);
  console.log('╚══════════════════════════════════════════╝');
}

async function commandRepair({ restart = false } = {}) {
  log('Принудительное перепатчивание...');
  const resourcesDir = findHermesResources();
  if (!resourcesDir) { err('Hermes Desktop не найден!'); process.exit(1); }
  const ok = patchLoc(resourcesDir, path.join(__dirname, '..', 'dist'));
  if (!ok) process.exit(1);
  log('✓ Ремонт завершён!');
  if (!restart) log('Перезапустите Hermes вручную через ярлык «Hermes (Русский)».');
  else launchHermes(resourcesDir);
}

module.exports = { commandInstall, commandUninstall, commandStatus, commandRepair };
