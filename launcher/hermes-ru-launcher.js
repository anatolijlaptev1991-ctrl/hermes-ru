'use strict';

/**
 * hermes-ru-launcher.js — Self-healing launcher
 * Запускается перед Hermes.exe, проверяет целостность перевода,
 * при необходимости перепатчивает, затем запускает Hermes.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const asar = require('@electron/asar');

const DATA_DIR = path.join(os.homedir(), '.hermes', 'russian-loc');
const HERMES_EXE_PATH_FILE = path.join(DATA_DIR, 'hermes-exe-path.txt');

function log(msg) { console.log(`[hermes-ru-launcher] ${msg}`); }

function fileHash(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function findHermesResources() {
  if (fs.existsSync(HERMES_EXE_PATH_FILE)) {
    const savedExe = fs.readFileSync(HERMES_EXE_PATH_FILE, 'utf8').trim();
    if (fs.existsSync(savedExe)) {
      return path.join(path.dirname(savedExe), '..', 'resources');
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
  const asarPath = path.join(resourcesDir, 'app.asar');
  const jsFiles = asar.listPackage(asarPath, { isPack: false })
    .filter(p => p.includes('index-') && p.endsWith('.js'));
  if (jsFiles.length === 0) return true;
  try {
    const jsPath = jsFiles[0].replace(/\\/g, '/').replace(/^\//, '');
    const buf = asar.extractFile(asarPath, jsPath);
    return !buf.toString().includes('Русский');
  } catch {
    return true;
  }
}

function doPatch(resourcesDir) {
  const asarPath = path.join(resourcesDir, 'app.asar');
  const backupPath = path.join(resourcesDir, 'app.asar.orig');
  const unpackDir = path.join(resourcesDir, '_hermes_ru_unpack');

  log('Перепатчиваю app.asar после обновления...');

  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(asarPath, backupPath);
  } else {
    fs.copyFileSync(backupPath, asarPath);
  }

  if (fs.existsSync(unpackDir)) fs.rmSync(unpackDir, { recursive: true });
  fs.mkdirSync(unpackDir, { recursive: true });
  asar.extractAll(asarPath, unpackDir);

  const distSource = path.join(DATA_DIR, 'dist');
  const targetDist = path.join(unpackDir, 'dist');
  if (fs.existsSync(targetDist)) fs.rmSync(targetDist, { recursive: true });
  copyDirSync(distSource, targetDist);

  asar.createPackageFromFilesWithOptions(unpackDir, asarPath, { unpackDir: 'node_modules' });
  fs.rmSync(unpackDir, { recursive: true });

  fs.writeFileSync(path.join(resourcesDir, '.hermes-ru-patched'), JSON.stringify({
    version: require('../package.json').version,
    patchedAt: new Date().toISOString(),
    originalHash: fileHash(backupPath),
  }));

  log('✓ Перевод восстановлен!');
}

function launchHermes(resourcesDir) {
  let hermesExe = fs.existsSync(HERMES_EXE_PATH_FILE)
    ? fs.readFileSync(HERMES_EXE_PATH_FILE, 'utf8').trim()
    : path.join(resourcesDir, '..', 'Hermes.exe');
  if (!hermesExe || !fs.existsSync(hermesExe)) {
    hermesExe = path.join(resourcesDir, '..', 'Hermes.exe');
  }
  log(`Запуск Hermes: ${hermesExe}`);
  const child = spawn(hermesExe, [], { detached: true, stdio: 'ignore' });
  child.unref();
}

(function main() {
  const resourcesDir = findHermesResources();
  if (!resourcesDir) { log('Hermes не найден. Запуск невозможен.'); process.exit(1); }
  if (needsPatch(resourcesDir)) {
    try { doPatch(resourcesDir); }
    catch (e) {
      log(`Ошибка восстановления перевода: ${e.message}`);
      log('Запускаю Hermes без перевода...');
    }
  }
  launchHermes(resourcesDir);
})();
