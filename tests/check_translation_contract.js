'use strict';

/**
 * Контрактный тест перевода: каждый ключ ru.ts существует в en.ts.
 *
 * Токенизер (не regex по тексту): пропускает строки (' " `), шаблонные
 * ${…}-вставки и комментарии, трекает глубину объектов — поэтому корректно
 * работает с интерполяторами-функциями и вложенными деревьями.
 *
 * ru ⊆ en — жёсткое требование (иначе TS-сборка упадёт: "unknown property").
 * en ⊄ ru — информационно: defineLocale подставит английский (штатный fallback).
 *
 * Финальный арбитр контракта — `npm run build` в apps/desktop (tsc); этот тест
 * даёт быстрый ответ без тулчейна.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

/** Собрать dot-paths всех ключей объекта из TS-файла локали (точный проход).
 *  Поддерживает const-референсы: `fieldLabels: FIELD_LABELS` резолвится —
 *  ищется `const FIELD_LABELS = {…}` в этом файле и в файлах `@/…`-импортов
 *  (алиас @/ → <desktop>/src/, резолвер передаётся параметром). */
function extractKeyPathsPrecise(source, loadImport = null, _depth = 0, outValues = null) {
  // Проход 0: top-level const-объекты (const X = { … }) — их поддеревья.
  const constTrees = {};
  const constTreeSources = {};
  const pendingName = [];

  const collectConsts = (src) => {
    const constRe = /^(?:export\s+)?const\s+([A-Z_][A-Z0-9_]*)\s*(?::[^=]+)?=\s*(?:[A-Za-z_$][\w$]*\s*\(\s*)?\{/gm;
    let cm;
    while ((cm = constRe.exec(src)) !== null) {
      const name = cm[1];
      if (constTreeSources[name]) continue;
      const braceAt = src.indexOf('{', cm.index + cm[0].length - 1);
      let depth = 0;
      let j = braceAt;
      let end = -1;
      while (j < src.length) {
        const ch = src[j];
        if (ch === "'" || ch === '"' || ch === '`') {
          const q = ch; j++;
          while (j < src.length && src[j] !== q) { if (src[j] === '\\') j++; j++; }
        } else if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) { end = j; break; } }
        j++;
      }
      if (end > 0) {
        constTreeSources[name] = src.slice(braceAt, end + 1);
        constTrees[name] = true;
      }
    }
  };

  collectConsts(source);

  // Импорты `@/…`: подтянуть const-объекты из внешних файлов (глубина ≤ 1)
  if (loadImport && _depth === 0) {
    const importRe = /^import\s*\{([^}]+)\}\s*from\s*'(@\/[^']+)'/gm;
    let im;
    while ((im = importRe.exec(source)) !== null) {
      const ext = loadImport(im[2]);
      if (ext) collectConsts(ext);
    }
  }

  const keys = new Set();
  const stack = [];
  let i = 0;
  const n = source.length;

  const skipString = (quote) => {
    i++;
    while (i < n) {
      const c = source[i];
      if (c === '\\') { i += 2; continue; }
      if (c === quote) { i++; return; }
      if (quote === '`' && c === '$' && source[i + 1] === '{') {
        i += 2;
        let depth = 1;
        while (i < n && depth > 0) {
          if (source[i] === '{') depth++;
          else if (source[i] === '}') depth--;
          else if (source[i] === "'" || source[i] === '"' || source[i] === '`') skipString(source[i]);
          else i++;
        }
        continue;
      }
      i++;
    }
  };

  /** Прочитать quoted-строку как токен (для ключей 'with-dash').
   *  Точки внутри quoted-ключа (напр. 'keybinds.openPanel') — это ЧАСТЬ ИМЕНИ,
   *  а не вложенность: кодируем их сентинелом \u0001, чтобы сплит путей по '.'
   *  не разрывал такой ключ (иначе tsc: object vs string). */
  const readQuoted = () => {
    const q = source[i];
    i++;
    let s = '';
    while (i < n && source[i] !== q) {
      if (source[i] === '\\') { s += source[i + 1]; i += 2; continue; }
      s += source[i]; i++;
    }
    i++;
    return s.replace(/\./g, '\u0001');
  };

  /** Пропустить значение-выражение целиком от позиции `start`:
   *  стоп на top-level ',' или на '}'/'')'/']' родителя (его не потребляем). */
  const skipValue = (start) => {
    let k = start;
    let depth = 0;
    while (k < n) {
      const ch = source[k];
      if (ch === "'" || ch === '"' || ch === '`') {
        const q = ch; k++;
        while (k < n) {
          if (source[k] === '\\') { k += 2; continue; }
          if (source[k] === q) { k++; break; }
          if (q === '`' && source[k] === '$' && source[k + 1] === '{') {
            k += 2;
            let d = 1;
            while (k < n && d > 0) {
              if (source[k] === '{') d++;
              else if (source[k] === '}') d--;
              else if (source[k] === "'" || source[k] === '"' || source[k] === '`') {
                const q2 = source[k]; k++;
                while (k < n && source[k] !== q2) { if (source[k] === '\\') k++; k++; }
              }
              k++;
            }
            continue;
          }
          k++;
        }
        continue;
      }
      if (ch === '/' && source[k + 1] === '/') { while (k < n && source[k] !== '\n') k++; continue; }
      if (ch === '/' && source[k + 1] === '*') { while (k < n && !(source[k] === '*' && source[k + 1] === '/')) k++; k += 2; continue; }
      if (ch === '{' || ch === '(' || ch === '[') { depth++; k++; continue; }
      if (ch === '}' || ch === ')' || ch === ']') {
        if (depth === 0) return k; // закрывающая скобка родителя — стоп, не потребляем
        depth--; k++; continue;
      }
      if (ch === ',' && depth === 0) return k; // конец значения
      k++;
    }
    return k;
  };

  while (i < n) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') { while (i < n && source[i] !== '\n') i++; continue; }
    if (c === '/' && source[i + 1] === '*') { while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++; i += 2; continue; }

    if (c === '{') {
      const pending = pendingName.find(p => p.depth === stack.length && !p.used);
      if (pending) { stack.push(pending.name); pending.used = true; }
      else stack.push(null);
      i++;
      continue;
    }
    if (c === '}') { stack.pop(); i++; continue; }

    // Ключ: quoted или bare identifier
    if (c === "'" || c === '"' || /[\w$]/.test(c)) {
      let name;
      if (c === "'" || c === '"') {
        const save = i;
        name = readQuoted();
        // Если после quoted-строки НЕ двоеточие — это была просто строка: пропускаем
        let j = i;
        while (j < n && /\s/.test(source[j])) j++;
        if (source[j] !== ':') { i = save; skipString(source[i]); continue; }
      } else {
        name = '';
        while (i < n && /[\w$-]/.test(source[i])) { name += source[i]; i++; }
      }
      while (i < n && /\s/.test(source[i])) i++;
      if (source[i] === ':' && source[i + 1] !== ':') {
        let j = i + 1;
        while (j < n && /\s/.test(source[j])) j++;
        // Модульный уровень: `export const en: Translations = {…}` — это декларация,
        // а не ключ локали. Переходим сразу к '{' после '=' (объект обойдём по именам).
        if (stack.length === 0) {
          let k = j;
          while (k < n && source[k] !== '=' && source[k] !== '{' && source[k] !== ',' && source[k] !== '\n') k++;
          if (source[k] === '=') {
            let m2 = k + 1;
            while (m2 < n && /\s/.test(source[m2])) m2++;
            if (source[m2] === '{') { i = m2; continue; }
          }
          i = skipValue(j);
          continue;
        }
        // Значение — объект?
        if (source[j] === '{') {
          pendingName.push({ depth: stack.length, name, used: false });
          i = j;
          continue;
        }
        // Значение — локальная листовая сущность? (строка/шаблон/число/(/стрелка/вызов/булевы)
        // Иначе это TS-аннотация типа (count: number) или shorthand — НЕ ключ локали.
        const rest = source.slice(j, j + 200);
        const pathParts = stack.filter(Boolean);
        // const-референс: key: FIELD_LABELS → лист + алиасы поддерева
        const refMatch = rest.match(/^([A-Z_][A-Z0-9_]*)\b/);
        if (refMatch && constTrees[refMatch[1]]) {
          keys.add([...pathParts, name].join('.'));
          if (outValues) outValues.set([...pathParts, name].join('.'), refMatch[1]);
          const subValues = outValues ? new Map() : null;
          const sub = extractKeyPathsPrecise(constTreeSources[refMatch[1]], null, 0, subValues);
          for (const sk of sub) {
            const alias = [...pathParts, name, ...sk.split('.')].join('.');
            keys.add(alias);
            if (outValues && subValues.has(sk)) outValues.set(alias, subValues.get(sk));
          }
          i = skipValue(j);
          continue;
        }
        const isLeaf =
          /^['"`\-(\d]/.test(rest) ||
          /^(true|false|null|undefined)\b/.test(rest) ||
          /^[A-Za-z_$][\w$]*\s*=>/.test(rest) ||          // n => …
          /^[A-Za-z_$][\w$]*\s*\(/.test(rest) ||          // defineFieldCopy(…)
          /^[A-Za-z_$][\w$]*\s*\[/.test(rest);            // arr[0]
        if (isLeaf) {
          const keyPath = [...pathParts, name].join('.');
          keys.add(keyPath);
          const end = skipValue(j);
          const snippet = source.slice(j, end).trim();
          if (outValues) outValues.set(keyPath, snippet);
          // defineFieldCopy({...}) — разворачиваем внутренности в под-пути,
          // чтобы метрика покрытия (en не в ru) была честной
          if (/^defineFieldCopy\s*\(/.test(snippet)) {
            const innerVals = new Map();
            extractKeyPathsPrecise(snippet, null, 0, innerVals);
            for (const ik of innerVals.keys()) keys.add(`${keyPath}.${ik}`);
          }
        }
        // Пропускаем значение ЦЕЛИКОМ (стрелки/вызовы/тернарники внутри не ходим) —
        // иначе тернарники `? 'a' : 'b'` в телах функций рождают фантомные ключи.
        i = skipValue(j);
        continue;
      }
      continue;
    }
    i++;
  }
  return keys;
}

function loadReal(file) {
  return fs.readFileSync(file, 'utf8');
}

const PKG_RU = path.resolve(__dirname, '..', 'src', 'i18n', 'ru.ts');

test('контракт: все ключи ru.ts существуют в en.ts (реальный Hermes, если доступен)', (t) => {
  const engine = require('../src/patch-engine.js');
  const dd = engine.findDesktopDir();
  if (!dd) { t.skip('Hermes desktop не установлен — пропуск (в CI нет Hermes)'); return; }
  const enPath = path.join(dd, 'src', 'i18n', 'en.ts');
  const loadImport = (spec) => {
    const p = path.join(dd, 'src', spec.replace(/^@\//, '') + '.ts');
    try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
  };

  const enKeys = extractKeyPathsPrecise(loadReal(enPath), loadImport);
  const ruKeys = extractKeyPathsPrecise(loadReal(PKG_RU), loadImport);

  const ruNotInEn = [...ruKeys].filter(k => !enKeys.has(k));
  const enNotInRu = [...enKeys].filter(k => !ruKeys.has(k));

  console.log(`  en.ts: ${enKeys.size} ключей; ru.ts: ${ruKeys.size} ключей`);
  console.log(`  en без перевода (fallback в английский, не блокер): ${enNotInRu.length}`);
  if (enNotInRu.length && enNotInRu.length <= 30) {
    for (const k of enNotInRu) console.log(`    - ${k}`);
  }
  assert.deepEqual(ruNotInEn, [], `Ключи ru.ts, ОТСУТСТВУЮЩИЕ в en.ts (сломают tsc):\n${ruNotInEn.join('\n')}`);
});

test('контракт: токенизер на мини-фикстуре', () => {
  const src = `export const x = defineLocale({
  common: {
    apply: 'Apply',
    count: (n: number) => \`\${n} items\`,
    nested: { deep: { leaf: 'x' } },
    'with-dash': { ok: true },
  },
})`;
  const keys = extractKeyPathsPrecise(src);
  assert.ok(keys.has('common.apply'));
  assert.ok(keys.has('common.count'));
  assert.ok(keys.has('common.nested.deep.leaf'));
  assert.ok(keys.has('common.with-dash.ok'));
});

module.exports = { extractKeyPathsPrecise };
