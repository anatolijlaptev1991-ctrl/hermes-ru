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
const { spawn, execSync } = require('child_process');

const DATA_DIR = path.join(os.homedir(), '.hermes', 'russian-loc');
const HERMES_EXE_PATH_FILE = path.join(DATA_DIR, 'hermes-exe-path.txt');
const VERSION_FILE = path.join(DATA_DIR, 'version.json');
const GITHUB_API = 'https://api.github.com/repos/anatolijlaptev1991-ctrl/hermes-ru/releases/latest';

function log(msg) { console.log(`[hermes-ru-launcher] ${msg}`); }

function getInstalledVersion() {
  try {
    if (fs.existsSync(VERSION_FILE)) {
      const v = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
      return v.hermesRuVersion || '0.0.0';
    }
  } catch (e) { /* ignore */ }
  return '0.0.0';
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

function needsPatch(resourcesDir) {
  const markerPath = path.join(resourcesDir, '.hermes-ru-patched');
  if (!fs.existsSync(markerPath)) return true;
  const srcDir = path.join(resourcesDir, '..', '..', '..', 'src', 'i18n');
  // Проверяем 3 файла: types.ts, catalog.ts, ru.ts
  const checks = [
    { f: 'types.ts', re: /'ru'/ },
    { f: 'catalog.ts', re: /from\s*'\.\/ru'/ },
    { f: 'ru.ts', exists: true },
  ];
  for (const c of checks) {
    const fp = path.join(srcDir, c.f);
    if (!fs.existsSync(fp)) return true;
    if (c.re && !c.re.test(fs.readFileSync(fp, 'utf8'))) return true;
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
      log('⚠ pending-build.json повреждён. Удаляю.');
      fs.unlinkSync(pendingPath);
      return false;
    }
    const desktopDir = pending.desktopDir || path.join(resourcesDir, '..', '..', '..');

    log(`Найден pending-build (v${pending.version}). Проверяю окружение...`);
    // Preflight: проверяем node_modules
    if (!fs.existsSync(path.join(desktopDir, 'node_modules'))) {
      log('⚠ node_modules не найден в apps/desktop. Установите зависимости Hermes:');
      log('  cd ' + desktopDir + ' && npm install');
      fs.unlinkSync(pendingPath);
      return false;
    }
    log('Запускаю npm run build (может занять несколько минут)...');
    try {
      const { execSync } = require('child_process');
      execSync('npm run build', { cwd: desktopDir, stdio: 'inherit', timeout: 600000 });
      log('✓ Build завершён.');

      // КРИТИЧНО: копируем собранный dist/ в runtime (app.asar.unpacked/dist/)
      const builtDist = path.join(desktopDir, 'dist');
      const runtimeDist = path.join(resourcesDir, 'app.asar.unpacked', 'dist');
      if (fs.existsSync(builtDist) && fs.existsSync(path.join(resourcesDir, 'app.asar.unpacked'))) {
        log('Копирую dist/ в runtime...');
        if (fs.existsSync(runtimeDist)) fs.rmSync(runtimeDist, { recursive: true, force: true });
        copyDirSync(builtDist, runtimeDist);
        log('✓ dist/ скопирован в app.asar.unpacked.');
      }

      // Создаём marker (или удаляем если uninstall)
      if (pending.version === 'uninstall') {
        const marker = path.join(resourcesDir, '.hermes-ru-patched');
        if (fs.existsSync(marker)) fs.rmSync(marker, { force: true });
        log('✓ Английский восстановлен.');
      } else {
        fs.writeFileSync(path.join(resourcesDir, '.hermes-ru-patched'), JSON.stringify({
          version: pending.version, patchedAt: new Date().toISOString(), method: 'defineLocale+build',
        }));
        log('✓ Русская локализация применена.');
      }
      fs.unlinkSync(pendingPath);
    } catch (e) {
      log(`⚠ Build не удался: ${e.message}`);
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
    return true;
  }

  // 2. Self-healing: если needsPatch=true (marker пропал ИЛИ файлы повреждены)
  const typesPath = path.join(resourcesDir, '..', '..', '..', 'src', 'i18n', 'types.ts');
  if (fs.existsSync(typesPath)) {
    // Self-heal нужен если ЛЮБОЙ из патчей слетел (types, catalog, ru.ts)
    const srcDir = path.join(resourcesDir, '..', '..', '..', 'src', 'i18n');
    const catalogPath = path.join(srcDir, 'catalog.ts');
    const ruTsPath = path.join(srcDir, 'ru.ts');
    const tc = fs.readFileSync(typesPath, 'utf8');
    const needsRu = !tc.includes("'ru'") ||
      !fs.existsSync(ruTsPath) ||
      (fs.existsSync(catalogPath) && !/from\s*'\.\/ru'/.test(fs.readFileSync(catalogPath, 'utf8')));
    if (needsRu) {
      log('Перевод слетел (Hermes обновился?) — перепатчиваю...');
      const ruSource = path.join(dataDir, 'ru.ts');
      if (!fs.existsSync(ruSource)) {
        log('⚠ ru.ts не найден в хранилище. Запустите hermes-ru install.');
        return false;
      }
      const srcDir = path.join(resourcesDir, '..', '..', '..', 'src', 'i18n');
      fs.copyFileSync(ruSource, path.join(srcDir, 'ru.ts'));

      // Патчим types/catalog/languages (теми же заменами что patchLoc)
      let t = fs.readFileSync(typesPath, 'utf8');
      t = t.replace(/export type Locale = 'en' \| 'zh' \| 'zh-hant' \| 'ja'/, "export type Locale = 'en' | 'zh' | 'zh-hant' | 'ja' | 'ru'");
      fs.writeFileSync(typesPath, t, 'utf8');

      const catalogPath = path.join(srcDir, 'catalog.ts');
      let cc = fs.readFileSync(catalogPath, 'utf8');
      if (!/from\s*'\.\/ru'/.test(cc)) {
        cc = cc.replace("import { ja } from './ja'", "import { ja } from './ja'\nimport { ru } from './ru'");
        cc = cc.replace(/(ja,?[\r\n]\s*(?:ru[\r\n])?\})/, "ja,\n  ru\n}");
        fs.writeFileSync(catalogPath, cc, 'utf8');
      }

      const langPath = path.join(srcDir, 'languages.ts');
      let lc = fs.readFileSync(langPath, 'utf8');
      if (!/'ru'/.test(lc)) {
        lc = lc.replace(/(\{[^}]*id:\s*'ja'[^}]*\})\s*\]/, "$1,\n  {\n    id: 'ru',\n    name: 'Русский',\n    englishName: 'Russian',\n    configValue: 'ru'\n  }\n]");
        lc = lc.replace(/(ja_jp:\s*'ja')/, "$1,\n  ru: 'ru',\n  'ru-ru': 'ru',\n  ru_ru: 'ru'");
        fs.writeFileSync(langPath, lc, 'utf8');
      }

      // Build + copy
      const desktopDir = path.join(resourcesDir, '..', '..', '..');
      if (!fs.existsSync(path.join(desktopDir, 'node_modules'))) {
        log('⚠ node_modules не найден. Пропускаю self-heal.');
        return false;
      }
      try {
        const { execSync } = require('child_process');
        execSync('npm run build', { cwd: desktopDir, stdio: 'inherit', timeout: 600000 });
        // Копируем dist/ в runtime
        const builtDist = path.join(desktopDir, 'dist');
        const runtimeDist = path.join(resourcesDir, 'app.asar.unpacked', 'dist');
        if (fs.existsSync(builtDist) && fs.existsSync(path.join(resourcesDir, 'app.asar.unpacked'))) {
          if (fs.existsSync(runtimeDist)) fs.rmSync(runtimeDist, { recursive: true, force: true });
          copyDirSync(builtDist, runtimeDist);
        } else {
          log('⚠ Не удалось скопировать dist в runtime — app.asar.unpacked или builtDist отсутствует.');
          return false;
        }
        fs.writeFileSync(path.join(resourcesDir, '.hermes-ru-patched'), JSON.stringify({
          version: getInstalledVersion(), patchedAt: new Date().toISOString(), method: 'defineLocale+build',
        }));
        log('✓ Перевод восстановлен!');
      } catch (e) {
        log(`⚠ Build не удался: ${e.message}`);
      }
    }
  }
  // Если файлы целы но marker пропал — восстанавливаем только если build не нужен
  const markerPath = path.join(resourcesDir, '.hermes-ru-patched');
  if (!fs.existsSync(markerPath)) {
    // marker восстанавливаем только если needsRu был false (build не запускался)
    // Если build запускался (needsRu=true) — marker создаётся внутри build try/except
    if (!needsRu) {
      fs.writeFileSync(markerPath, JSON.stringify({
        version: getInstalledVersion(), patchedAt: new Date().toISOString(), method: 'defineLocale+build',
      }));
      log('✓ Marker восстановлен.');
    }
  }
  return true;
}
async function checkAndUpdate(resourcesDir) {
  const currentVersion = getInstalledVersion();
  log(`Текущая версия: ${currentVersion}`);

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

  if (fs.existsSync(extractedRuTs)) {
    fs.writeFileSync(VERSION_FILE, JSON.stringify({
      hermesRuVersion: latestVersion,
      stagedAt: new Date().toISOString(),
    }));
  } else {
    log('⚠ В архиве нет src/i18n/ru.ts — перевод не обновлён.');
  }

  // Применяем перевод: копируем новый ru.ts в исходники, запускаем build
  const srcDir = path.join(resourcesDir, '..', '..', '..', 'src', 'i18n');
  const targetRu = path.join(srcDir, 'ru.ts');
  if (fs.existsSync(path.join(DATA_DIR, 'ru.ts')) && fs.existsSync(srcDir)) {
    fs.copyFileSync(path.join(DATA_DIR, 'ru.ts'), targetRu);
    log('✓ Новый ru.ts скопирован в исходники');
  }
  // Создаём pending-build для принудительной сборки
  const desktopDir = path.join(resourcesDir, '..', '..', '..');
  fs.writeFileSync(path.join(DATA_DIR, 'pending-build.json'), JSON.stringify({
    desktopDir, version: latestVersion, createdAt: new Date().toISOString(),
  }));
  applyTranslationInPlace(resourcesDir);

  // Чистим
  fs.rmSync(tmpExtract, { recursive: true, force: true });
  log(`✓ Обновлено до версии ${latestVersion}!`);
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

(async function main() {
  const resourcesDir = findHermesResources();
  if (!resourcesDir) {
    log('⚠ Hermes Desktop не найден. Запуск невозможен.');
    process.exit(1);
  }

  // 1. Приоритет: pending-build (install создал флаг, build ждёт)
  const pendingBuildPath = path.join(DATA_DIR, 'pending-build.json');
  if (fs.existsSync(pendingBuildPath)) {
    log('Найден pending-build — выполняю сборку...');
    applyTranslationInPlace(resourcesDir);
  } else if (needsPatch(resourcesDir)) {
    log('Перевод слетел — применяю...');
    applyTranslationInPlace(resourcesDir);
  }

  // 2. Проверка обновления с GitHub (после build, до запуска Hermes)
  try {
    await checkAndUpdate(resourcesDir);
  } catch (e) {
    log(`Проверка обновления не удалась (${e.message}). Продолжаем.`);
  }

  // 3. Запуск Hermes
  launchHermes(resourcesDir);
})();
