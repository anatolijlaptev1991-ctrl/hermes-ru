'use strict';

/**
 * hermes-ru — команды CLI (v1.0, архитектура «штатный цикл»).
 *
 * Никакого launcher'а, ярлыков и pending-очередей: патч живёт как обычные
 * uncommitted-правки git-дерева Hermes; штатный updater их переносит при
 * обновлениях (updates.non_interactive_local_changes=stash), а штатный
 * content-hash build stamp триггерит пересборку. Сборка — только официальным
 * `hermes desktop --build-only` и только когда Hermes.exe закрыт (запущенный
 * app сборка убивает — проверено в hermes_cli/main.py).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const engine = require('../src/patch-engine.js');

const VERSION = require('../package.json').version;

function log(msg) { console.log(`[hermes-ru] ${msg}`); }
function warn(msg) { console.warn(`[hermes-ru] ⚠ ${msg}`); }
function err(msg) { console.error(`[hermes-ru] ✗ ${msg}`); }
function ok(msg) { console.log(`[hermes-ru] ✓ ${msg}`); }

function isLogEnabled() {
  if (process.env.HERMES_RU_LOG === '1') return true;
  if (process.env.HERMES_RU_LOG === '0') return false;
  try { return fs.existsSync(path.join(engine.getDataDir(), '.log-enabled')); } catch { return false; }
}
function logFile(msg) {
  if (!isLogEnabled()) return;
  try {
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
    fs.appendFileSync(path.join(engine.getDataDir(), 'hermes-ru.log'), `[${ts}] ${msg}\n`, 'utf8');
  } catch { /* best effort */ }
}

function requireDesktopDir() {
  const dd = engine.findDesktopDir();
  if (!dd) {
    err('Hermes desktop не найден (apps/desktop с src/i18n). Установите Hermes из исходников: https://github.com/NousResearch/hermes-agent');
    process.exit(1);
  }
  return dd;
}

/** Печать контекста: версия Hermes + совместимость. Возвращает false, если патч запрещён. */
function compatGate(desktopDir) {
  const info = engine.detectHermes(desktopDir);
  const compat = engine.checkCompatibility(info);
  if (compat.status === 'supported') {
    ok(compat.reason);
    return true;
  }
  warn(compat.reason);
  const probe = engine.anchorsProbe(desktopDir);
  const bad = Object.entries(probe).filter(([, r]) => !r.ok);
  if (bad.length) {
    err('Якоря НЕ совпадают с этой версией Hermes — патч отменён, ничего не изменено:');
    for (const [f, r] of bad) console.error(`    ${f}: ${r.error}`);
    err('Обновите пакет: npm i -g @anatolijlaptev1991/hermes-ru@latest — или откройте issue.');
    return false;
  }
  ok('Все якоря совпали (dry-run). Версия не из compat.json, но структура i18n знакома — продолжаю.');
  return true;
}

/** Официальная пересборка desktop. Только при закрытом Hermes.exe! */
function runOfficialBuild() {
  const cli = engine.findHermesCli();
  if (!cli) {
    warn('hermes CLI не найден. Пересборку сделает штатный запуск: `hermes desktop` (или `hermes update`).');
    return false;
  }
  log('Запускаю официальную сборку: hermes desktop --build-only (2–10 минут)...');
  logFile('build start');
  const r = spawnSync(cli, ['desktop', '--build-only'], { stdio: 'inherit', timeout: 30 * 60 * 1000 });
  logFile(`build exit=${r.status}`);
  return r.status === 0;
}

function verifyRuntimeRu(desktopDir) {
  const dist = engine.runtimeDistDir(desktopDir);
  return engine.distLooksHealthy(dist) && engine.distContainsRussian(dist);
}

function buildOrInstruct(desktopDir, { noBuild = false } = {}) {
  if (noBuild) {
    log('Пересборка отложена (--no-build). При следующем запуске `hermes desktop` сборка произойдёт автоматически.');
    return;
  }
  if (engine.isHermesRunning()) {
    console.log('');
    warn('Hermes сейчас запущен — сборку НЕ запускаю (она закрыла бы приложение).');
    console.log('  Чтобы появился русский, выберите любой вариант:');
    console.log('    1) Закройте Hermes и выполните:  hermes-ru build');
    console.log('    2) Или просто запустите:         hermes desktop   (само соберёт при запуске)');
    console.log('    3) Или дождитесь `hermes update` — пересборка входит в обновление.');
    return;
  }
  if (runOfficialBuild()) {
    if (verifyRuntimeRu(desktopDir)) {
      ok('Сборка завершена, русский интерфейс подтверждён в приложении.');
    } else {
      warn('Сборка завершена, но русские строки в runtime не подтвердились. Запустите: hermes-ru status');
    }
  } else {
    warn('Официальная сборка не удалась. Ничего не сломано: патч на месте, повторите `hermes-ru build` или `hermes desktop` — сборка перезапустится.');
  }
}

