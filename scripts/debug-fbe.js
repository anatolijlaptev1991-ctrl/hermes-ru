'use strict';
// debug-fbe.js — наивный findBlockEnd на пакетном ru.ts: где заканчивается settings?
const fs = require('fs');
const src = fs.readFileSync('C:/Users/anato.ANATOLY/hermes-ru/src/i18n/ru.ts', 'utf8');
function fbe(out, startIdx) {
  let depth = 0;
  let j = out.indexOf('{', startIdx);
  for (; j < out.length; j++) {
    if (out[j] === '{') depth++;
    else if (out[j] === '}') {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}
const settingsStart = src.search(/\n\s+settings:\s*\{/);
const settingsEnd = fbe(src, settingsStart);
console.log('settingsStart:', settingsStart, 'settingsEnd:', settingsEnd, 'total:', src.length);
console.log('--- вокруг settingsEnd ---');
console.log(JSON.stringify(src.slice(settingsEnd - 150, settingsEnd + 30)));
// найдём первый небалансирующий литерал: грубая проверка — вырежем строки и пересчитаем
function stripStrings(s) {
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      out += 'S';
      i++;
      while (i < n) {
        if (s[i] === '\\') { i += 2; continue; }
        if (s[i] === q) { i++; break; }
        if (q === '`' && s[i] === '$' && s[i + 1] === '{') {
          out += '{'; // сохраняем баланс шаблонов
          i += 2;
          let d = 1;
          while (i < n && d > 0) {
            if (s[i] === '{') d++;
            else if (s[i] === '}') d--;
            if (d > 0) out += s[i];
            i++;
          }
          out += '}';
          continue;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
const stripped = stripStrings(src);
const se2 = fbe(stripped, settingsStart);
console.log('settingsEnd после вырезания строк:', se2);
console.log('--- вокруг него ---');
console.log(JSON.stringify(src.slice(se2 - 150, se2 + 30)));
