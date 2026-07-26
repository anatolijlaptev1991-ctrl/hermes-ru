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
// Эмулируем порядок engine: пакетный ru.ts поверх сироты (как делает i18n-патч).
fs.copyFileSync(
  'C:/Users/anato.ANATOLY/hermes-ru/src/i18n/ru.ts',
  path.join(sandbox, 'src/i18n/ru.ts')
);
cp.applyComponentPatches(sandbox);

const newEn = vals(fs.readFileSync(path.join(sandbox, 'src/i18n/en.ts'), 'utf8'));
const vanillaEn = vals(fs.readFileSync(path.join(REAL_DESKTOP, 'src/i18n/en.ts'), 'utf8'));
const prEn = vals(fs.readFileSync(path.join(WT_I18N, 'en.ts'), 'utf8'));
const prRu = vals(fs.readFileSync(path.join(WT_I18N, 'ru.ts'), 'utf8'));

// 2. en текст → PR ru/zh значение
const prZh = vals(fs.readFileSync(path.join(WT_I18N, 'zh.ts'), 'utf8'));
const ruByEnText = new Map();
for (const [k, v] of prEn) {
  if (prRu.has(k) && !ruByEnText.has(v)) ruByEnText.set(v, prRu.get(k));
}
const zhByEnText = new Map();
for (const [k, v] of prEn) {
  if (prZh.has(k) && !zhByEnText.has(v)) zhByEnText.set(v, prZh.get(k));
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
  'settings.billing.effectScheduled': "(targetName: string, effectiveAt: string, creditsDelta: string) =>\n        `Переход на ${targetName} — вступит в силу ${effectiveAt}. Сейчас списания не будет; текущий тариф действует до этой даты.${creditsDelta ? ` Ежемесячные кредиты изменятся: ${creditsDelta}.` : ''}`",
  'settings.billing.notScheduleable': "'Это изменение нельзя запланировать здесь.'",
};
const MANUAL_ZH = {
  'settings.model.moa.defaultLabel': "'默认：'",
  'settings.model.moa.referenceN': '(n: number) => `参考模型 ${n}`',
  'settings.billing.creditsAdded': "(amount: string) => `已存入 ${amount}。余额正在刷新。`",
  'settings.billing.alreadyOnPlan': "(name: string) => `您已在 ${name} 套餐 — 无需更改。`",
  'settings.billing.effectScheduled': "(targetName: string, effectiveAt: string, creditsDelta: string) =>\n        `将切换至 ${targetName} — 于 ${effectiveAt} 生效。现在不收费；当前套餐在此之前保持有效。${creditsDelta ? ` 每月额度变化：${creditsDelta}。` : ''}`",
  'settings.billing.notScheduleable': "'无法在此处安排此更改。'",
  'settings.billing.usageLabel': "(label: string) => `${label} 用量`",
  'settings.billing.state.autoRefillCard': "'自动充值卡'",
  'settings.billing.state.customerDefault': "'客户默认'",
  'settings.billing.state.subscriptionCard': "'订阅卡'",
  'settings.billing.state.renews': "(renewal: string) => `${renewal} 续订`",
  'settings.billing.state.autoRefillReconcile': "(cardLabel: string) =>\n        `自动充值将从 ${cardLabel} 扣款 — 请在门户核对`",
  'settings.billing.state.autoRefillCharges': "(reloadTo: string, threshold: string) =>\n        `当余额低于 ${threshold} 时自动充值 ${reloadTo}。`",
  'settings.billing.state.remoteSpendingReconnect': "(who: string) =>\n        `${who} 请从 设置 → 网关 重新连接以重新授权此设备。`",
  'settings.billing.errors.noSavedCardMessage': "'💳 终端扣款尚未绑定卡片。请在门户添加（一次性购买额度不会保存卡片）。'",
  'settings.billing.errors.monthlyCapExceededWithRemaining': "(remaining: number) =>\n        `🔴 已达到每月支出上限 — 剩余 $${remaining}。`",
  'settings.billing.errors.rateLimitedMessage': "(mins: string) =>\n        `🟡 当前扣款过于频繁${mins}。这不是支付失败。`",
  'settings.billing.errors.stripeRetryMessage': "(mins: string) =>\n        `Stripe 暂时异常 — 请稍后重试${mins}`",
  'settings.customEndpoints.reachableWithCount': "(count: number) => `端点可达。发现 ${count} 个模型。`",
  'settings.customEndpoints.deleteConfirm': "(name: string) => `删除 ${name}？`",
};
const added = [...newEn.keys()].filter(k => !vanillaEn.has(k));
const manual = [];
const manualZh = [];
const ruMap = new Map();
const zhMap = new Map();
for (const k of added) {
  const enText = newEn.get(k);
  if (MANUAL_RU[k]) ruMap.set(k, MANUAL_RU[k]);
  else if (ruByEnText.has(enText)) ruMap.set(k, ruByEnText.get(enText));
  else manual.push([k, enText]);
  // zh: ручной словарь → затем прямое совпадение en-текста
  if (MANUAL_ZH[k]) zhMap.set(k, MANUAL_ZH[k]);
  else if (zhByEnText.has(enText)) zhMap.set(k, zhByEnText.get(enText));
  else manualZh.push([k, enText]);
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

// 5б. ZH-блоки (zh.ts типизирован полным Translations — обязателен к расширению)
console.log(`zh: сопоставлено ${zhMap.size}/${added.length}; MANUAL_ZH: ${manualZh.length}`);
manualZh.slice(0, 12).forEach(([k, v]) => console.log('  ✗zh', k, '=', v.slice(0, 80)));
const zhSections = {};
for (const [k, v] of zhMap) {
  let sec;
  if (k.startsWith('settings.model.moa.')) sec = 'moa';
  else if (k.startsWith('settings.customEndpoints.')) sec = 'customEndpoints';
  else if (k.startsWith('settings.billing.state.')) sec = 'billingState';
  else if (k.startsWith('settings.billing.errors.')) sec = 'billingErrors';
  else if (k.startsWith('settings.billing.')) sec = 'billing';
  else continue;
  const leaf = k.split('.').pop();
  (zhSections[sec] = zhSections[sec] || []).push([leaf, v]);
}
const zout = ["'use strict';", '// СГЕНЕРИРОВАНО scripts/gen-ru-blocks.js — ZH-блоки для components-patch.', ''];
for (const [sec, name] of [['moa','moa'],['customEndpoints','customEndpoints'],['billing','billing'],['billingState','state'],['billingErrors','errors']]) {
  if (!zhSections[sec]) continue;
  zout.push(`const ${sec}Block = \`${emitBlock(name, zhSections[sec], '      ')}\`;`);
  zout.push('');
}
zout.push('module.exports = {');
for (const sec of ['moa','customEndpoints','billing','billingState','billingErrors']) {
  if (zhSections[sec]) zout.push(`  ${sec}Block,`);
}
zout.push('};');
zout.push('');
fs.writeFileSync(path.join(__dirname, '..', 'src', 'components-patch-zh-blocks.js'), zout.join('\n'), 'utf8');
console.log('✓ src/components-patch-zh-blocks.js записан');
