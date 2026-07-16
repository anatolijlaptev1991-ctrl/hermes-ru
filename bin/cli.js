#!/usr/bin/env node
'use strict';

const { commandInstall, commandUninstall, commandStatus, commandRepair } = require('./patcher');
const fs = require('fs');
const path = require('path');
const os = require('os');

const LOG_ENABLED_FILE = path.join(os.homedir(), '.hermes', 'russian-loc', '.log-enabled');

function commandLogOn() {
  fs.mkdirSync(path.dirname(LOG_ENABLED_FILE), { recursive: true });
  fs.writeFileSync(LOG_ENABLED_FILE, '', 'utf8');
  console.log('✓ Логирование включено. Лог: ~/.hermes/russian-loc/hermes-ru.log');
  console.log('  Отключить: hermes-ru log-off');
}

function commandLogOff() {
  try { fs.unlinkSync(LOG_ENABLED_FILE); } catch {}
  console.log('✓ Логирование отключено.');
  console.log('  Включить: hermes-ru log-on');
}

const command = process.argv[2];
const flags = process.argv.slice(3);
const restart = flags.includes('--restart') || flags.includes('-r');
const force = flags.includes('--force') || flags.includes('-f');

const HELP = `
hermes-ru — Русская локализация Hermes Agent Desktop

Использование:
  hermes-ru install           Установить русскую локализацию
  hermes-ru install --restart Установить (перепатчит при следующем запуске через ярлык)
  hermes-ru uninstall          Восстановить оригинальный Hermes (английский)
  hermes-ru status             Показать статус локализации
  hermes-ru repair             Принудительно перепатчить (после обновления Hermes)
  hermes-ru repair --restart   Перепатчить (применится при следующем запуске через ярлык)
  hermes-ru log-on             Включить логирование в файл
  hermes-ru log-off            Отключить логирование
  hermes-ru help               Эта справка

По умолчанию install/repair НЕ перезапускают Hermes — перезапустите
вручную через ярлык «Hermes RU» на рабочем столе.
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
    case 'log-on':
      commandLogOn();
      break;
    case 'log-off':
      commandLogOff();
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
