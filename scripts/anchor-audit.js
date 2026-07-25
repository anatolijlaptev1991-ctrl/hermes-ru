'use strict';
// anchor-audit.js — проверяет все простые якоря вида >Текст< из components-patch.js
// против РЕАЛЬНЫХ файлов 0.19.0 и показывает реальный контекст для каждого промаха.
const fs = require('fs');
const path = require('path');

const REAL_SETTINGS = 'C:/Users/anato.ANATOLY/AppData/Local/hermes/hermes-agent/apps/desktop/src/app/settings';
const patchSrc = fs.readFileSync('C:/Users/anato.ANATOLY/hermes-ru/src/components-patch.js', 'utf8');

// Собираем строковые литералы вида '>Текст<' (текст без < > и переводов строк)
const anchorRe = /'>([^'<>\n]{2,60})<'/g;
const anchors = new Set();
let m;
while ((m = anchorRe.exec(patchSrc))) anchors.add(m[1]);

const files = {
  'model-settings.tsx': fs.readFileSync(path.join(REAL_SETTINGS, 'model-settings.tsx'), 'utf8'),
  'custom-endpoints-settings.tsx': fs.readFileSync(path.join(REAL_SETTINGS, 'custom-endpoints-settings.tsx'), 'utf8'),
  'billing/index.tsx': fs.readFileSync(path.join(REAL_SETTINGS, 'billing', 'index.tsx'), 'utf8'),
  'billing/plans-view.tsx': fs.readFileSync(path.join(REAL_SETTINGS, 'billing', 'plans-view.tsx'), 'utf8'),
  'billing/use-billing-state.ts': fs.readFileSync(path.join(REAL_SETTINGS, 'billing', 'use-billing-state.ts'), 'utf8'),
  'billing/errors.ts': fs.readFileSync(path.join(REAL_SETTINGS, 'billing', 'errors.ts'), 'utf8'),
};

let bad = 0;
for (const text of anchors) {
  const hits = [];
  for (const [f, content] of Object.entries(files)) {
    if (content.includes(`>${text}<`)) hits.push(`${f} (inline)`);
    else if (new RegExp(`>\\s*\\n\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n`).test(content)) hits.push(`${f} (multiline)`);
  }
  if (!hits.length) {
    bad++;
    console.log(`✗ НИГДЕ: '${text}'`);
  } else if (!hits.some(h => h.includes('inline'))) {
    console.log(`~ многострочный: '${text}' → ${hits.join(', ')}`);
  }
}
console.log(`---\nВсего якорей: ${anchors.size}, полностью отсутствуют: ${bad}`);
