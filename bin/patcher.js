'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const rm = (p) => fs.rmSync(p, { recursive: true, force: true });
const mkdirp = (p) => fs.mkdirSync(p, { recursive: true });

const HERMES_EXE_NAME = 'Hermes.exe';
const PATCH_MARKER = '.hermes-ru-patched';
const VERSION = require('../package.json').version;


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

// Основной метод: патч исходников i18n (без build!).
// Build делает launcher перед запуском Hermes — когда он закрыт.
// Это позволяет запускать install из чата Hermes без его закрытия.
function patchLoc(resourcesDir) {
  // resourcesDir = apps/desktop/release/win-unpacked/resources
  // desktopDir должен быть apps/desktop → 3 уровня вверх
  const desktopDir = path.resolve(resourcesDir, '..', '..', '..');
  const srcDir = path.join(desktopDir, 'src', 'i18n');

  if (!fs.existsSync(srcDir)) {
    err('Исходники i18n не найдены. Установите Hermes из официального источника.');
    return false;
  }

  log('Патчу систему i18n Hermes (defineLocale)...');

  // 1. Копируем ru.ts в src/i18n/
  const ruSource = path.join(__dirname, '..', 'src', 'i18n', 'ru.ts');
  if (!fs.existsSync(ruSource)) {
    err('ru.ts не найден в пакете hermes-ru.');
    return false;
  }
  const targetRu = path.join(srcDir, 'ru.ts');
  fs.copyFileSync(ruSource, targetRu);
  log('✓ ru.ts скопирован в src/i18n/');

  // 2. Патчим types.ts: добавляем 'ru' в Locale
  const typesPath = path.join(srcDir, 'types.ts');
  let typesContent = fs.readFileSync(typesPath, 'utf8');
  if (!/'ru'/.test(typesContent)) {
    typesContent = typesContent.replace(
      /export type Locale = 'en' \| 'zh' \| 'zh-hant' \| 'ja'/,
      "export type Locale = 'en' | 'zh' | 'zh-hant' | 'ja' | 'ru'"
    );
    fs.writeFileSync(typesPath, typesContent, 'utf8');
    log('✓ types.ts: добавлен ru в Locale');
  } else {
    log('  types.ts: ru уже присутствует');
  }

  // 3. Патчим catalog.ts: импорт + регистрация ru
  const catalogPath = path.join(srcDir, 'catalog.ts');
  let catalogContent = fs.readFileSync(catalogPath, 'utf8');
  if (!/import.*\{.*ru.*\}.*from.*'\.\/ru'/.test(catalogContent)) {
    catalogContent = catalogContent.replace(
      "import { ja } from './ja'",
      "import { ja } from './ja'\nimport { ru } from './ru'"
    );
    catalogContent = catalogContent.replace(
      /export const TRANSLATIONS.*?\{[\s\S]*?ja,?[\r\n]\s*(?:ru[\r\n])?\}/,
      "export const TRANSLATIONS: Record<Locale, Translations> = {\n  en,\n  zh,\n  'zh-hant': zhHant,\n  ja,\n  ru\n}"
    );
    fs.writeFileSync(catalogPath, catalogContent, 'utf8');
    log('✓ catalog.ts: ru зарегистрирован');
  } else {
    log('  catalog.ts: ru уже импортирован');
  }

  // 4. Патчим languages.ts: добавляем ru в LOCALE_OPTIONS и алиасы
  const langPath = path.join(srcDir, 'languages.ts');
  let langContent = fs.readFileSync(langPath, 'utf8');
  if (!/'ru'/.test(langContent)) {
    // Добавляем в LOCALE_OPTIONS
    langContent = langContent.replace(
      /(\{\s*id:\s*'ja',[\s\S]*?\})\s*\]/,
      "$1,\n  {\n    id: 'ru',\n    name: 'Русский',\n    englishName: 'Russian',\n    configValue: 'ru'\n  }\n]"
    );
    // Добавляем алиасы
    langContent = langContent.replace(
      /('ja-jp':\s*'ja',?\s*\n\s*ja_jp:\s*'ja')/,
      "$1,\n  ru: 'ru',\n  'ru-ru': 'ru',\n  ru_ru: 'ru'"
    );
    fs.writeFileSync(langPath, langContent, 'utf8');
    log('✓ languages.ts: добавлен Русский');
  } else {
    log('  languages.ts: ru уже присутствует');
  }

  // 5. Создаём флаг для launcher — нужен build
  const dataDir = getPersistentDataDir();
  fs.writeFileSync(path.join(dataDir, 'pending-build.json'), JSON.stringify({
    desktopDir,
    version: VERSION,
    createdAt: new Date().toISOString(),
  }));

  log('✓ Исходники пропатчены. Build выполнится при следующем запуске через ярлык «Hermes RU».');
  return true;
}

