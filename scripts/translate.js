'use strict';
/**
 * translate.js — Перевод строк через DeepSeek V4 Flash Free (opencode-zen)
 */

const https = require('https');
const fs = require('fs');

const PROMPT_SYSTEM = `Ты профессиональный переводчик интерфейсов с английского на русский.

Переведи строки интерфейса AI-ассистента Hermes на русский язык.

ПРАВИЛА:
1. ПЛЕЙСХОЛДЕРЫ \${...} и {...} — НЕ переводить, не удалять, не менять имя переменной
2. ТЕРМИНЫ-ИСКЛЮЧЕНИЯ (оставлять как есть): API, token, model, cron, session, provider, config, gateway, backend, plugin, skill, sandbox, workspace, dashboard, cache, hook, prompt, pipeline, batch, render, Hermes, Node, npm, git
3. ПЛЮРАЛИЗАЦИЯ: если в оригинале count===1 ? 'X' : 'Y' — переведи с учётом 3 форм русского языка (1/2-4/5+)
4. СТИЛЬ: краткий, UI-ориентированный. НЕ канцелярит.
   Плохо: "осуществляет выполнение" → Хорошо: "выполняет"
   Плохо: "внутриприложевых всплывающих" → Хорошо: "уведомлений в приложении"
5. ЯЗЫК: ТОЛЬКО русский. Никаких китайских/японских/английских слов (кроме терминов-исключений из п.2)
6. КАЛКИ: НЕ калькировать английские суффиксы ("-ing" → НЕ "-инг")
7. ДЛИНА: перевод не должен быть >1.5× длиннее оригинала
8. РЕГИСТР: заголовки — с большой буквы, подписи — с маленькой

Верни ответ как JSON объект: {"key1": "перевод1", "key2": "перевод2"}
Только JSON, без markdown, без пояснений.`;

function callDeepSeek(messages, opts) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      model: opts.model || 'deepseek-v4-flash-free',
      messages,
      max_tokens: opts.max_tokens || 4096,
      temperature: opts.temperature ?? 0.3,
    });
    const req = https.request(opts.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${opts.apiKey}`,
        'Content-Length': Buffer.byteLength(data),
      },
      timeout: 60000,
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`DeepSeek HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        try {
          const j = JSON.parse(body);
          const content = j.choices?.[0]?.message?.content || '';
          resolve(content);
        } catch (e) {
          reject(new Error(`DeepSeek parse error: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('DeepSeek timeout')); });
    req.write(data);
    req.end();
  });
}

/**
 * Перевести ключи через DeepSeek
 * @param {string} enContent - содержимое en.ts
 * @param {string[]} keys - ключи для перевода
 * @param {object} opts - { apiKey, endpoint, model, feedback? }
 * @returns {Promise<object>} - { key: "перевод", ... }
 */
async function translateKeys(enContent, keys, opts) {
  const result = {};

  // Батчим по 25 ключей
  const BATCH_SIZE = 25;
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE);
    console.log(`[translate] батч ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(keys.length / BATCH_SIZE)} (${batch.length} ключей)`);

    // Извлекаем английские значения для этих ключей
    const pairs = {};
    for (const key of batch) {
      const val = extractValue(enContent, key);
      if (val) pairs[key] = val;
    }

    if (Object.keys(pairs).length === 0) continue;

    const userMsg = opts.feedback
      ? `Предыдущий перевод содержал ошибки. Исправь:\n${opts.feedback.map(e => `${e.key}: ${e.type}`).join('\n')}\n\nПереведи заново:\n${JSON.stringify(pairs, null, 2)}`
      : `Переведи на русский язык. Верни JSON {"key": "перевод"}.\n\n${JSON.stringify(pairs, null, 2)}`;

    try {
      const reply = await callDeepSeek([
        { role: 'system', content: PROMPT_SYSTEM },
        { role: 'user', content: userMsg },
      ], opts);

      // Парсим JSON из ответа
      const jsonMatch = reply.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const translations = JSON.parse(jsonMatch[0]);
        for (const [k, v] of Object.entries(translations)) {
          if (typeof v === 'string' && v.trim()) result[k] = v.trim();
        }
      }
    } catch (e) {
      console.error(`[translate] ошибка батча: ${e.message}`);
    }

    // Небольшая пауза между батчами
    await new Promise(r => setTimeout(r, 500));
  }

  return result;
}

function extractValue(tsContent, key) {
  // Ищем: keyName: 'значение' или keyName: "значение"
  const regex = new RegExp(`(?:^|\\n)\\s*${key}\\s*:\\s*(['"])((?:[^'\\\\]|\\\\.)*)\\1`);
  const m = tsContent.match(regex);
  if (m) return m[2];

  // Ищем функцию: keyName: (args) => `значение ${var}`
  const funcRegex = new RegExp(`(?:^|\\n)\\s*${key}\\s*:\\s*\\([^)]*\\)\\s*=>\\s*\`([^\`]*)\``);
  const fm = tsContent.match(funcRegex);
  if (fm) return fm[1];

  return null;
}

/**
 * Подменить значения в en.ts на русские из ru.ts
 */
function patchEnglishWithRussian(enPath, ruPath) {
  const enContent = fs.readFileSync(enPath, 'utf8');
  const ruContent = fs.readFileSync(ruPath, 'utf8');

  // Простая стратегия: заменяем значения в en.ts на значения из ru.ts
  const ruValues = {};
  const lines = ruContent.split('\n');
  for (const line of lines) {
    const m = line.match(/^\s{4,}([a-zA-Z][a-zA-Z0-9_]*)\s*:\s*(['"])((?:[^'\\\\]|\\\\.)*?)\2/);
    if (m) ruValues[m[1]] = m[3];
  }

  let result = enContent;
  for (const [key, value] of Object.entries(ruValues)) {
    const regex = new RegExp(`(\\s{4,}${key}\\s*:\\s*)(['"])((?:[^'\\\\]|\\\\.)*?)\\2`, 'g');
    result = result.replace(regex, `$1'${value.replace(/'/g, "\\'")}'`);
  }

  fs.writeFileSync(enPath, result, 'utf8');
}

module.exports = { translateKeys, patchEnglishWithRussian, callDeepSeek, PROMPT_SYSTEM };
