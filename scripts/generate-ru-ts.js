'use strict';
/**
 * generate-ru-ts.js — генерация src/i18n/ru.ts v1.0.0.
 *
 * Источники:
 *  - analysis-en-values.json  — эталон: порядок и структура en.ts (ключ → en-сниппет)
 *  - analysis-ru-values.json  — старые переводы (ключ → ru-сниппет)
 *  - scripts/ru-translations-v100.json — новые переводы v1.0.0 (ключ → ru-сниппет)
 *
 * Правило: идём по ключам en В ПОРЯДКЕ en.ts; значение = v100 ?? старый перевод.
 * Ключи старого ru, которых нет в en, отбрасываются (с отчётом). Так файл
 * получается полным, упорядоченным и гарантированно ⊆ en (контракт tsc).
 *
 * Пролог (import defineFieldCopy + ruPlural + import defineLocale) сохраняется
 * из прежнего ru.ts без изменений.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const enValues = JSON.parse(fs.readFileSync(path.join(ROOT, 'analysis-en-values.json'), 'utf8'));
const ruOld = JSON.parse(fs.readFileSync(path.join(ROOT, 'analysis-ru-values.json'), 'utf8'));
const ruNew = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'ru-translations-v100.json'), 'utf8'));
const { extractKeyPathsPrecise } = require('../tests/check_translation_contract.js');

// --- Спец-обработка defineFieldCopy-блоков: settings.fieldLabels / settings.fieldDescriptions.
// В en это ref-листья (fieldLabels: FIELD_LABELS), а их поддерево живёт в constants.ts.
// В ru — defineFieldCopy({...}) одним листом. Сливаем: старый блок + новые ключи v100,
// в порядке en-алиасов; старые ключи вне en отбрасываем.
const FIELD_COPY_PATHS = ['settings.fieldLabels', 'settings.fieldDescriptions'];

function parseInnerMap(snippet) {
  const vals = new Map();
  extractKeyPathsPrecise(snippet, null, 0, vals);
  return Object.fromEntries(vals);
}

function emitInner(node, depth) {
  const indent = '  '.repeat(depth);
  const lines = [];
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string') lines.push(`${indent}${bareOk.test(k) ? k : `'${k.replace(/'/g, "\\'")}'`}: ${v},`);
    else { lines.push(`${indent}${bareOk.test(k) ? k : `'${k}'`}: {`); lines.push(emitInner(v, depth + 1)); lines.push(`${indent}},`); }
  }
  return lines.join('\n');
}

const bareOk = /^[A-Za-z_$][\w$]*$/;
const mergedFieldCopy = {};
const droppedInner = {};
for (const p of FIELD_COPY_PATHS) {
  const innerOld = ruOld[p] ? parseInnerMap(ruOld[p]) : {};
  const innerNew = {};
  for (const [k, v] of Object.entries(ruNew)) {
    if (k.startsWith(p + '.')) innerNew[k.slice(p.length + 1)] = v;
  }
  const enInner = Object.keys(enValues).filter(k => k.startsWith(p + '.')).map(k => k.slice(p.length + 1));
  const tree = {};
  const usedInner = new Set();
  for (const ik of enInner) {
    const snippet = innerNew[ik] !== undefined ? innerNew[ik] : innerOld[ik];
    if (snippet === undefined) { (droppedInner[p] = droppedInner[p] || []).push(ik); continue; }
    usedInner.add(ik);
    const parts = ik.split('.');
    let node = tree;
    for (let d = 0; d < parts.length - 1; d++) node = node[parts[d]] = node[parts[d]] || {};
    node[parts[parts.length - 1]] = snippet;
  }
  const unused = Object.keys(innerOld).filter(k => !usedInner.has(k));
  if (unused.length) droppedInner[p + ' (старые вне en)'] = unused;
  mergedFieldCopy[p] = `defineFieldCopy({\n${emitInner(tree, 3).replace(/,(\n\s*[}\]])/g, '$1')}\n    })`;
}

// --- Пролог прежнего ru.ts: всё до `export const ru = defineLocale({`
const oldSrc = fs.readFileSync(path.join(ROOT, 'src', 'i18n', 'ru.ts'), 'utf8');
const marker = 'export const ru = defineLocale({';
const markerAt = oldSrc.indexOf(marker);
if (markerAt < 0) { console.error('Не найден маркер defineLocale в старом ru.ts'); process.exit(1); }
const prologue = oldSrc.slice(0, markerAt);

// --- Дерево из dot-paths в порядке en
const root = {};
const order = Object.keys(enValues);
const used = new Set();
const dropped = [];

for (const keyPath of order) {
  if (FIELD_COPY_PATHS.some(p => keyPath.startsWith(p + '.'))) continue; // покрыто блоком defineFieldCopy
  let snippet = mergedFieldCopy[keyPath];
  if (snippet === undefined) snippet = ruNew[keyPath];
  if (snippet === undefined && ruOld[keyPath] !== undefined) {
    snippet = ruOld[keyPath];
    used.add(keyPath);
  }
  // Ключи с \u0001 (quoted dot-keys, напр. keybinds.actions.'keybinds\u0001openPanel'):
  // в старом ru они жили как вложенные (keybinds.actions.keybinds.openPanel) — пробуем и эту форму.
  if (snippet === undefined && keyPath.includes('\u0001')) {
    const alt = keyPath.replace(/\u0001/g, '.');
    if (ruOld[alt] !== undefined) { snippet = ruOld[alt]; used.add(alt); }
  }
  if (snippet === undefined) {
    dropped.push(keyPath); // не должно случиться: missing 365 = |v100|
    continue;
  }
  const parts = keyPath.split('.').map(s => s.replace(/\u0001/g, '.'));
  let node = root;
  for (let d = 0; d < parts.length - 1; d++) {
    node = node[parts[d]] = node[parts[d]] || {};
  }
  node[parts[parts.length - 1]] = snippet;
}

// Отчёт о неиспользованных старых ключах (кроме тех, что совпали по пути)
const unusedOld = Object.keys(ruOld).filter(k => !used.has(k) && !(k in enValues));

// --- Эмиссия
const keyName = (k) => (bareOk.test(k) ? k : `'${k.replace(/'/g, "\\'")}'`);

function emit(node, depth) {
  const indent = '  '.repeat(depth);
  const lines = [];
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string') {
      lines.push(`${indent}${keyName(k)}: ${v},`);
    } else {
      lines.push(`${indent}${keyName(k)}: {`);
      lines.push(emit(v, depth + 1));
      lines.push(`${indent}},`);
    }
  }
  return lines.join('\n');
}

const body = emit(root, 1).replace(/,(\n\s*[}\]])/g, '$1'); // убрать висячие запятые
const out = `${prologue}${marker}\n${body}\n})\n`;

const target = path.join(ROOT, 'src', 'i18n', 'ru.ts');
fs.writeFileSync(target, out, 'utf8');

console.log(`✓ ru.ts сгенерирован: ${order.length - dropped.length} ключей (en: ${order.length})`);
console.log(`  из старых: ${used.size}; из v1.0.0: ${order.length - dropped.length - used.size}`);
if (dropped.length) {
  console.error(`✗ Ключи без перевода (${dropped.length}): ${dropped.slice(0, 10).join(', ')}${dropped.length > 10 ? '…' : ''}`);
  process.exit(1);
}
if (unusedOld.length) {
  console.log(`  отброшено старых ключей вне en: ${unusedOld.length}${unusedOld.length <= 5 ? ' (' + unusedOld.join(', ') + ')' : ''}`);
}
