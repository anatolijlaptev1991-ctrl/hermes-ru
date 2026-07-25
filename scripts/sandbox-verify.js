'use strict';
// sandbox-verify.js — прогон components-patch против КОПИИ реального дерева 0.19.0.
// Итеративно находит ВСЕ фантастические якоря до касания боевой установки.
const fs = require('fs');
const path = require('path');
const os = require('os');

const REAL = 'C:/Users/anato.ANATOLY/AppData/Local/hermes/hermes-agent/apps/desktop';
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-sandbox-'));
const cp = require('C:/Users/anato.ANATOLY/hermes-ru/src/components-patch.js');

// Копируем settings/ и i18n/ из реального дерева
for (const sub of ['src/app/settings', 'src/i18n']) {
  fs.cpSync(path.join(REAL, sub), path.join(sandbox, sub), { recursive: true });
}
// Эмулируем порядок engine: сначала пакетный ru.ts поверх (как делает i18n-патч),
// затем components-patch расширяет уже его.
fs.copyFileSync(
  'C:/Users/anato.ANATOLY/hermes-ru/src/i18n/ru.ts',
  path.join(sandbox, 'src/i18n/ru.ts')
);
console.log('sandbox:', sandbox);

try {
  const result = cp.applyComponentPatches(sandbox);
  console.log('✓ ПАТЧ ПРИМЕНИЛСЯ:', JSON.stringify(result, null, 1).slice(0, 600));
} catch (e) {
  console.log('✗ ЯКОРЬ:', e.message);
}
