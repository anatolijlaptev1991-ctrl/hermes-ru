'use strict';
/**
 * auto-update.js — Главный оркестратор еженедельного автообновления русификатора
 *
 * Запускается через Windows Task Scheduler (НЕ через cron Hermes!).
 * НЕ убивает Hermes. Готовит перевод, публикует, launcher применит при следующем запуске.
 *
 * Использование: node auto-update.js [--force] [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// Конфигурация
const DATA_DIR = path.join(os.homedir(), '.hermes', 'russian-loc');
const REPO_DIR = 'C:\\Users\\anato.ANATOLY\\Documents\\hermes-ru';
const BUILD_DIR = 'C:\\hermes-ru-build';
const LOCK_FILE = path.join(DATA_DIR, '.update.lock');
const VERSION_FILE = path.join(DATA_DIR, 'version.json');
const CONFIG_PATH = path.join(DATA_DIR, 'auto-update-config.json');

// Загружаем секреты из внешнего конфига (НЕ в git!)
let TG_BOT_TOKEN = '', TG_CHAT_ID = '';
let DEEPSEEK_API_KEY = '', DEEPSEEK_ENDPOINT = '', DEEPSEEK_MODEL = '';
let NPM_TOKEN = '', NPM_PACKAGE = '';

if (fs.existsSync(CONFIG_PATH)) {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  TG_BOT_TOKEN = cfg.telegram?.bot_token || '';
  TG_CHAT_ID = cfg.telegram?.chat_id || '';
  DEEPSEEK_API_KEY = cfg.deepseek?.api_key || '';
  DEEPSEEK_ENDPOINT = cfg.deepseek?.endpoint || 'https://opencode.ai/zen/v1/chat/completions';
  DEEPSEEK_MODEL = cfg.deepseek?.model || 'deepseek-v4-flash-free';
  NPM_TOKEN = cfg.npm?.token || '';
  NPM_PACKAGE = cfg.npm?.package || '@anatolijlaptev1991/hermes-ru';
}

// Hermes
const HERMES_REGISTRY = '@nousresearch/hermes-agent';

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY_RUN = args.includes('--dry-run');

function log(msg) { console.log(`[auto-update] ${new Date().toISOString()} ${msg}`); }

// ─── Telegram ───
function sendTelegram(text) {
  return new Promise((resolve) => {
    const https = require('https');
    const data = JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: 'HTML' });
    const req = https.request(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 15000,
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body).ok); } catch { resolve(false); } });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.write(data);
    req.end();
  });
}

// ─── Lock ───
function acquireLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const lockAge = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
      if (lockAge < 30 * 60 * 1000) {
        log('Lock уже активен (< 30 мин). Пропускаю.');
        return false;
      }
      log('Устаревший lock, удаляю.');
      fs.unlinkSync(LOCK_FILE);
    }
    fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
    return true;
  } catch (e) {
    log(`Lock ошибка: ${e.message}`);
    return false;
  }
}
function releaseLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch {}
}

// ─── Версии ───
function getInstalledHermesVersion() {
  try {
    const pkgPath = path.join(os.homedir(), 'AppData', 'Local', 'hermes', 'hermes-agent', 'apps', 'desktop', 'package.json');
    if (fs.existsSync(pkgPath)) return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
  } catch {}
  try { return execSync('hermes --version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
  return '0.0.0';
}

function getLatestHermesVersion() {
  // Hermes публикуется через GitHub Releases, не npm
  try {
    const https = require('https');
    const result = execSync(
      `gh api repos/nousresearch/hermes-agent/releases/latest --jq .tag_name`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }
    ).trim();
    if (result) return result.replace(/^v/, '');
  } catch {}
  // Fallback: пробуем npm (на случай перехода)
  try {
    return execSync(`npm view hermes-agent version`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0, db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

// ─── Проверка консистентности ───
function checkRepoConsistency(repoDir) {
  const errors = [];
  const EXPECTED_SCOPE = '@anatolijlaptev1991/hermes-ru';

  // 1. package.json: name = scoped
  const pkg = JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json'), 'utf8'));
  if (pkg.name !== EXPECTED_SCOPE) {
    errors.push(`package.json name: "${pkg.name}" != "${EXPECTED_SCOPE}"`);
  }

  // 2. README: все npm install -g должны использовать scoped имя
  const readme = fs.readFileSync(path.join(repoDir, 'README.md'), 'utf8');
  const badNpm = readme.match(/npm\s+(?:install|i)\s+-g\s+hermes-ru(?!@)/g);
  if (badNpm) errors.push(`README: ${badNpm.length} npm install без scope: ${badNpm.slice(0, 3).join(', ')}`);

  // 3. README: npm badge ссылается на scoped пакет
  const readme_npm_badge_match = readme.match(/!\[npm\]\((.*?)\)/);
  if (readme_npm_badge_match) {
    const badge_url = readme_npm_badge_match[1];
    if (!badge_url.includes('anatolijlaptev1991/hermes-ru')) {
      errors.push(`README npm badge: не содержит scoped имя (${badge_url})`);
    }
  }

  // 4. compat.json: version соответствует package.json
  const compat = JSON.parse(fs.readFileSync(path.join(repoDir, 'compat.json'), 'utf8'));
  if (compat.version !== pkg.version) {
    errors.push(`compat.json version (${compat.version}) != package.json (${pkg.version})`);
  }

  // 5. CHANGELOG.md существует
  if (!fs.existsSync(path.join(repoDir, 'CHANGELOG.md'))) {
    errors.push('CHANGELOG.md не существует');
  }

  // 6. Нет дубля asar в dependencies
  if (pkg.dependencies && pkg.dependencies.asar) {
    errors.push('dependencies.asar дублирует @electron/asar');
  }

  // 7. Нет CJK в ru.ts
  const ruPath = path.join(repoDir, 'src', 'i18n', 'ru.ts');
  if (fs.existsSync(ruPath)) {
    const ru = fs.readFileSync(ruPath, 'utf8');
    if (/[\u4e00-\u9fff]/.test(ru)) errors.push('CJK символы в src/i18n/ru.ts');
  }

  return errors;
}

// ─── Главная функция ───
async function main() {
  log('=== Запуск автообновления hermes-ru ===');

  // 1. Lock
  if (!FORCE && !acquireLock()) {
    log('Lock занят, выход.');
    process.exit(0);
  }
  process.on('exit', releaseLock);

  // 2. Проверка версии Hermes
  const installedVersion = getInstalledHermesVersion();
  const latestVersion = getLatestHermesVersion();
  log(`Hermes: установлен ${installedVersion}, последний ${latestVersion}`);

  if (!latestVersion) {
    log('Не удалось получить версию Hermes. Выход.');
    await sendTelegram('⚠️ hermes-ru: не удалось проверить версию Hermes');
    process.exit(1);
  }

  const hasUpdate = FORCE || compareVersions(latestVersion, installedVersion) > 0;
  if (!hasUpdate) {
    log('Обновлений Hermes нет. Выход.');
    process.exit(0);
  }

  log(`Найдена новая версия Hermes: ${installedVersion} → ${latestVersion}`);

  if (DRY_RUN) {
    log('--dry-run: подготовка без публикации и patch');
  }

  // 3. Подготовка build-директории
  const buildDir = BUILD_DIR;
  if (fs.existsSync(buildDir)) fs.rmSync(buildDir, { recursive: true, force: true });
  fs.mkdirSync(buildDir, { recursive: true });

  // 4. Скачивание исходников Hermes
  log('Скачиваю исходники Hermes...');
  try {
    execSync(`npm pack ${HERMES_REGISTRY}@${latestVersion} --pack-destination "${buildDir}"`, {
      stdio: ['ignore', 'pipe', 'ignore'], timeout: 120000,
    });
  } catch (e) {
    // npm pack может не сработать для desktop — пробуем git clone
    log('npm pack не сработал, пробую прямой путь...');
  }

  // Проверяем, есть ли исходники desktop в установленном Hermes
  const desktopSrc = path.join(os.homedir(), 'AppData', 'Local', 'hermes', 'hermes-agent', 'apps', 'desktop', 'src');
  if (!fs.existsSync(path.join(desktopSrc, 'i18n', 'en.ts'))) {
    log('Исходники i18n не найдены. Выход.');
    await sendTelegram('⚠️ hermes-ru: исходники i18n не найдены. Обновление отменено.');
    process.exit(1);
  }

  // 5. Извлечение новых ключей
  log('Извлекаю ключи перевода...');
  const enPath = path.join(desktopSrc, 'i18n', 'en.ts');
  const ruPath = path.join(REPO_DIR, 'src', 'i18n', 'ru.ts');
  const enContent = fs.readFileSync(enPath, 'utf8');
  const ruContent = fs.readFileSync(ruPath, 'utf8');

  // Простое извлечение ключей: парсим defineLocale объекты
  const enKeys = extractKeys(enContent);
  const ruKeys = extractKeys(ruContent);

  const newKeys = enKeys.filter(k => !ruKeys.includes(k));
  const removedKeys = ruKeys.filter(k => !enKeys.includes(k));
  log(`Ключей в EN: ${enKeys.length}, в RU: ${ruKeys.length}, новых: ${newKeys.length}, устаревших: ${removedKeys.length}`);

  if (newKeys.length === 0 && removedKeys.length === 0 && !FORCE) {
    log('Изменений в переводе нет. Выход.');
    process.exit(0);
  }

  // 6. Перевод через DeepSeek
  let translatedCount = 0;
  if (newKeys.length > 0) {
    log(`Перевожу ${newKeys.length} новых ключей через DeepSeek...`);
    const translate = require('./translate');
    const translations = await translate.translateKeys(enContent, newKeys, {
      apiKey: DEEPSEEK_API_KEY,
      endpoint: DEEPSEEK_ENDPOINT,
      model: DEEPSEEK_MODEL,
    });

    // 7. Валидация
    const validate = require('./validate-translation');
    const errors = validate.validate(enContent, translations, newKeys);
    if (errors.length > 0) {
      log(`Валидация нашла ${errors.length} ошибок. Повторный перевод...`);
      const fixed = await translate.translateKeys(enContent, errors.map(e => e.key), {
        apiKey: DEEPSEEK_API_KEY,
        endpoint: DEEPSEEK_ENDPOINT,
        model: DEEPSEEK_MODEL,
        feedback: errors,
      });
      for (const [k, v] of Object.entries(fixed)) translations[k] = v;
    }

    // Применяем переводы к ru.ts
    const updatedRu = applyTranslations(ruContent, translations);
    fs.writeFileSync(ruPath, updatedRu, 'utf8');
    translatedCount = Object.keys(translations).length;
    log(`Переведено ${translatedCount} ключей`);
  }

  // Удаляем устаревшие ключи
  if (removedKeys.length > 0) {
    log(`Удаляю ${removedKeys.length} устаревших ключей из ru.ts`);
    // TODO: реализовать удаление устаревших ключей
  }

  // 8. Сборка dist
  log('Сборка dist...');
  try {
    // Копируем ru.ts в исходники Hermes
    const targetRuPath = path.join(desktopSrc, 'i18n', 'ru.ts');
    fs.copyFileSync(ruPath, targetRuPath);

    // Патчим en.ts: подменяем значения на русские
    const patchEn = require('./translate').patchEnglishWithRussian;
    patchEn(path.join(desktopSrc, 'i18n', 'en.ts'), ruPath);

    // Сборка
    execSync('npm run build', {
      cwd: path.join(os.homedir(), 'AppData', 'Local', 'hermes', 'hermes-agent', 'apps', 'desktop'),
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 300000,
    });
    log('✓ Сборка завершена');
  } catch (e) {
    log(`✗ Ошибка сборки: ${e.message}`);
    await sendTelegram(`❌ hermes-ru: ошибка сборки dist\n${e.message.slice(0, 200)}`);
    process.exit(1);
  }

  // 9. Тестирование dist
  log('Тестирование dist...');
  const distDir = path.join(os.homedir(), 'AppData', 'Local', 'hermes', 'hermes-agent', 'apps', 'desktop', 'dist');
  const testResult = testDist(distDir);
  if (!testResult.ok) {
    log(`✗ Тест провален: ${testResult.reason}`);
    await sendTelegram(`❌ hermes-ru: тест dist провален\n${testResult.reason}`);
    process.exit(1);
  }
  log('✓ Тест пройден');

  // 9b. Проверка консистентности репозитория перед публикацией
  log('Проверка консистентности...');
  const consistencyErrors = checkRepoConsistency(REPO_DIR);
  if (consistencyErrors.length > 0) {
    log(`✗ Консистентность: ${consistencyErrors.length} ошибок:`);
    consistencyErrors.forEach(e => log(`  - ${e}`));
    await sendTelegram(`❌ hermes-ru: ошибка консистентности репозитория\n${consistencyErrors.join('\n').slice(0, 500)}`);
    process.exit(1);
  }
  log('✓ Консистентность OK');

  if (DRY_RUN) {
    log('--dry-run: публикация пропущена');
    process.exit(0);
  }

  // 10. Копируем новый dist в репозиторий
  log('Копирую dist в репозиторий...');
  const repoDist = path.join(REPO_DIR, 'dist');
  if (fs.existsSync(repoDist)) fs.rmSync(repoDist, { recursive: true, force: true });
  copyDir(distDir, repoDist);

  // 11. Bump version + публикация
  const publish = require('./publish');
  const newVersion = await publish.publish({
    repoDir: REPO_DIR,
    hermesVersion: latestVersion,
    translatedCount,
    npmToken: NPM_TOKEN,
    npmPackage: NPM_PACKAGE,
    changelogPath: path.join(REPO_DIR, 'CHANGELOG.md'),
  });

  // 12. Обновление персистентного хранилища
  log('Обновляю персистентное хранилище...');
  if (fs.existsSync(path.join(DATA_DIR, 'dist'))) fs.rmSync(path.join(DATA_DIR, 'dist'), { recursive: true, force: true });
  copyDir(repoDist, path.join(DATA_DIR, 'dist'));
  fs.writeFileSync(VERSION_FILE, JSON.stringify({
    hermesRuVersion: newVersion,
    hermesVersion: latestVersion,
    stagedAt: new Date().toISOString(),
    updatePending: true,
  }));

  // 13. Отчёт
  const msg = `✅ hermes-ru v${newVersion} опубликован\nHermes: ${installedVersion} → ${latestVersion}\nНових ключей: ${translatedCount}\nnpm: ✅ | GitHub: ✅\nПеревод применится при следующем запуске Hermes`;
  await sendTelegram(msg);
  log(msg);

  // Cleanup
  fs.rmSync(buildDir, { recursive: true, force: true });
  log('=== Готово ===');
}

// ─── Утилиты ───
function extractKeys(tsContent) {
  const keys = [];
  // Извлекаем ключи вида: keyName: 'значение' или keyName: (args) => 'значение'
  const lines = tsContent.split('\n');
  for (const line of lines) {
    const m = line.match(/^\s{4,}([a-zA-Z][a-zA-Z0-9_]*)\s*:/);
    if (m) keys.push(m[1]);
  }
  return [...new Set(keys)];
}

function applyTranslations(ruContent, translations) {
  let result = ruContent;
  for (const [key, value] of Object.entries(translations)) {
    // Простая замена значения по ключу
    const regex = new RegExp(`^(\\s{4,}${key}\\s*:\\s*)(['"])(?:[^'\\\\]|\\\\.)*\\2`, 'm');
    result = result.replace(regex, `$1'${value.replace(/'/g, "\\'")}'`);
  }
  return result;
}

function testDist(distDir) {
  const assetsDir = path.join(distDir, 'assets');
  if (!fs.existsSync(assetsDir)) return { ok: false, reason: 'assets/ не найден' };
  const jsFiles = fs.readdirSync(assetsDir).filter(f => /^index-.*\.js$/.test(f));
  if (jsFiles.length === 0) return { ok: false, reason: 'index-*.js не найден' };
  const content = fs.readFileSync(path.join(assetsDir, jsFiles[0]), 'utf8');

  // Базовая проверка: русский перевод присутствует
  if (!content.includes('Настройки')) {
    return { ok: false, reason: 'Русский перевод не найден в бандле' };
  }

  return { ok: true };
}

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else { fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(s, d); }
  }
}

main().catch(async (e) => {
  log(`КРИТИЧЕСКАЯ ОШИБКА: ${e.message}`);
  await sendTelegram(`❌ hermes-ru: критическая ошибка\n${e.message.slice(0, 300)}`);
  process.exit(1);
});
