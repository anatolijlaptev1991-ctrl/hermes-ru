'use strict';
// gen-type-blocks.js v2 — генерация TS-интерфейсов новых секций из ПЕСОЧНО-патченого en.ts
// (механическая консистенция: тип = структура en). Стрелки → (params) => string, строки → string.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { extractKeyPathsPrecise } = require('../tests/check_translation_contract.js');

const REAL = 'C:/Users/anato.ANATOLY/AppData/Local/hermes/hermes-agent/apps/desktop';
const cp = require('../src/components-patch.js');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-types-'));
for (const sub of ['src/app/settings', 'src/i18n']) {
  fs.cpSync(path.join(REAL, sub), path.join(sandbox, sub), { recursive: true });
}
cp.applyComponentPatches(sandbox);

const enSrc = fs.readFileSync(path.join(sandbox, 'src/i18n/en.ts'), 'utf8');
const vals = new Map();
extractKeyPathsPrecise(enSrc, null, 0, vals);

const SECTIONS = {
  moaTypeBlock: ['settings.model.moa.', 'moa'],
  billingTypeBlock: ['settings.billing.', 'billing'],
  customEndpointsTypeBlock: ['settings.customEndpoints.', 'customEndpoints'],
};

function typeOf(v) {
  const arrow = v.match(/^\(([^)]*)\)\s*=>/);
  if (arrow) return `(${arrow[1]}) => string`;
  const shortArrow = v.match(/^(\w+)\s*=>/);
  if (shortArrow) return `(${shortArrow[1]}: string) => string`;
  return 'string';
}

const out = [
  "'use strict';",
  '// СГЕНЕРИРОВАНО scripts/gen-type-blocks.js из песочно-патченого en.ts — НЕ редактировать вручную.',
  '',
];

for (const [constName, [prefix, blockName]] of Object.entries(SECTIONS)) {
  const flat = [];
  const nested = new Map(); // group -> [[leaf, v]]
  for (const [k, v] of vals) {
    if (!k.startsWith(prefix)) continue;
    const rest = k.slice(prefix.length);
    if (rest.includes('.')) {
      const [grp, leaf] = [rest.slice(0, rest.indexOf('.')), rest.slice(rest.indexOf('.') + 1)];
      if (!nested.has(grp)) nested.set(grp, []);
      nested.get(grp).push([leaf, v]);
    } else {
      flat.push([rest, v]);
    }
  }
  const parts = flat.map(([leaf, v]) => `      ${leaf}: ${typeOf(v)}`);
  for (const [grp, ents] of nested) {
    const inner = ents.map(([leaf, v]) => `        ${leaf}: ${typeOf(v)}`).join('\n');
    parts.push(`      ${grp}: {\n${inner}\n      }`);
  }
  out.push(`const ${constName} = \`${blockName}: {\n${parts.join('\n')}\n    }\`;`);
  out.push('');
}
out.push('module.exports = { moaTypeBlock, billingTypeBlock, customEndpointsTypeBlock };');
out.push('');

fs.writeFileSync(path.join(__dirname, '..', 'src', 'components-patch-type-blocks.js'), out.join('\n'), 'utf8');
console.log('✓ type blocks сгенерированы');
for (const [constName] of Object.entries(SECTIONS)) {
  const m = out.join('\n').match(new RegExp(constName + ' = `([\\s\\S]*?)`'));
  console.log(constName, '→', (m[1].match(/\n/g) || []).length, 'строк');
}
