'use strict';
/**
 * validate-translation.js — 5-чек валидатор перевода
 *
 * Проверки:
 * 1. structural diff: en.keys == ru.keys (новые ключи покрыты)
 * 2. placeholder preservation: {var}/${var} в EN == в RU
 * 3. empty value check: ни одно значение != ''
 * 4. CJK contamination: [\u4e00-\u9fff] → reject
 * 5. calque detection: "-инг"/"-tion" в русских словах → flag
 */

// Проверяет переводы перед записью в ru.ts
function validate(enContent, translations, keysToCheck) {
  const errors = [];

  for (const key of keysToCheck) {
    const translated = translations[key];
    if (!translated) {
      errors.push({ key, type: 'MISSING', message: `Ключ ${key} не переведён` });
      continue;
    }

    const enVal = extractValue(enContent, key);
    if (!enVal) continue;

    // 3. Empty check
    if (!translated.trim()) {
      errors.push({ key, type: 'EMPTY', message: `Пустой перевод для ${key}` });
    }

    // 4. CJK check
    if (/[\u4e00-\u9fff]/.test(translated)) {
      errors.push({ key, type: 'CJK', message: `CJK символы в переводе: ${translated.slice(0, 50)}` });
    }

    // 2. Placeholder preservation
    const enPlaceholders = (enVal.match(/\$\{[^}]+\}|\{[^}]+\}/g) || []).sort();
    const ruPlaceholders = (translated.match(/\$\{[^}]+\}|\{[^}]+\}/g) || []).sort();
    if (JSON.stringify(enPlaceholders) !== JSON.stringify(ruPlaceholders)) {
      errors.push({
        key, type: 'PLACEHOLDER',
        message: `Плейсхолдеры не совпадают. EN: ${enPlaceholders.join(',')} | RU: ${ruPlaceholders.join(',')}`,
      });
    }

    // 5. Calque detection
    const calques = translated.match(/[а-яёА-ЯЁ]+(?:инг|тион|ингом|инге|тионный)/gi);
    if (calques) {
      errors.push({ key, type: 'CALQUE', message: `Калька: ${calques.join(', ')}` });
    }

    // Длина > 1.5×
    if (enVal.length > 10 && translated.length > enVal.length * 1.5) {
      errors.push({
        key, type: 'TOO_LONG',
        message: `Перевод слишком длинный: EN=${enVal.length} RU=${translated.length}`,
      });
    }
  }

  return errors;
}

function extractValue(tsContent, key) {
  const regex = new RegExp(`(?:^|\\n)\\s*${key}\\s*:\\s*(['"])((?:[^'\\\\]|\\\\.)*)\\1`);
  const m = tsContent.match(regex);
  if (m) return m[2];

  const funcRegex = new RegExp(`(?:^|\\n)\\s*${key}\\s*:\\s*\\([^)]*\\)\\s*=>\\s*\`([^\`]*)\``);
  const fm = tsContent.match(funcRegex);
  if (fm) return fm[1];

  return null;
}

module.exports = { validate };
