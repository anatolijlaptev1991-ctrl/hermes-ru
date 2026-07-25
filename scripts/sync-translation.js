'use strict';
/**
 * sync-translation.js — анализ рассинхрона ru.ts ↔ en.ts + рабочий файл для перевода.
 *
 * Артефакты:
 *  - analysis-stale-keys.txt     — ключи ru, которых нет в en (удалить из ru.ts)
 *  - analysis-missing-keys.txt   — ключи en без перевода
 *  - analysis-todo.md            — рабочий файл: для каждого missing-ключа en-сниппет
 *  - analysis-en-values.json     — все en ключи → исходный сниппет значения (для генератора)
 *  - analysis-ru-values.json     — все ru ключи → исходный сниппет значения (для генератора)
 */
const fs = require('fs');
const path = require('path');
const engine = require('../src/patch-engine.js');
const { extractKeyPathsPrecise } = require('../tests/check_translation_contract.js');

const dd = engine.findDesktopDir();
if (!dd) { console.error('Hermes desktop не найден'); process.exit(1); }
const loadImport = (spec) => { try { return fs.readFileSync(path.join(dd, 'src', spec.replace(/^@\//, '') + '.ts'), 'utf8'); } catch { return null; } };

const enValues = new Map();
const en = extractKeyPathsPrecise(fs.readFileSync(path.join(dd, 'src', 'i18n', 'en.ts'), 'utf8'), loadImport, 0, enValues);
const ruValues = new Map();
const ru = extractKeyPathsPrecise(fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n', 'ru.ts'), 'utf8'), loadImport, 0, ruValues);

const stale = [...ru].filter(k => !en.has(k)).sort();
const missing = [...en].filter(k => !ru.has(k)); // порядок = порядок en.ts

const out = (name, content) => fs.writeFileSync(path.join(__dirname, '..', name), content);
out('analysis-stale-keys.txt', stale.join('\n') + '\n');
out('analysis-missing-keys.txt', missing.join('\n') + '\n');
out('analysis-en-values.json', JSON.stringify(Object.fromEntries(enValues), null, 1));
out('analysis-ru-values.json', JSON.stringify(Object.fromEntries(ruValues), null, 1));

// TODO-файл, сгруппированный по секциям
let todo = `# TODO перевода hermes-ru v1.0.0 — ${missing.length} ключей\n\n`;
let section = '';
let idx = 0;
for (const k of missing) {
  const top = k.split('.')[0];
  if (top !== section) { section = top; todo += `\n## ${section}\n\n`; }
  idx++;
  const v = enValues.get(k) || '(ref)';
  todo += `### ${idx}. \`${k}\`\n\`\`\`ts\n${v}\n\`\`\`\n`;
}
out('analysis-todo.md', todo);

console.log(`en: ${en.size}  ru: ${ru.size}  stale: ${stale.length}  missing: ${missing.length}`);
if (stale.length) console.log('stale:', stale.join(', '));