function restoreLoc(resourcesDir) {
  const desktopDir = path.resolve(resourcesDir, '..', '..', '..');
  const srcDir = path.join(desktopDir, 'src', 'i18n');
  if (!fs.existsSync(srcDir)) return false;

  log('Восстанавливаю оригинальные исходники i18n...');

  // Удаляем ru.ts
  const ruPath = path.join(srcDir, 'ru.ts');
  if (fs.existsSync(ruPath)) { fs.unlinkSync(ruPath); log('✓ ru.ts удалён'); }

  // Убираем ru из types.ts
  const typesPath = path.join(srcDir, 'types.ts');
  if (fs.existsSync(typesPath)) {
    let c = fs.readFileSync(typesPath, 'utf8');
    c = c.replace(/\s*\|\s*'ru'/, '');
    fs.writeFileSync(typesPath, c, 'utf8');
  }

  // Убираем ru из catalog.ts
  const catalogPath = path.join(srcDir, 'catalog.ts');
  if (fs.existsSync(catalogPath)) {
    let c = fs.readFileSync(catalogPath, 'utf8');
    c = c.replace(/\nimport \{ ru \} from '\.\/ru'/, '');
    c = c.replace(/,\n\s*ru\n\}/, '\n}');
    fs.writeFileSync(catalogPath, c, 'utf8');
  }

  // Убираем ru из languages.ts
  const langPath = path.join(srcDir, 'languages.ts');
  if (fs.existsSync(langPath)) {
    let c = fs.readFileSync(langPath, 'utf8');
    c = c.replace(/,\s*\{\s*id:\s*'ru'[\s\S]*?\}\s*\]/, '\n]');
    c = c.replace(/,\n\s*ru:\s*'ru'[\s\S]*?ru_ru:\s*'ru'/, '');
    fs.writeFileSync(langPath, c, 'utf8');
  }

  // Флаг для launcher — нужен rebuild (обратный)
  const dataDir = getPersistentDataDir();
  fs.writeFileSync(path.join(dataDir, 'pending-build.json'), JSON.stringify({
    desktopDir,
    version: 'uninstall',
    createdAt: new Date().toISOString(),
  }));

  rm(path.join(resourcesDir, PATCH_MARKER));
  log('✓ Исходники восстановлены. Build выполнится при следующем запуске.');
  return true;
}

function getPersistentDataDir() {
  const dir = path.join(os.homedir(), '.hermes', 'russian-loc');
  mkdirp(dir);
  return dir;
}

function stageToPersistent(resourcesDir) {
  const dataDir = getPersistentDataDir();
  log('Копирую перевод в персистентное хранилище...');

  // Копируем ru.ts (для launcher self-healing)
  const ruSource = path.join(__dirname, '..', 'src', 'i18n', 'ru.ts');
  if (fs.existsSync(ruSource)) {
    fs.copyFileSync(ruSource, path.join(dataDir, 'ru.ts'));
    log('✓ ru.ts скопирован');
  }

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
  if (/^\s*language:\s*\w+/m.test(content)) {
    // Заменяем существующий language: X на language: ru
    content = content.replace(/^(\s*language:\s*)\w+/m, '$1ru');
  } else if (/^display:/m.test(content)) {
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

  const ok = patchLoc(resourcesDir);
  if (!ok) process.exit(1);
  stageToPersistent(resourcesDir);
  createWindowsLauncher(resourcesDir);
  setConfigLanguage();

  if (restart) {
    log('Запуск Hermes через launcher (--restart)...');
    launchHermes(resourcesDir);
  } else {
    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║  ✓ Установка завершена!                        ║');
    console.log('║                                                ║');
    console.log('║  ПЕРЕЗАПУСТИТЕ HERMES через ярлык:              ║');
    console.log('║    «Hermes RU» на рабочем столе                ║');
    console.log('║    или через меню Пуск                         ║');
    console.log('║                                                ║');
    console.log('║  Перевод применится автоматически.             ║');
    console.log('║  (при запуске через ярлык, а не обычный)       ║');
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

  // Проверяем pending-build (install сделан, но build ещё не отработал)
  const dataDir = getPersistentDataDir();
  const pendingPath = path.join(dataDir, 'pending-build.json');
  if (fs.existsSync(pendingPath)) {
    let pending;
    try { pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8')); } catch { pending = {}; }
    if (pending.version === 'uninstall') {
      console.log('Статус: ⏳ Восстановление английского подготовлено, ожидается сборка');
      console.log('  Запустите Hermes через ярлык «Hermes RU» — английский восстановится.');
    } else {
      console.log('Статус: ⏳ Установка подготовлена, ожидается сборка');
      console.log('  Запустите Hermes через ярлык «Hermes RU» — перевод применится автоматически.');
    }
    return;
  }

  const markerPath = path.join(resourcesDir, PATCH_MARKER);
  if (!fs.existsSync(markerPath)) {
    console.log('Статус: ❌ Локализация не установлена');
    console.log('Запустите: hermes-ru install');
    return;
  }
  let marker;
  try { marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')); }
  catch { console.log('Статус: ⚠ Файл метки повреждён. Запустите hermes-ru repair.'); return; }
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
  const ok = patchLoc(resourcesDir);
  if (!ok) process.exit(1);
  stageToPersistent(resourcesDir);
  log('✓ Ремонт завершён!');
  if (!restart) log('Перезапустите Hermes вручную через ярлык «Hermes RU».');
  else launchHermes(resourcesDir);
}

module.exports = { commandInstall, commandUninstall, commandStatus, commandRepair };
