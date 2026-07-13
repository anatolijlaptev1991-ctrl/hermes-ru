'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');
const asar = require('@electron/asar');

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

function copyDirSync(src, dest) {
  if (fs.existsSync(dest)) rm(dest);
  recursiveCopy(src, dest);
}

function killHermes() {
  try { execSync('taskkill /F /IM Hermes.exe', { stdio: 'ignore' }); } catch (e) { /* not running */ }
}

function patchAsar(resourcesDir, distSourceDir) {
  const asarPath = path.join(resourcesDir, 'app.asar');
  const backupPath = path.join(resourcesDir, BACKUP_NAME);
  const unpackDir = path.join(resourcesDir, '_hermes_ru_unpack');

  killHermes();

  if (!fs.existsSync(backupPath)) {
    log('Создаю резервную копию app.asar...');
    fs.copyFileSync(asarPath, backupPath);
  }

  log('Распаковываю app.asar...');
  if (fs.existsSync(unpackDir)) rm(unpackDir);
  mkdirp(unpackDir);
  asar.extractAll(asarPath, unpackDir);

  log('Внедряю русскую локализацию...');
  copyDirSync(distSourceDir, path.join(unpackDir, 'dist'));

  log('Запаковываю app.asar...');
  asar.createPackageFromFilesWithOptions(unpackDir, asarPath, { unpackDir: 'node_modules' });

  rm(unpackDir);

  fs.writeFileSync(path.join(resourcesDir, PATCH_MARKER), JSON.stringify({
    version: VERSION,
    patchedAt: new Date().toISOString(),
    originalHash: fileHash(backupPath),
  }));

  log('✓ Патч применён!');
}

function restoreAsar(resourcesDir) {
  const asarPath = path.join(resourcesDir, 'app.asar');
  const backupPath = path.join(resourcesDir, BACKUP_NAME);
  if (!fs.existsSync(backupPath)) {
    err('Резервная копия не найдена. Локализация, возможно, не устанавливалась.');
    return false;
  }
  killHermes();
  log('Восстанавливаю оригинальный app.asar...');
  fs.copyFileSync(backupPath, asarPath);
  rm(path.join(resourcesDir, PATCH_MARKER));
  log('✓ Оригинал восстановлен!');
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
  copyDirSync(distSource, path.join(dataDir, 'dist'));
  fs.writeFileSync(path.join(dataDir, 'version.json'), JSON.stringify({
    hermesRuVersion: VERSION,
    stagedAt: new Date().toISOString(),
  }));
  const launcherSource = path.join(__dirname, '..', 'launcher', 'hermes-ru-launcher.js');
  if (fs.existsSync(launcherSource)) {
    fs.copyFileSync(launcherSource, path.join(dataDir, 'hermes-ru-launcher.js'));
  }
  log(`✓ Перевод сохранён в ${dataDir}`);
}

function createWindowsLauncher(resourcesDir) {
  const dataDir = getPersistentDataDir();
  const hermesExe = findHermesExe(resourcesDir);
  if (!hermesExe) {
    warn('Hermes.exe не найден, launcher не создан.');
    return;
  }
  const launcherJs = path.join(dataDir, 'hermes-ru-launcher.js');
  const vbsDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Hermes RU');
  mkdirp(vbsDir);
  const vbsPath = path.join(vbsDir, 'Hermes (Русский).vbs');
  const vbsContent = `' Auto-generated by hermes-ru
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "node ""${launcherJs.replace(/\//g, '\\\\')}""", 0, False
`;
  fs.writeFileSync(vbsPath, vbsContent);
  log(`✓ Ярлык создан: ${vbsPath}`);
  fs.writeFileSync(path.join(dataDir, 'hermes-exe-path.txt'), hermesExe);
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

async function commandInstall() {
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
    err('dist/ не найден в пакете. Переустановите: npm i -g hermes-ru');
    process.exit(1);
  }

  patchAsar(resourcesDir, distSourceDir);
  stageToPersistent(resourcesDir);
  createWindowsLauncher(resourcesDir);
  setConfigLanguage();

  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║  ✓ Установка завершена!                        ║');
  console.log('║  Запустите Hermes из меню Пуск:                ║');
  console.log('║    «Hermes (Русский)»                          ║');
  console.log('║  Локализация восстановится после обновлений.   ║');
  console.log('╚════════════════════════════════════════════════╝\n');
}

async function commandUninstall() {
  console.log('Восстановление оригинального Hermes...\n');
  const resourcesDir = findHermesResources();
  if (!resourcesDir) { err('Hermes Desktop не найден!'); process.exit(1); }
  const restored = restoreAsar(resourcesDir);
  const vbsDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Hermes RU');
  if (fs.existsSync(vbsDir)) rm(vbsDir);
  const configPath = path.join(os.homedir(), '.hermes', 'config.yaml');
  if (fs.existsSync(configPath)) {
    let content = fs.readFileSync(configPath, 'utf8');
    content = content.replace(/^\s*language:\s*ru\s*$/m, '  # language: ru (removed by hermes-ru)');
    fs.writeFileSync(configPath, content, 'utf8');
  }
  if (restored) log('✓ Английский интерфейс восстановлен.');
}

async function commandStatus() {
  const resourcesDir = findHermesResources();
  if (!resourcesDir) { console.log('Hermes Desktop не найден.'); process.exit(1); }
  const markerPath = path.join(resourcesDir, PATCH_MARKER);
  const backupPath = path.join(resourcesDir, BACKUP_NAME);
  if (!fs.existsSync(markerPath)) {
    console.log('Статус: ❌ Локализация не установлена');
    console.log('Запустите: hermes-ru install');
    return;
  }
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  const currentHash = fileHash(path.join(resourcesDir, 'app.asar'));
  const isPatched = currentHash !== marker.originalHash;
  console.log('╔══════════════════════════════════════════╗');
  console.log(`║  hermes-ru ${marker.version}`);
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Hermes:        ${resourcesDir}`);
  console.log(`║  Установлен:    ${marker.patchedAt}`);
  console.log(`║  Патч активен:  ${isPatched ? '✅ Да' : '❌ Нет (обновлён?)'}`);
  if (!isPatched) {
    console.log('║  Hermes обновлён — запустите ярлык        ');
    console.log('║  «Hermes (Русский)» или hermes-ru repair  ');
  }
  console.log('╚══════════════════════════════════════════╝');
}

async function commandRepair() {
  log('Принудительное перепатчивание...');
  const resourcesDir = findHermesResources();
  if (!resourcesDir) { err('Hermes Desktop не найден!'); process.exit(1); }
  const markerPath = path.join(resourcesDir, PATCH_MARKER);
  if (fs.existsSync(markerPath)) rm(markerPath);
  restoreAsar(resourcesDir);
  patchAsar(resourcesDir, path.join(__dirname, '..', 'dist'));
  log('✓ Ремонт завершён! Запустите Hermes через ярлык.');
}

module.exports = { commandInstall, commandUninstall, commandStatus, commandRepair };