// ---------------------------------------------------------------------------
// Команды
// ---------------------------------------------------------------------------

async function commandInstall({ noBuild = false } = {}) {
  console.log('╔══════════════════════════════════════════╗');
  console.log(`║  hermes-ru v${VERSION} — установка русской локали`);
  console.log('╚══════════════════════════════════════════╝\n');

  const mig = engine.migrateLegacyDataDir();
  if (mig.migrated) {
    log(`Миграция v0.22.x: перенесено ${mig.moved.join(', ') || '—'}; устаревшие файлы launcher-эпохи в ${mig.legacyDir} можно удалить.`);
  }

  const dd = requireDesktopDir();
  const analysis = engine.analyzeSources(dd);

  if (analysis.state === 'patched') {
    ok('Патч уже применён и валиден.');
  } else {
    if (analysis.state === 'partial') {
      err("Исходники в состоянии 'partial' (прошлый патч лёг криво). Сначала выполните: hermes-ru repair");
      process.exit(1);
    }
    if (!compatGate(dd)) process.exit(1);
    const r = engine.applyPatch(dd);
    ok(`Патч применён (${r.changed.join(', ')}). Снапшот: ${r.backupDir}`);
    logFile(`install patched: ${r.changed.join(',')}`);
  }

  const lang = engine.setConfigLanguage('ru');
  if (lang.ok) ok('display.language: ru (через hermes config set)');
  else { warn(`Язык не выставлен: ${lang.reason}`); if (lang.instruction) console.log('  ' + lang.instruction); }

  buildOrInstruct(dd, { noBuild });
}

async function commandRepair({ noBuild = false } = {}) {
  log('Ремонт: привожу исходники к чистому виду и патчу заново...');
  const dd = requireDesktopDir();
  engine.removePatch(dd);
  ok('Исходники очищены.');
  if (!compatGate(dd)) process.exit(1);
  const r = engine.applyPatch(dd);
  ok(`Патч применён заново (${r.changed.join(', ')}).`);
  logFile('repair done');
  const lang = engine.setConfigLanguage('ru');
  if (!lang.ok) warn(`Язык не выставлен: ${lang.reason || ''}`);
  buildOrInstruct(dd, { noBuild });
}

async function commandUninstall({ noBuild = false } = {}) {
  log('Восстановление оригинального (английского) интерфейса...');
  const dd = requireDesktopDir();
  const r = engine.removePatch(dd);
  ok(`Патч снят (метод: ${r.method}).`);
  logFile(`uninstall: ${r.method}`);
  const lang = engine.setConfigLanguage('en');
  if (lang.ok) ok('display.language: en');
  else warn('Язык не переключён (app при этом просто останется английским).');
  buildOrInstruct(dd, { noBuild });
}

async function commandBuild() {
  const dd = requireDesktopDir();
  const analysis = engine.analyzeSources(dd);
  if (analysis.state !== 'patched') {
    err('Патч не применён — собирать нечего. Сначала: hermes-ru install');
    process.exit(1);
  }
  if (engine.isHermesRunning()) {
    err('Hermes запущен. Закройте приложение и повторите: сборка заменяет файлы приложения и закрыла бы его.');
    process.exit(2);
  }
  if (runOfficialBuild() && verifyRuntimeRu(dd)) ok('Готово: русский интерфейс в приложении.');
  else warn('Сборка не подтверждена — смотрите вывод выше и hermes-ru status.');
}

