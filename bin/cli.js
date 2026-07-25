#!/usr/bin/env node
'use strict';

const { commandInstall, commandUninstall, commandStatus, commandRepair, commandBuild, commandDoctor } = require('./patcher');
const fs = require('fs');
const path = require('path');

const VERSION = require('../package.json').version;

function logFlagFile() {
  const home = process.env.HERMES_HOME
    ? path.resolve(process.env.HERMES_HOME)
    : path.join(process.env.LOCALAPPDATA || require('os').homedir(), 'hermes');
  return path.join(home, 'russian-loc', '.log-enabled');
}

function commandLogOn() {
  const f = logFlagFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, '', 'utf8');
  console.log(`✓ Логирование включено: ${path.join(path.dirname(f), 'hermes-ru.log')}`);
}

function commandLogOff() {
  try { fs.unlinkSync(logFlagFile()); } catch { /* */ }
  console.log('✓ Логирование отключено.');
}

const HELP = `
hermes-ru v${VERSION} — Русская локализация Hermes Agent Desktop

Архитектура «штатный цикл»: патч живёт как обычные правки в исходниках
Hermes — штатный апдейтер сам переносит их при обновлениях, штатный
build-stamp сам триггерит пересборку. Никаких отдельных ярлыков и launcher'ов.

Использование:
  hermes-ru install            Установить русскую локаль (патч + язык + сборка*)
  hermes-ru install --no-build Только патч + язык (сборка — позже автоматически)
  hermes-ru build              Пересобрать app (только когда Hermes закрыт)
  hermes-ru status             Статус локали + что делать дальше
  hermes-ru repair             Перепатчить (после обновления Hermes / сбоя)
  hermes-ru uninstall          Вернуть английский интерфейс
  hermes-ru doctor             Диагностика окружения и якорей (dry-run)
  hermes-ru log-on / log-off   Лог в <HERMES_HOME>/russian-loc/hermes-ru.log
  hermes-ru help               Эта справка

* install запускает официальную сборку (hermes desktop --build-only), только
  если Hermes закрыт. Если Hermes запущен — просто перезапустите его позже:
  сборка произойдёт сама при запуске \`hermes desktop\` или \`hermes update\`,
  либо выполните \`hermes-ru build\` после закрытия.
`;

async function main() {
  const command = process.argv[2];
  const flags = process.argv.slice(3);
  const noBuild = flags.includes('--no-build');

  switch (command) {
    case 'install': return commandInstall({ noBuild });
    case 'uninstall': return commandUninstall({ noBuild });
    case 'status': return commandStatus();
    case 'repair': return commandRepair({ noBuild });
    case 'build': return commandBuild();
    case 'doctor': return commandDoctor();
    case 'log-on': return commandLogOn();
    case 'log-off': return commandLogOff();
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      console.log(HELP); return;
    default:
      console.error(`Неизвестная команда: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch(e => {
  console.error(`✗ Ошибка: ${e.message}`);
  process.exit(1);
});
