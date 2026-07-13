'use strict';

/**
 * postinstall.js — Авто-запуск при npm install -g hermes-ru
 *
 * Не патчит автоматически — только показывает подсказку.
 * Пользователь должен сознательно запустить hermes-ru install.
 */

console.log('');
console.log('╔══════════════════════════════════════════════════╗');
console.log('║  hermes-ru установлен!                           ║');
console.log('║                                                  ║');
console.log('║  Для активации русской локализации выполните:    ║');
console.log('║                                                  ║');
console.log('║    hermes-ru install                             ║');
console.log('║                                                  ║');
console.log('║  Другие команды:                                 ║');
console.log('║    hermes-ru status   — проверить статус         ║');
console.log('║    hermes-ru uninstall — вернуть английский      ║');
console.log('║    hermes-ru repair   — перепатчить после update ║');
console.log('╚══════════════════════════════════════════════════╝');
console.log('');
