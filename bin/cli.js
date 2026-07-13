#!/usr/bin/env node
'use strict';

const { commandInstall, commandUninstall, commandStatus, commandRepair } = require('./patcher');

const command = process.argv[2];

const HELP = `
hermes-ru — Русская локализация Hermes Agent Desktop

Использование:
  hermes-ru install     Установить русскую локализацию
  hermes-ru uninstall   Восстановить оригинальный Hermes (английский)
  hermes-ru status      Показать статус локализации
  hermes-ru repair      Принудительно перепатчить (после обновления Hermes)
  hermes-ru help        Эта справка

После установки интерфейс Hermes Desktop будет на русском.
Локализация автоматически восстанавливается после обновлений Hermes
через механизм self-healing launcher.
`;

async function main() {
  switch (command) {
    case 'install':
      await commandInstall();
      break;
    case 'uninstall':
      await commandUninstall();
      break;
    case 'status':
      await commandStatus();
      break;
    case 'repair':
      await commandRepair();
      break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      console.log(HELP);
      break;
    default:
      console.error(`Неизвестная команда: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch(err => {
  console.error('✗ Ошибка:', err.message);
  process.exit(1);
});