async function commandStatus() {
  const dd = requireDesktopDir();
  const a = engine.analyzeSources(dd);
  const info = engine.detectHermes(dd);
  const cli = engine.findHermesCli();

  let language = '?';
  if (cli) {
    try {
      const out = require('child_process').execFileSync(cli, ['config', 'get', 'display.language'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 });
      language = out.trim().split(/\r?\n/).pop().trim();
    } catch { /* */ }
  }

  const runtimeRu = verifyRuntimeRu(dd);
  const running = engine.isHermesRunning();

  console.log('╔══════════════════════════════════════════╗');
  console.log(`║  hermes-ru v${VERSION} — статус`);
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  Hermes:           ${info.cliVersion || '?'} (commit ${String(info.gitHead || info.commit || '?').slice(0, 12)})`);
  console.log(`  Патч в исходниках: ${a.state}${a.orphanRuTs ? ' (сирота ru.ts — безвреден)' : ''}`);
  console.log(`  display.language: ${language}`);
  console.log(`  Русский в app:    ${runtimeRu ? 'да' : 'нет'}`);
  console.log(`  Hermes запущен:   ${running ? 'да' : 'нет'}`);

  let advice;
  if (a.state === 'partial') advice = 'Исходники повреждены частичным патчем → hermes-ru repair';
  else if (a.state === 'clean' && language !== 'ru') advice = 'Локаль не установлена → hermes-ru install';
  else if (a.state === 'clean') advice = 'Патч снят (после обновления Hermes?) → hermes-ru repair';
  else if (a.state === 'patched' && !runtimeRu && language !== 'ru') advice = 'display.language не ru → hermes config set display.language ru';
  else if (a.state === 'patched' && !runtimeRu) advice = running
    ? 'Патч применён, ждёт пересборки → закройте Hermes и: hermes-ru build (или запустите hermes desktop)'
    : 'Патч применён, ждёт пересборки → hermes-ru build';
  else advice = 'Всё в порядке — русская локаль активна.';
  console.log(`\n  → ${advice}`);
}

async function commandDoctor() {
  console.log(`hermes-ru doctor (v${VERSION})\n`);
  let fails = 0;
  const check = (name, okFlag, detail, remedy) => {
    console.log(`  ${okFlag ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!okFlag) { fails++; if (remedy) console.log(`      лечение: ${remedy}`); }
  };
  const warnCheck = (name, okFlag, detail) => {
    console.log(`  ${okFlag ? '✓' : '⚠'} ${name}${detail ? ` — ${detail}` : ''}`);
  };

  // Пути
  const home = engine.getHermesHome();
  check('HERMES_HOME', fs.existsSync(path.join(home, 'config.yaml')), home);
  const dd = engine.findDesktopDir();
  check('apps/desktop', !!dd, dd || 'не найден', 'установите Hermes из исходников');

  // Тулчейн
  const cli = engine.findHermesCli();
  check('hermes CLI', !!cli, cli || 'не найден');
  for (const [bin, args] of [['node', ['--version']], ['npm', ['--version']]]) {
    try {
      // execSync (shell): на Windows npm — это .cmd, execFile без shell его не поднимет
      const v = require('child_process').execSync(`${bin} ${args.join(' ')}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }).trim();
      check(bin, true, v);
    } catch { check(bin, false, 'не найден', `${bin} должен быть на PATH`); }
  }
  if (dd) {
    check('node_modules desktop', fs.existsSync(path.join(dd, 'node_modules')) || !!engine.findElectronExe(dd), '', 'cd apps/desktop && npm ci');
    check('electron скачан', !!engine.findElectronExe(dd), engine.findElectronExe(dd) ? 'найден (возможно, hoisted)' : '', 'переустановите зависимости desktop');
  }

  // Исходники и якоря
  if (dd) {
    const a = engine.analyzeSources(dd);
    check('состояние исходников', a.state !== 'partial', a.state, 'hermes-ru repair');
    const probe = engine.anchorsProbe(dd);
    for (const [f, r] of Object.entries(probe)) {
      check(`якорь ${f}`, r.ok, r.ok ? (r.idempotent ? 'ok' : 'ok (неидемпотентен!)') : r.error);
    }
    const info = engine.detectHermes(dd);
    const compat = engine.checkCompatibility(info);
    warnCheck('compat.json', compat.status === 'supported', `Hermes ${info.cliVersion || '?'} — ${compat.status}`);
  }

  // Настройки updater'а (выживание патча при обновлениях)
  if (cli) {
    try {
      const out = require('child_process').execFileSync(cli, ['config', 'get', 'updates.non_interactive_local_changes'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 }).trim();
      const val = out.split(/\r?\n/).pop().trim();
      warnCheck('updates.non_interactive_local_changes', val !== 'discard', val === 'discard' ? 'discard — патч будет стёрт при обновлении! рекомендуется: hermes config set updates.non_interactive_local_changes stash' : (val || 'stash (default)'));
    } catch { warnCheck('updates.non_interactive_local_changes', true, 'default (stash)'); }
  }
  try {
    const out = require('child_process').execFileSync('git', ['config', '--get', 'core.autocrlf'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }).trim();
    warnCheck('git core.autocrlf', true, out || 'не задан');
  } catch { /* */ }

  warnCheck('Hermes запущен', true, engine.isHermesRunning() ? 'да (сборка недоступна до закрытия)' : 'нет');

  console.log(`\n  Вердикт: ${fails === 0 ? 'READY — можно устанавливать (hermes-ru install)' : `BLOCKED — устраните ${fails} проблем выше`}`);
  process.exitCode = fails === 0 ? 0 : 1;
}

module.exports = {
  commandInstall,
  commandUninstall,
  commandStatus,
  commandRepair,
  commandBuild,
  commandDoctor,
};
