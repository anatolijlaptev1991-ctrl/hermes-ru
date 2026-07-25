'use strict';
// gen-ru-blocks.js — генерация RU-блоков для components-patch из PR-worktree.
// Маппинг по АНГЛИЙСКОМУ ТЕКСТУ (имена ключей в PR и пакете могут отличаться):
//   sandbox en (новые ключи) → PR en (тот же текст) → PR ru (перевод).
// Несопоставленное падает в отчёт MANUAL — перевожу руками.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { extractKeyPathsPrecise } = require('../tests/check_translation_contract.js');

const WT_I18N = 'C:/Users/anato.ANATOLY/hermes-agent-ru-pr/apps/desktop/src/i18n';
const REAL_DESKTOP = 'C:/Users/anato.ANATOLY/AppData/Local/hermes/hermes-agent/apps/desktop';
const cp = require('../src/components-patch.js');

function vals(src) {
  const m = new Map();
  extractKeyPathsPrecise(src, null, 0, m);
  return m;
}

// 1. Sandbox: патчим копию реального дерева → новые en ключи
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-gen-'));
for (const sub of ['src/app/settings', 'src/i18n']) {
  fs.cpSync(path.join(REAL_DESKTOP, sub), path.join(sandbox, sub), { recursive: true });
}
cp.applyComponentPatches(sandbox);

const newEn = vals(fs.readFileSync(path.join(sandbox, 'src/i18n/en.ts'), 'utf8'));
const vanillaEn = vals(fs.readFileSync(path.join(REAL_DESKTOP, 'src/i18n/en.ts'), 'utf8'));
const prEn = vals(fs.readFileSync(path.join(WT_I18N, 'en.ts'), 'utf8'));
const prRu = vals(fs.readFileSync(path.join(WT_I18N, 'ru.ts'), 'utf8'));

// 2. en текст → PR ru значение
const ruByEnText = new Map();
for (const [k, v] of prEn) {
  if (prRu.has(k) && !ruByEnText.has(v)) ruByEnText.set(v, prRu.get(k));
}

// 3. Новые ключи = sandbox − vanilla
const MANUAL_RU = {
  'settings.model.moa.defaultLabel': "'По умолчанию:'",
  'settings.model.moa.referenceN': '(n: number) => `Референс ${n}`',
  'settings.billing.creditsAdded': "(amount: string) => `${amount} зачислено. Баланс обновляется.`",
  'settings.billing.alreadyOnPlan': "(name: string) => `Вы уже на тарифе ${name} — менять нечего.`",
  'settings.billing.usageLabel': "(label: string) => `Использование: ${label}`",
  'settings.billing.state.autoRefillCard': "'карта автопополнения'",
  'settings.billing.state.customerDefault': "'по умолчанию (клиент)'",
  'settings.billing.state.subscriptionCard': "'карта подписки'",
  'settings.billing.state.renews': "(renewal: string) => `Продление ${renewal}`",
  'settings.billing.state.autoRefillReconcile': "(cardLabel: string) =>\n        `Автопополнение списывает с ${cardLabel} — сверьтесь на портале`",
  'settings.billing.state.autoRefillCharges': "(reloadTo: string, threshold: string) =>\n        `Списывает ${reloadTo} автоматически, когда баланс падает ниже ${threshold}.`",
  'settings.billing.state.remoteSpendingReconnect': "(who: string) =>\n        `${who} Переподключитесь: Настройки → Шлюз, чтобы заново авторизовать это устройство.`",
  'settings.billing.errors.noSavedCardMessage': "'💳 Для списаний из терминала пока нет сохранённой карты. Добавьте её на портале (разовые покупки кредитов не сохраняют карту).'",
  'settings.billing.errors.monthlyCapExceededWithRemaining': "(remaining: number) =>\n        `🔴 Месячный лимит расходов исчерпан — осталось $${remaining}.`",
  'settings.billing.errors.rateLimitedMessage': "(mins: string) =>\n        `🟡 Слишком много списаний подряд${mins}. Это не отказ платежа.`",
  'settings.billing.errors.stripeRetryMessage': "(mins: string) =>\n        `У Stripe сбой — повторите чуть позже${mins}`",
  'settings.customEndpoints.reachableWithCount': "(count: number) => `Эндпоинт доступен. Найдено: ${count} ${ruPlural(count, 'модель', 'модели', 'моделей')}.`",
  'settings.customEndpoints.deleteConfirm': "(name: string) => `Удалить ${name}?`",
};
const added = [...newEn.keys()].filter(k => !vanillaEn.has(k));
const manual = [];
const ruMap = new Map();
for (const k of added) {
  const enText = newEn.get(k);
  if (MANUAL_RU[k]) ruMap.set(k, MANUAL_RU[k]);
  else if (ruByEnText.has(enText)) ruMap.set(k, ruByEnText.get(enText));
  else manual.push([k, enText]);
}
console.log(`новых en ключей: ${added.length}; сопоставлено с PR ru: ${ruMap.size}; MANUAL: ${manual.length}`);
manual.forEach(([k, v]) => console.log('  ✗', k, '=', v.slice(0, 90)));

// 4. Группировка в секции и эмиссия блоков
const SENT = '';
const sections = {};
for (const [k, v] of ruMap) {
  // settings.model.moa.* / settings.customEndpoints.* / settings.billing.*
  const parts = k.split('.');
  let sec;
  if (k.startsWith('settings.model.moa.')) sec = 'moa';
  else if (k.startsWith('settings.customEndpoints.')) sec = 'customEndpoints';
  else if (k.startsWith('settings.billing.state.')) sec = 'billingState';
  else if (k.startsWith('settings.billing.errors.')) sec = 'billingErrors';
  else if (k.startsWith('settings.billing.')) sec = 'billing';
  else { console.log('  ? вне секций:', k); continue; }
  const leaf = parts[parts.length - 1];
  (sections[sec] = sections[sec] || []).push([leaf, v]);
}

function emitBlock(name, entries, indent) {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  const lines = entries.map(([leaf, v]) => `${indent}${leaf}: ${esc(v)},`);
  return `${name}: {\n${lines.join('\n')}\n${indent.slice(2)}}`;
}

const out = [];
out.push("'use strict';");
out.push('// СГЕНЕРИРОВАНО scripts/gen-ru-blocks.js из PR-worktree ru.ts — НЕ редактировать вручную.');
out.push('// RU-блоки для components-patch (зеркало NEW_EN_KEYS).');
out.push('');
for (const [sec, name] of [['moa','moa'],['customEndpoints','customEndpoints'],['billing','billing'],['billingState','state'],['billingErrors','errors']]) {
  if (!sections[sec]) continue;
  out.push(`const ${sec}Block = \`${emitBlock(name, sections[sec], '      ')}\`;`);
  out.push('');
}
out.push('module.exports = {');
for (const sec of ['moa','customEndpoints','billing','billingState','billingErrors']) {
  if (sections[sec]) out.push(`  ${sec}Block,`);
}
out.push('};');

fs.writeFileSync(path.join(__dirname, '..', 'src', 'components-patch-ru-blocks.js'), out.join('\n'), 'utf8');
console.log('✓ src/components-patch-ru-blocks.js записан');
