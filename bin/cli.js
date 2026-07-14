#!/usr/bin/env node
'use strict';

const { commandInstall, commandUninstall, commandStatus, commandRepair } = require('./patcher');

const command = process.argv[2];
const flags = process.argv.slice(3);
const restart = flags.includes('--restart') || flags.includes('-r');
const force = flags.includes('--force') || flags.includes('-f');

const HELP = `
hermes-ru — Русская локализация Hermes Agent Desktop

Использование:
  hermes-ru install           Установить русскую локализацию
  hermes-ru install --restart Установить И перезапустить Hermes (убьёт текущую сессию!)
  hermes-ru uninstall          Восстановить оригинальный Hermes (английский)
  hermes-ru status             Показать статус локализации
  hermes-ru repair             Принудительно перепатчить (после обновления Hermes)
  hermes-ru repair --restart   Перепатчить И перезапустить Hermes
  hermes-ru help               Эта справка

По умолчанию install/repair НЕ перезапускают Hermes — перезапустите
вручную через ярлык «Hermes (Русский)» на рабочем столе.
Флаг --restart нужен только для автоматического перезапуска.
`;

async function main() {
  switch (command) {
    case 'install':
      await commandInstall({ restart });
      break;
    case 'uninstall':
      await commandUninstall({ restart });
      break;
    case 'status':
      await commandStatus();
      break;
    case 'repair':
      await commandRepair({ restart });
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
