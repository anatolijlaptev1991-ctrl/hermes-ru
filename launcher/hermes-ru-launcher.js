'use strict';

/**
 * hermes-ru-launcher.js — Self-healing launcher с автообновлением
 *
 * При запуске через ярлык «Hermes (Русский)»:
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
const crypto = require('crypto');
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
  // Проверяем наличие ru в types.ts (если Hermes обновился — слетит)
  const typesPath = path.join(resourcesDir, '..', '..', 'src', 'i18n', 'types.ts');
  if (fs.existsSync(typesPath)) {
    const c = fs.readFileSync(typesPath, 'utf8');
    return !c.includes("'ru'");
  }
  return false;
}

function applyTranslationInPlace(resourcesDir) {
  // Делегируем в patchLoc из patcher.js — копируем ru.ts, патчим исходники, билдим
  const desktopDir = path.join(resourcesDir, '..', '..');
  const srcDir = path.join(desktopDir, 'src', 'i18n');
  if (!fs.existsSync(srcDir)) return false;

  const dataDir = DATA_DIR;
  const ruSource = path.join(dataDir, 'ru.ts');
  if (!fs.existsSync(ruSource)) {
    log('⚠ ru.ts не найден в персистентном хранилище. Запустите hermes-ru install.');
    return false;
  }

  log('Восстанавливаю перевод (defineLocale + build)...');

  // Копируем ru.ts
  fs.copyFileSync(ruSource, path.join(srcDir, 'ru.ts'));

  // Патчим types.ts
  const typesPath = path.join(srcDir, 'types.ts');
  let tc = fs.readFileSync(typesPath, 'utf8');
  if (!/'ru'/.test(tc)) {
    tc = tc.replace(/export type Locale = 'en' \| 'zh' \| 'zh-hant' \| 'ja'/, "export type Locale = 'en' | 'zh' | 'zh-hant' | 'ja' | 'ru'");
    fs.writeFileSync(typesPath, tc, 'utf8');
  }

  // Патчим catalog.ts
  const catalogPath = path.join(srcDir, 'catalog.ts');
  let cc = fs.readFileSync(catalogPath, 'utf8');
  if (!/from\s*'\.\/ru'/.test(cc)) {
    cc = cc.replace("import { ja } from './ja'", "import { ja } from './ja'\nimport { ru } from './ru'");
    cc = cc.replace(/(ja\n\})/, "ja,\n  ru\n}");
    fs.writeFileSync(catalogPath, cc, 'utf8');
  }

  // Патчим languages.ts
  const langPath = path.join(srcDir, 'languages.ts');
  let lc = fs.readFileSync(langPath, 'utf8');
  if (!/'ru'/.test(lc)) {
    lc = lc.replace(/(\{[^}]*id:\s*'ja'[^}]*\})\s*\]/, "$1,\n  {\n    id: 'ru',\n    name: 'Русский',\n    englishName: 'Russian',\n    configValue: 'ru'\n  }\n]");
    lc = lc.replace(/(ja_jp:\s*'ja')/, "$1,\n  ru: 'ru',\n  'ru-ru': 'ru',\n  ru_ru: 'ru'");
    fs.writeFileSync(langPath, lc, 'utf8');
  }

  // Сборка
  try {
    const { execSync } = require('child_process');
    execSync('npm run build', { cwd: desktopDir, stdio: ['ignore', 'pipe', 'ignore'], timeout: 300000 });
    fs.writeFileSync(path.join(resourcesDir, '.hermes-ru-patched'), JSON.stringify({
      version: getInstalledVersion(), patchedAt: new Date().toISOString(), method: 'defineLocale+build',
    }));
    log('✓ Перевод восстановлен!');
    return true;
  } catch (e) {
    log(`⚠ Сборка не удалась: ${e.message}`);
    return false;
  }
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

  // Находим папку dist в распакованном
  const newDist = fs.existsSync(path.join(tmpExtract, 'dist'))
    ? path.join(tmpExtract, 'dist')
    : tmpExtract;

  // Обновляем персистентное хранилище
  const persistentDist = path.join(DATA_DIR, 'dist');
  if (fs.existsSync(persistentDist)) fs.rmSync(persistentDist, { recursive: true, force: true });
  copyDirSync(newDist, persistentDist);
  fs.writeFileSync(VERSION_FILE, JSON.stringify({
    hermesRuVersion: latestVersion,
    stagedAt: new Date().toISOString(),
  }));

  // Применяем перевод
  applyTranslation(resourcesDir, persistentDist, latestVersion);

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

  // 1. Проверка обновления с GitHub (быстрая, таймаут 10 сек)
  try {
    await checkAndUpdate(resourcesDir);
  } catch (e) {
    log(`Проверка обновления не удалась (${e.message}). Продолжаем.`);
  }

  // 2. Проверка целостности перевода (in-place)
  if (needsPatch(resourcesDir)) {
    log('Перевод отсутствует или слетел — применяю in-place...');
    applyTranslationInPlace(resourcesDir);
  }

  // 3. Запуск Hermes
  launchHermes(resourcesDir);
})();
