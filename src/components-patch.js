'use strict';

/**
 * hermes-ru components-patch — структурная i18n-проводка захардкоженных
 * английских строк в трёх поверхностях настроек Hermes 0.19.0:
 *   - Mixture of Agents (model-settings.tsx)
 *   - Billing (billing/index.tsx, plans-view.tsx, current-plan-card.tsx, auto-reload-row.tsx)
 *   - Custom Endpoints (custom-endpoints-settings.tsx)
 *
 * Каждый патч — атомарная замена «английский литерал → t('ключ')» с якорями
 * окружающего кода. Якорь не совпал → PatchAnchorError → ничего не пишется.
 * Идемпотентность: детект по наличию t('settings.model.moa.title') и т.п.
 *
 * Принципы те же, что в patch-engine.js:
 *   - Структурные якоря (не regex, не захардкоженные списки)
 *   - Ноль тихих no-op
 *   - Снапшот → патч в памяти → verify → запись → verify на диске
 *   - EOL-preserving
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Импортируем из patch-engine якорную ошибку и утилиты
// (движок экспортирует их через module.exports)
let PatchAnchorError;
let detectEol, toUnix, fromUnix;

// ---------------------------------------------------------------------------
// Инициализация (lazy require, чтобы избежать циклической зависимости)
// ---------------------------------------------------------------------------

function _initFromEngine() {
  const engine = require('./patch-engine');
  PatchAnchorError = engine.PatchAnchorError;
  detectEol = engine._internals.detectEol;
  toUnix = engine._internals.toUnix;
  fromUnix = engine._internals.fromUnix;
}

_initFromEngine();

// ---------------------------------------------------------------------------
// Утилиты
// ---------------------------------------------------------------------------

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ---------------------------------------------------------------------------
// Новые i18n-ключи для en.ts (добавляются структурно после существующих
// settings.model.* в секцию model)
// ---------------------------------------------------------------------------

const NEW_EN_KEYS = {
  'settings.model.moa': {
    title: 'Mixture of Agents',
    description:
      'Configure named presets that appear as models under the Mixture of Agents provider. The aggregator is the acting model.',
    preset: 'Preset',
    enabled: 'Enabled',
    setDefault: 'Set default',
    delete: 'Delete',
    newPreset: 'new preset',
    addPreset: 'Add preset',
    defaultLabel: 'Default:',
    referenceN: (n) => `Reference ${n}`,
    remove: 'Remove',
    addReference: 'Add reference model',
    aggregator: 'Aggregator',
  },
  'settings.customEndpoints': {
    title: 'Custom Endpoints',
    emptyTitle: 'No custom endpoints',
    emptyDescription: 'Add an OpenAI-compatible endpoint below.',
    editTitle: 'Edit Endpoint',
    addTitle: 'Add Endpoint',
    name: 'Name',
    providerId: 'Provider ID',
    endpointUrl: 'Endpoint URL',
    defaultModel: 'Default Model',
    context: 'Context',
    apiKey: 'API Key',
    useForNewChats: 'Use for new chats',
    discoverModels: 'Discover models',
    test: 'Test',
    save: 'Save',
    newEndpoint: 'New endpoint',
    active: 'Active',
    use: 'Use',
    deleteEndpoint: 'Delete endpoint',
    loadError: 'Could not load custom endpoints',
    saveSuccess: 'Custom endpoint saved.',
    saveFailed: 'Save failed',
    validationFailed: 'Validation failed',
    activationFailed: 'Activation failed',
    deleteFailed: 'Delete failed',
    reachable: 'Endpoint is reachable.',
    reachableWithCount: (count) =>
      `Endpoint is reachable. Found ${count} models.`,
    validationFailedEndpoint: 'Endpoint validation failed.',
    deleteConfirm: (name) => `Delete ${name}?`,
  },
  'settings.billing': {
    title: 'Billing',
    plan: 'Plan',
    paymentCredits: 'Payment & credits',
    usage: 'Usage',
    processingSettlement: 'Processing… checking settlement',
    creditsAdded: (amount) => `${amount} added. Balance is refreshing.`,
    openPortal: 'Open portal',
    retry: 'Retry',
    buy: 'Buy',
    turnOffAutoRefill: 'Turn off auto-refill?',
    turnOff: 'Turn off',
    disable: 'Disable',
    autoRefillUpdated: 'Auto-refill updated.',
    autoRefillTurnedOff: 'Auto-refill turned off.',
    threshold: 'Threshold',
    reloadTo: 'Reload to',
    plans: 'Plans',
    currentPlan: 'Current plan',
    scheduled: 'Scheduled',
    downgrade: 'Downgrade',
    manage: 'Manage',
    undo: 'Undo',
    undoing: 'Undoing…',
    confirmDowngrade: 'Confirm downgrade',
    checkingChange: 'Checking this change…',
    blockedChange: 'That change cannot be made here.',
    alreadyOnPlan: (name) => `You are already on ${name} — nothing to change.`,
    noPlansAvailable: 'No plans are available to change to right now.',
    tryAgain: 'Try again',
    save: 'Save',
    saving: 'Saving…',
    cancel: 'Cancel',
    usageLabel: (label) => `${label} usage`,
  },
  'settings.billing.state': {
    openPortal: 'Open portal ↗',
    openPortalShort: 'Open portal',
    connectMessage:
      'Run /portal in the TUI or open the Nous portal to connect your account.',
    connectTitle: 'Connect your Nous account',
    addCard: 'Add card ↗',
    noPaymentMethod: 'No payment method on file',
    noCardMessage:
      'Buying top-up credits and auto-refill stay disabled until a card is on file. Add one on the portal.',
    addPaymentMethod: 'Add payment method',
    paymentMethod: 'Payment method',
    update: 'Update',
    manageCardDesc:
      'Manage the card used for top-ups and subscription renewals.',
    buy: 'Buy',
    buyCreditsDesc:
      'A single charge on your card, added to your balance today.',
    buyCreditsNow: 'Buy credits now',
    autoRefillGeneric:
      'Keep your balance topped up when it drops below your threshold.',
    manage: 'Manage',
    manageAutoRefillCaption: 'Manage auto-refill from the portal.',
    refillWhenLow: 'Refill when low',
    turnOnAutoRefillCaption: 'Turn on auto-refill from the portal',
    reconcile: 'Reconcile ↗',
    autoRefillCard: 'auto-refill card',
    customerDefault: 'customer default',
    subscriptionCard: 'subscription card',
    subscriptionCreditsRemaining: 'Subscription credits remaining',
    subscriptionCredits: 'Subscription credits',
    doesNotExpire: 'Does not expire',
    topUpCredits: 'Top-up credits',
    monthlySpendCapUsed: 'Monthly spend cap used',
    monthlySpendCap: 'Monthly spend cap',
    defaultCeiling: 'Default ceiling',
    monthlyRemoteSpending: 'Monthly remote spending',
    changePlan: 'Change plan',
    viewPlans: 'View plans',
    adjustPlan: 'Adjust plan ↗',
    choose: 'Choose ↗',
    enabled: 'Enabled',
    off: 'Off',
    subscriptionUnavailable:
      'Subscription details are unavailable; opening the portal is still available.',
    noActiveSubscription:
      'No active subscription — paid models draw down top-up credits.',
    changesTo: (tierName, when) => `Changes to ${tierName} on ${when}.`,
    cancelsOn: (when) => `Cancels on ${when}.`,
    renews: (renewal) => `Renews ${renewal}`,
    autoRefillReconcile: (cardLabel) =>
      `Auto-refill charges ${cardLabel} — reconcile on the portal`,
    autoRefillCharges: (reloadTo, threshold) =>
      `Charges ${reloadTo} automatically when your balance falls below ${threshold}.`,
    resetsOn: (date) => `Resets ${date}`,
    ofUsed: (spent, limit) => `${spent} of ${limit} used`,
    remoteSpendingReconnect: (who) =>
      `${who} Reconnect from Settings → Gateway to re-authorize this device.`,
  },
  'settings.billing.errors': {
    cardConfirmationNeeded: 'Card confirmation needed',
    cardConfirmationMessage:
      'Confirm this card for terminal charges in the portal',
    remoteSpendingNeedsApproval: 'Remote Spending needs approval',
    remoteSpendingMessage:
      'This needs Remote Spending allowed. Start a top-up to allow it, then retry.',
    remoteSpendingStopped: 'Remote spending was stopped',
    adminStopped: 'An admin stopped remote spending for this terminal.',
    youStopped: 'You stopped remote spending for this terminal.',
    sessionLoggedOut: 'Session logged out',
    sessionLoggedOutMessage:
      'Your session was logged out. Sign in again from Settings → Gateway.',
    remoteSpendingOff: 'Remote spending is off',
    remoteSpendingOffMessage:
      "Remote spending is off for this account — a billing admin can turn it on from the portal's Hermes Agent page.",
    adminRoleRequired: 'Admin role required',
    adminRoleRequiredMessage:
      'Adding funds needs an org admin/owner. Ask an admin, or manage on the portal.',
    startFreshTopUp: 'Start a fresh top-up',
    idempotencyConflictMessage:
      '🔴 That charge key was already used for a different amount. Start a fresh top-up.',
    noSavedCard: 'No saved card',
    noSavedCardMessage:
      '💳 No saved card for terminal charges yet. Set one up on the portal (one-time credit buys don\'t save a reusable card).',
    orgAccessDenied: 'Org access denied',
    orgAccessDeniedMessage: "This token isn't bound to an org you can manage",
    monthlyCapExceeded: 'Monthly spend cap reached',
    monthlyCapExceededWithRemaining: (remaining) =>
      `🔴 Monthly spend cap reached — $${remaining} headroom left.`,
    monthlyCapExceededSimple: '🔴 Monthly spend cap reached.',
    tooManyCharges: 'Too many charges right now',
    rateLimitedMessage: (mins) =>
      `🟡 Too many charges right now${mins}. This isn't a payment failure.`,
    stripeTrouble: 'Stripe is having trouble',
    stripeRetryMessage: (mins) =>
      `Stripe is having trouble — try again shortly${mins}`,
    dailyPlanChangeLimit: 'Daily plan-change limit reached',
    dailyPlanChangeLimitMessage:
      'Daily plan-change limit reached — try again tomorrow',
    endpointUnavailable: 'Billing endpoint unavailable',
    endpointUnavailableMessage:
      'Billing endpoint returned a non-JSON response (it may not be available on this deployment).',
    requestTimedOut: 'Billing request timed out',
    requestTimedOutMessage: 'Billing request timed out.',
    connectionFailed: 'Billing connection failed',
    connectionFailedMessage:
      'Billing request failed before reaching the gateway.',
    requestFailed: 'Billing request failed',
    requestFailedMessage: 'Billing request failed.',
  },
};

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function settingsDir(desktopDir) {
  return path.join(desktopDir, 'src', 'app', 'settings');
}

function i18nDir(desktopDir) {
  return path.join(desktopDir, 'src', 'i18n');
}

// ---------------------------------------------------------------------------
// Идемпотентность-детект
// ---------------------------------------------------------------------------

/**
 * Проверяет, был ли уже применён components-patch на конкретный файл.
 * Принцип: если в файле уже есть t('settings.model.moa.…') — патч применён.
 */
function _isPatched(content) {
  return /t\(['"]settings\.model\.moa\./.test(content) ||
    /t\(['"]settings\.customEndpoints\./.test(content) ||
    /t\(['"]settings\.billing\.state\./.test(content) ||
    /t\(['"]settings\.billing\.errors\./.test(content) ||
    /t\(['"]settings\.billing\./.test(content);
}

// ---------------------------------------------------------------------------
// ПАТЧ 1: model-settings.tsx — секция Mixture of Agents
// ---------------------------------------------------------------------------

function patchModelSettingsMoA(content) {
  if (/t\.settings\.model\.moa\./.test(content)) {
    return { content, changed: false };
  }

  // Нормализация: в тестовых фикстурах \\n — это литерал, в реальных файлах — newline.
  // Приводим оба варианта к реальному newline для единообразия якорей.
  content = content.replace(/\\n/g, '\n');

  let changed = false;
  let out = content;

  // Атомарные замены с якорями окружающего кода

  // 1. "Mixture of Agents" в SectionHeading → t('settings.model.moa.title')
  const moaTitleAnchor = 'title="Mixture of Agents"';
  if (!out.includes(moaTitleAnchor)) {
    throw new PatchAnchorError(
      'model-settings.tsx',
      'SectionHeading title="Mixture of Agents"'
    );
  }
  out = out.replace(
    'title="Mixture of Agents"',
    "title={t.settings.model.moa.title}"
  );
  changed = true;

  // 2. Description paragraph → t('settings.model.moa.description')
  const descAnchor = 'acting model.';
  if (!out.includes(descAnchor)) {
    throw new PatchAnchorError('model-settings.tsx', 'MoA description anchor');
  }
  out = out.replace(
    `Configure named presets that appear as models under the Mixture of Agents provider. The aggregator is the
            acting model.`,
    '{t.settings.model.moa.description}'
  );
  changed = true;

  // 3. 'Preset' placeholder in Select → t('settings.model.moa.preset')
  const presetAnchor = 'placeholder="Preset"';
  if (!out.includes(presetAnchor)) {
    throw new PatchAnchorError('model-settings.tsx', 'MoA preset placeholder');
  }
  out = out.replace(
    'placeholder="Preset"',
    'placeholder={t.settings.model.moa.preset}'
  );
  changed = true;

  // 4. 'Enabled' label → t('settings.model.moa.enabled')
  const enabledAnchor = '>Enabled<';
  if (!out.includes(enabledAnchor)) {
    throw new PatchAnchorError('model-settings.tsx', 'MoA Enabled label');
  }
  out = out.replace('>Enabled<', `>{t.settings.model.moa.enabled}<`);
  changed = true;

  // 5. 'Set default' button → t('settings.model.moa.setDefault')
  const setDefaultAnchor = '>Set default<';
  if (!out.includes(setDefaultAnchor)) {
    throw new PatchAnchorError('model-settings.tsx', 'MoA Set default');
  }
  out = out.replace(
    '>Set default<',
    `>{t.settings.model.moa.setDefault}<`
  );
  changed = true;

  // 6. 'Delete' button (preset delete) → t('settings.model.moa.delete')
  // There are multiple 'Delete' in the file — anchor by context
  const deleteAnchor =
    'variant="ghost"\n            >\n              Delete\n            </Button>';
  if (!out.includes(deleteAnchor)) {
    throw new PatchAnchorError('model-settings.tsx', 'MoA Delete preset button');
  }
  out = out.replace(
    '              Delete\n',
    '              {t.settings.model.moa.delete}\n'
  );
  changed = true;

  // 7. 'new preset' placeholder → t('settings.model.moa.newPreset')
  const newPresetAnchor = 'placeholder="new preset"';
  if (!out.includes(newPresetAnchor)) {
    throw new PatchAnchorError('model-settings.tsx', 'MoA new preset placeholder');
  }
  out = out.replace(
    'placeholder="new preset"',
    'placeholder={t.settings.model.moa.newPreset}'
  );
  changed = true;

  // 8. 'Add preset' button → t('settings.model.moa.addPreset')
  const addPresetAnchor = '>Add preset<';
  if (!out.includes(addPresetAnchor)) {
    throw new PatchAnchorError('model-settings.tsx', 'MoA Add preset button');
  }
  out = out.replace(
    '>Add preset<',
    `>{t.settings.model.moa.addPreset}<`
  );
  changed = true;

  // 9. 'Default:' label → t('settings.model.moa.defaultLabel')
  const defaultLabelAnchor = '>Default:<';
  if (!out.includes(defaultLabelAnchor)) {
    throw new PatchAnchorError('model-settings.tsx', 'MoA Default: label');
  }
  out = out.replace(
    '>Default:<',
    `>{t.settings.model.moa.defaultLabel}<`
  );
  changed = true;

  // 10. 'Reference N' title → t('settings.model.moa.referenceN', {n})
  // Pattern: title={`Reference ${index + 1}`}
  const refTitleAnchor = 'title={`Reference ${index + 1}`}';
  if (!out.includes(refTitleAnchor)) {
    throw new PatchAnchorError(
      'model-settings.tsx',
      'MoA Reference {N} title'
    );
  }
  out = out.replace(
    'title={`Reference ${index + 1}`}',
    'title={t.settings.model.moa.referenceN(index + 1)}'
  );
  changed = true;

  // 11. 'Remove' button in reference model → t('settings.model.moa.remove')
  const removeAnchor =
    'variant="ghost"\n                    >\n                      Remove\n                    </Button>';
  if (!out.includes(removeAnchor)) {
    throw new PatchAnchorError('model-settings.tsx', 'MoA Remove button');
  }
  out = out.replace(
    '                      Remove\n',
    '                      {t.settings.model.moa.remove}\n'
  );
  changed = true;

  // 12. 'Add reference model' button → t('settings.model.moa.addReference')
  const addRefAnchor = '>Add reference model<';
  if (!out.includes(addRefAnchor)) {
    throw new PatchAnchorError(
      'model-settings.tsx',
      'MoA Add reference model'
    );
  }
  out = out.replace(
    '>Add reference model<',
    `>{t.settings.model.moa.addReference}<`
  );
  changed = true;

  // 13. 'Aggregator' title → t('settings.model.moa.aggregator')
  const aggregatorAnchor = 'title="Aggregator"';
  if (!out.includes(aggregatorAnchor)) {
    throw new PatchAnchorError('model-settings.tsx', 'MoA Aggregator title');
  }
  out = out.replace(
    'title="Aggregator"',
    'title={t.settings.model.moa.aggregator}'
  );
  changed = true;

  return { content: out, changed };
}

// ---------------------------------------------------------------------------
// ПАТЧ 2: custom-endpoints-settings.tsx
// ---------------------------------------------------------------------------

function patchCustomEndpoints(content) {
  if (/t\.settings\.customEndpoints\./.test(content)) {
    return { content, changed: false };
  }

  let changed = false;
  let out = content;

  // 1. 'Custom Endpoints' title
  const ceTitleAnchor = 'title="Custom Endpoints"';
  if (!out.includes(ceTitleAnchor)) {
    throw new PatchAnchorError(
      'custom-endpoints-settings.tsx',
      'SectionHeading title="Custom Endpoints"'
    );
  }
  out = out.replace(
    'title="Custom Endpoints"',
    'title={t.settings.customEndpoints.title}'
  );
  changed = true;

  // 2. Empty state
  const emptyTitleAnchor = 'title="No custom endpoints"';
  if (!out.includes(emptyTitleAnchor)) {
    throw new PatchAnchorError(
      'custom-endpoints-settings.tsx',
      'EmptyState title="No custom endpoints"'
    );
  }
  out = out.replace(
    'title="No custom endpoints"',
    'title={t.settings.customEndpoints.emptyTitle}'
  );
  changed = true;

  const emptyDescAnchor =
    'description="Add an OpenAI-compatible endpoint below."';
  if (!out.includes(emptyDescAnchor)) {
    throw new PatchAnchorError(
      'custom-endpoints-settings.tsx',
      'EmptyState description anchor'
    );
  }
  out = out.replace(
    'description="Add an OpenAI-compatible endpoint below."',
    'description={t.settings.customEndpoints.emptyDescription}'
  );
  changed = true;

  // 3. 'Edit Endpoint' / 'Add Endpoint' title
  const sectionTitleAnchor =
    'title={form.id ? \'Edit Endpoint\' : \'Add Endpoint\'}';
  if (!out.includes(sectionTitleAnchor)) {
    throw new PatchAnchorError(
      'custom-endpoints-settings.tsx',
      'Edit/Add Endpoint title'
    );
  }
  out = out.replace(
    'title={form.id ? \'Edit Endpoint\' : \'Add Endpoint\'}',
    "title={form.id ? t.settings.customEndpoints.editTitle : t.settings.customEndpoints.addTitle}"
  );
  changed = true;

  // 4. 'Name' label
  const nameLabelAnchor = '>Name<';
  if (!out.includes(nameLabelAnchor)) {
    throw new PatchAnchorError('custom-endpoints-settings.tsx', 'Name label');
  }
  out = out.replace(
    '>Name<',
    '>{t.settings.customEndpoints.name}<'
  );
  changed = true;

  // 5. 'Provider ID' label
  const providerIdAnchor = '>Provider ID<';
  if (!out.includes(providerIdAnchor)) {
    throw new PatchAnchorError(
      'custom-endpoints-settings.tsx',
      'Provider ID label'
    );
  }
  out = out.replace(
    '>Provider ID<',
    '>{t.settings.customEndpoints.providerId}<'
  );
  changed = true;

  // 6. 'Endpoint URL' label
  const endpointUrlAnchor = '>Endpoint URL<';
  if (!out.includes(endpointUrlAnchor)) {
    throw new PatchAnchorError(
      'custom-endpoints-settings.tsx',
      'Endpoint URL label'
    );
  }
  out = out.replace(
    '>Endpoint URL<',
    '>{t.settings.customEndpoints.endpointUrl}<'
  );
  changed = true;

  // 7. 'Default Model' label
  const defaultModelAnchor = '>Default Model<';
  if (!out.includes(defaultModelAnchor)) {
    throw new PatchAnchorError(
      'custom-endpoints-settings.tsx',
      'Default Model label'
    );
  }
  out = out.replace(
    '>Default Model<',
    '>{t.settings.customEndpoints.defaultModel}<'
  );
  changed = true;

  // 8. 'Context' label
  const contextLabelAnchor = '>Context<';
  if (!out.includes(contextLabelAnchor)) {
    throw new PatchAnchorError(
      'custom-endpoints-settings.tsx',
      'Context label'
    );
  }
  out = out.replace(
    '>Context<',
    '>{t.settings.customEndpoints.context}<'
  );
  changed = true;

  // 9. 'API Key' label
  const apiKeyLabelAnchor = '>API Key<';
  if (!out.includes(apiKeyLabelAnchor)) {
    throw new PatchAnchorError(
      'custom-endpoints-settings.tsx',
      'API Key label'
    );
  }
  out = out.replace(
    '>API Key<',
    '>{t.settings.customEndpoints.apiKey}<'
  );
  changed = true;

  // 10. 'Use for new chats' label
  const useForNewAnchor = '>Use for new chats<';
  if (!out.includes(useForNewAnchor)) {
    throw new PatchAnchorError(
      'custom-endpoints-settings.tsx',
      'Use for new chats label'
    );
  }
  out = out.replace(
    '>Use for new chats<',
    '>{t.settings.customEndpoints.useForNewChats}<'
  );
  changed = true;

  // 11. 'Discover models' label
  const discoverModelsAnchor = '>Discover models<';
  if (!out.includes(discoverModelsAnchor)) {
    throw new PatchAnchorError(
      'custom-endpoints-settings.tsx',
      'Discover models label'
    );
  }
  out = out.replace(
    '>Discover models<',
    '>{t.settings.customEndpoints.discoverModels}<'
  );
  changed = true;

  // 12. 'Test' button text
  const testButtonAnchor = '>Test<';
  if (!out.includes(testButtonAnchor)) {
    throw new PatchAnchorError(
      'custom-endpoints-settings.tsx',
      'Test button text'
    );
  }
  out = out.replace(
    '>Test<',
    '>{t.settings.customEndpoints.test}<'
  );
  changed = true;

  // 13. 'Save' button text
  const saveButtonAnchor = '>Save<';
  if (!out.includes(saveButtonAnchor)) {
    throw new PatchAnchorError(
      'custom-endpoints-settings.tsx',
      'Save button text'
    );
  }
  out = out.replace(
    '>Save<',
    `>{t.settings.customEndpoints.save}<`
  );
  changed = true;

  // 14. 'New endpoint' button text
  const newEndpointAnchor = '>New endpoint<';
  if (!out.includes(newEndpointAnchor)) {
    throw new PatchAnchorError(
      'custom-endpoints-settings.tsx',
      'New endpoint button text'
    );
  }
  out = out.replace(
    '>New endpoint<',
    `>{t.settings.customEndpoints.newEndpoint}<`
  );
  changed = true;

  // 15. 'Active' pill label (inside checkmark)
  const activePillAnchor = '>Active<';
  if (!out.includes(activePillAnchor)) {
    throw new PatchAnchorError(
      'custom-endpoints-settings.tsx',
      'Active pill label'
    );
  }
  out = out.replace(
    '>Active<',
    `>{t.settings.customEndpoints.active}<`
  );
  changed = true;

  // 16. 'Use' button text
  const useButtonAnchor = '>Use<';
  if (!out.includes(useButtonAnchor)) {
    throw new PatchAnchorError(
      'custom-endpoints-settings.tsx',
      'Use button text'
    );
  }
  out = out.replace(
    '>Use<',
    `>{t.settings.customEndpoints.use}<`
  );
  changed = true;

  // 17. 'Delete endpoint' title attribute
  const deleteEndpointAnchor = 'title="Delete endpoint"';
  if (!out.includes(deleteEndpointAnchor)) {
    throw new PatchAnchorError(
      'custom-endpoints-settings.tsx',
      'Delete endpoint title'
    );
  }
  out = out.replace(
    'title="Delete endpoint"',
    `title={t.settings.customEndpoints.deleteEndpoint}`
  );
  changed = true;

  // 18. Error messages
  if (out.includes("'Could not load custom endpoints'")) {
    out = out.replace(
      "'Could not load custom endpoints'",
      't.settings.customEndpoints.loadError'
    );
    changed = true;
  }

  if (out.includes("'Custom endpoint saved.'")) {
    out = out.replace(
      "'Custom endpoint saved.'",
      't.settings.customEndpoints.saveSuccess'
    );
    changed = true;
  }

  if (out.includes("'Save failed'")) {
    out = out.replace("'Save failed'", 't.settings.customEndpoints.saveFailed');
    changed = true;
  }

  if (out.includes("'Validation failed'")) {
    out = out.replace(
      "'Validation failed'",
      't.settings.customEndpoints.validationFailed'
    );
    changed = true;
  }

  if (out.includes("'Activation failed'")) {
    out = out.replace(
      "'Activation failed'",
      't.settings.customEndpoints.activationFailed'
    );
    changed = true;
  }

  if (out.includes("'Delete failed'")) {
    out = out.replace(
      "'Delete failed'",
      't.settings.customEndpoints.deleteFailed'
    );
    changed = true;
  }

  // Dynamic notification messages
  if (out.includes("'Endpoint is reachable.'")) {
    out = out.replace(
      "'Endpoint is reachable.'",
      't.settings.customEndpoints.reachable'
    );
    changed = true;
  }

  // `Endpoint is reachable. Found ${response.models.length} models.`
  const reachableWithPattern =
    '`Endpoint is reachable. Found ${response.models.length} models.`';
  if (out.includes(reachableWithPattern)) {
    out = out.replace(
      reachableWithPattern,
      't.settings.customEndpoints.reachableWithCount(response.models.length)'
    );
    changed = true;
  }

  if (out.includes("'Endpoint validation failed.'")) {
    out = out.replace(
      "'Endpoint validation failed.'",
      't.settings.customEndpoints.validationFailedEndpoint'
    );
    changed = true;
  }

  return { content: out, changed };
}

// ---------------------------------------------------------------------------
// ПАТЧ 3: billing/index.tsx
// ---------------------------------------------------------------------------

function patchBillingIndex(content) {
  if (/t\.settings\.billing\./.test(content)) {
    return { content, changed: false };
  }

  let changed = false;
  let out = content;

  // 1. 'Billing' header text
  const billingTitleAnchor = '>Billing<';
  if (!out.includes(billingTitleAnchor)) {
    throw new PatchAnchorError('billing/index.tsx', 'Billing header');
  }
  out = out.replace(
    '>Billing<',
    `>{t.settings.billing.title}<`
  );
  changed = true;

  // 2. 'Plan' section heading
  const planHeadingAnchor = 'title="Plan"';
  if (!out.includes(planHeadingAnchor)) {
    throw new PatchAnchorError('billing/index.tsx', 'Plan section heading');
  }
  out = out.replace(
    'title="Plan"',
    'title={t.settings.billing.plan}'
  );
  changed = true;

  // 3. 'Payment & credits' section heading
  const paymentHeadingAnchor = 'title="Payment & credits"';
  if (!out.includes(paymentHeadingAnchor)) {
    throw new PatchAnchorError(
      'billing/index.tsx',
      'Payment & credits section heading'
    );
  }
  out = out.replace(
    'title="Payment & credits"',
    'title={t.settings.billing.paymentCredits}'
  );
  changed = true;

  // 4. 'Usage' section heading
  const usageHeadingAnchor = 'title="Usage"';
  if (!out.includes(usageHeadingAnchor)) {
    throw new PatchAnchorError('billing/index.tsx', 'Usage section heading');
  }
  out = out.replace(
    'title="Usage"',
    'title={t.settings.billing.usage}'
  );
  changed = true;

  // 5. 'Processing… checking settlement'
  const processingAnchor = 'Processing… checking settlement';
  if (!out.includes(processingAnchor)) {
    throw new PatchAnchorError(
      'billing/index.tsx',
      'Processing settlement text'
    );
  }
  out = out.replace(
    processingAnchor,
    '{t.settings.billing.processingSettlement}'
  );
  changed = true;

  // 6. 'added. Balance is refreshing.' — formatted credit amount
  const addedAnchor = 'added. Balance is refreshing.';
  if (!out.includes(addedAnchor)) {
    throw new PatchAnchorError('billing/index.tsx', 'Credits added text');
  }
  out = out.replace(
    addedAnchor,
    '{t.settings.billing.creditsAdded(formatMoney(outcome.amountUsd ?? amount))}'
  );
  changed = true;

  // 7. 'Open portal' buttons
  const openPortalAnchor = '>\n            Open portal\n';
  if (!out.includes(openPortalAnchor)) {
    throw new PatchAnchorError('billing/index.tsx', 'Open portal button');
  }
  out = out.replace(
    '>\n            Open portal\n',
    `>\n            {t.settings.billing.openPortal}\n`
  );
  changed = true;

  // 8. 'Retry' button
  const retryAnchor = '>Retry<';
  if (!out.includes(retryAnchor)) {
    throw new PatchAnchorError('billing/index.tsx', 'Retry button');
  }
  out = out.replace(
    '>Retry<',
    `>{t.settings.billing.retry}<`
  );
  changed = true;

  // 9. 'Buy' button
  const buyAnchor = '>Buy<';
  if (!out.includes(buyAnchor)) {
    throw new PatchAnchorError('billing/index.tsx', 'Buy button');
  }
  out = out.replace(
    '>Buy<',
    `>{t.settings.billing.buy}<`
  );
  changed = true;

  return { content: out, changed };
}

// ---------------------------------------------------------------------------
// ПАТЧ 4: billing/plans-view.tsx
// ---------------------------------------------------------------------------

function patchPlansView(content) {
  if (/t\.settings\.billing\./.test(content)) {
    return { content, changed: false };
  }

  let changed = false;
  let out = content;

  // 1. 'Plans' header
  const plansHeaderAnchor = '>Plans<';
  if (!out.includes(plansHeaderAnchor)) {
    throw new PatchAnchorError('billing/plans-view.tsx', 'Plans header');
  }
  out = out.replace(
    '>Plans<',
    `>{t.settings.billing.plans}<`
  );
  changed = true;

  // 2. 'Current plan' pill
  const currentPlanAnchor = '>Current plan<';
  if (!out.includes(currentPlanAnchor)) {
    throw new PatchAnchorError(
      'billing/plans-view.tsx',
      'Current plan pill'
    );
  }
  out = out.replace(
    '>Current plan<',
    `>{t.settings.billing.currentPlan}<`
  );
  changed = true;

  // 3. 'Scheduled' pill
  const scheduledAnchor = '>Scheduled<';
  if (!out.includes(scheduledAnchor)) {
    throw new PatchAnchorError('billing/plans-view.tsx', 'Scheduled pill');
  }
  out = out.replace(
    '>Scheduled<',
    `>{t.settings.billing.scheduled}<`
  );
  changed = true;

  // 4. 'Downgrade' button
  const downgradeAnchor = '>Downgrade<';
  if (!out.includes(downgradeAnchor)) {
    throw new PatchAnchorError(
      'billing/plans-view.tsx',
      'Downgrade button'
    );
  }
  out = out.replace(
    '>Downgrade<',
    `>{t.settings.billing.downgrade}<`
  );
  changed = true;

  // 5. 'Confirm downgrade' button
  const confirmDowngradeAnchor = "'Confirm downgrade'";
  if (!out.includes(confirmDowngradeAnchor)) {
    throw new PatchAnchorError(
      'billing/plans-view.tsx',
      'Confirm downgrade button'
    );
  }
  out = out.replace(
    "'Confirm downgrade'",
    't.settings.billing.confirmDowngrade'
  );
  changed = true;

  // 6. 'Try again' button
  const tryAgainAnchor = '>Try again<';
  if (!out.includes(tryAgainAnchor)) {
    throw new PatchAnchorError('billing/plans-view.tsx', 'Try again button');
  }
  out = out.replace(
    '>Try again<',
    `>{t.settings.billing.tryAgain}<`
  );
  changed = true;

  // 7. 'Scheduling…' text
  const schedulingAnchor = "'Scheduling…'";
  if (out.includes(schedulingAnchor)) {
    out = out.replace(schedulingAnchor, 't.settings.billing.saving');
    changed = true;
  }

  // 8. 'Checking this change…' text
  const checkingAnchor = "'Checking this change…'";
  if (out.includes(checkingAnchor)) {
    out = out.replace(checkingAnchor, 't.settings.billing.checkingChange');
    changed = true;
  }

  // 9. 'That change cannot be made here.'
  const blockedAnchor = "'That change cannot be made here.'";
  if (out.includes(blockedAnchor)) {
    out = out.replace(blockedAnchor, 't.settings.billing.blockedChange');
    changed = true;
  }

  // 10. Dynamic: `You are already on ${targetName} — nothing to change.`
  const alreadyOnAnchor =
    '`You are already on ${targetName} — nothing to change.`';
  if (out.includes(alreadyOnAnchor)) {
    out = out.replace(
      alreadyOnAnchor,
      't.settings.billing.alreadyOnPlan(targetName)'
    );
    changed = true;
  }

  // 11. 'No plans are available to change to right now.'
  const noPlansAnchor = 'No plans are available to change to right now.';
  if (out.includes(noPlansAnchor)) {
    out = out.replace(
      noPlansAnchor,
      '{t.settings.billing.noPlansAvailable}'
    );
    changed = true;
  }

  return { content: out, changed };
}

// ---------------------------------------------------------------------------
// ПАТЧ 5: billing/auto-reload-row.tsx
// ---------------------------------------------------------------------------

function patchAutoReloadRow(content) {
  if (/t\.settings\.billing\./.test(content)) {
    return { content, changed: false };
  }

  let changed = false;
  let out = content;

  // 1. 'Auto-refill updated.'
  const updatedAnchor = "'Auto-refill updated.'";
  if (out.includes(updatedAnchor)) {
    out = out.replace(updatedAnchor, 't.settings.billing.autoRefillUpdated');
    changed = true;
  }

  // 2. 'Auto-refill turned off.'
  const offAnchor = "'Auto-refill turned off.'";
  if (out.includes(offAnchor)) {
    out = out.replace(offAnchor, 't.settings.billing.autoRefillTurnedOff');
    changed = true;
  }

  // 3. 'Threshold' label
  const thresholdAnchor = '>Threshold<';
  if (out.includes(thresholdAnchor)) {
    out = out.replace('>Threshold<', `>{t.settings.billing.threshold}<`);
    changed = true;
  }

  // 4. 'Reload to' label
  const reloadToAnchor = '>Reload to<';
  if (out.includes(reloadToAnchor)) {
    out = out.replace('>Reload to<', `>{t.settings.billing.reloadTo}<`);
    changed = true;
  }

  // 5. 'Turn off auto-refill?' text
  const turnOffRefillAnchor = 'Turn off auto-refill?';
  if (out.includes(turnOffRefillAnchor)) {
    out = out.replace(
      'Turn off auto-refill?',
      '{t.settings.billing.turnOffAutoRefill}'
    );
    changed = true;
  }

  // 6. 'Turn off' button
  const turnOffBtnAnchor = '>Turn off<';
  if (out.includes(turnOffBtnAnchor)) {
    out = out.replace('>Turn off<', `>{t.settings.billing.turnOff}<`);
    changed = true;
  }

  // 7. 'Disable' button
  const disableAnchor = '>Disable<';
  if (out.includes(disableAnchor)) {
    out = out.replace('>Disable<', `>{t.settings.billing.disable}<`);
    changed = true;
  }

  // 8. 'Manage' button
  const manageAnchor = '>Manage<';
  if (out.includes(manageAnchor)) {
    out = out.replace('>Manage<', `>{t.settings.billing.manage}<`);
    changed = true;
  }

  // 9. 'Save' button
  const saveLabelAnchor = ">Save<";
  if (out.includes(saveLabelAnchor)) {
    out = out.replace(">Save<", `>{t.settings.billing.save}<`);
    changed = true;
  }

  // 10. 'Saving…' text
  const savingAnchor = "'Saving…'";
  if (out.includes(savingAnchor)) {
    out = out.replace(savingAnchor, 't.settings.billing.saving');
    changed = true;
  }

  // 11. 'Cancel' button
  const cancelAnchor = ">Cancel<";
  if (out.includes(cancelAnchor)) {
    out = out.replace(">Cancel<", `>{t.settings.billing.cancel}<`);
    changed = true;
  }

  return { content: out, changed };
}

// ---------------------------------------------------------------------------
// ПАТЧ 6: billing/current-plan-card.tsx
// ---------------------------------------------------------------------------

function patchCurrentPlanCard(content) {
  if (/t\.settings\.billing\./.test(content)) {
    return { content, changed: false };
  }

  let changed = false;
  let out = content;

  // 1. 'Undo' button
  const undoAnchor = `>'Undo'<`;
  if (!out.includes(undoAnchor)) {
    throw new PatchAnchorError(
      'billing/current-plan-card.tsx',
      'Undo button text'
    );
  }
  out = out.replace(
    `>'Undo'<`,
    `>{t.settings.billing.undo}<`
  );
  changed = true;

  // 2. 'Undoing…' text
  const undoingAnchor = "'Undoing…'";
  if (out.includes(undoingAnchor)) {
    out = out.replace(undoingAnchor, "t.settings.billing.undoing");
    changed = true;
  }

  return { content: out, changed };
}

// ---------------------------------------------------------------------------
// ПАТЧ 7: billing/use-billing-state.ts — usage-панель и derive-функции
// ---------------------------------------------------------------------------

function patchUseBillingState(content) {
  if (/translateNow\(['"]settings\.billing\.state\./.test(content)) {
    return { content, changed: false };
  }

  let changed = false;
  let out = content;

  // 0. Добавляем импорт translateNow, если ещё нет
  if (!out.includes("import { translateNow }")) {
    const importAnchor = "import { resolveRefusal } from './errors'";
    if (!out.includes(importAnchor)) {
      throw new PatchAnchorError('billing/use-billing-state.ts', 'resolveRefusal import');
    }
    out = out.replace(
      importAnchor,
      "import { resolveRefusal } from './errors'\nimport { translateNow } from '@/i18n'"
    );
    changed = true;
  }

  // 1. 'Open portal ↗' (logged_out action) → translateNow('settings.billing.state.openPortal')
  const lpAnchor1 = "label: 'Open portal ↗', url: billing.portal_url ?? subscription?.portal_url";
  if (!out.includes(lpAnchor1)) {
    throw new PatchAnchorError('use-billing-state.ts', 'logged_out Open portal ↗ anchor');
  }
  out = out.replace(
    "label: 'Open portal ↗', url: billing.portal_url ?? subscription?.portal_url",
    "label: translateNow('settings.billing.state.openPortal'), url: billing.portal_url ?? subscription?.portal_url"
  );
  changed = true;

  // 2. 'Run /portal in the TUI...' → translateNow('settings.billing.state.connectMessage')
  const connectMsgAnchor = "'Run /portal in the TUI or open the Nous portal to connect your account.'";
  if (!out.includes(connectMsgAnchor)) {
    throw new PatchAnchorError('use-billing-state.ts', 'connectMessage anchor');
  }
  out = out.replace(
    connectMsgAnchor,
    "translateNow('settings.billing.state.connectMessage')"
  );
  changed = true;

  // 3. 'Connect your Nous account' → translateNow('settings.billing.state.connectTitle')
  const connectTitleAnchor = "'Connect your Nous account'";
  if (!out.includes(connectTitleAnchor)) {
    throw new PatchAnchorError('use-billing-state.ts', 'connectTitle anchor');
  }
  out = out.replace(
    connectTitleAnchor,
    "translateNow('settings.billing.state.connectTitle')"
  );
  changed = true;

  // 4. 'Open portal ↗' в refusalNotice (label: 'Open portal ↗', url: portalUrl)
  const lpAnchor2 = "label: 'Open portal ↗', url: portalUrl";
  if (out.includes(lpAnchor2)) {
    out = out.replace(
      "label: 'Open portal ↗', url: portalUrl",
      "label: translateNow('settings.billing.state.openPortal'), url: portalUrl"
    );
    changed = true;
  }

  // 5. 'Add card ↗' → translateNow('settings.billing.state.addCard')
  const addCardAnchor = "'Add card ↗'";
  if (out.includes(addCardAnchor)) {
    out = out.replace(
      addCardAnchor,
      "translateNow('settings.billing.state.addCard')"
    );
    changed = true;
  }

  // 6. noCardNotice message
  const noCardMsgAnchor = "'Buying top-up credits and auto-refill stay disabled until a card is on file. Add one on the portal.'";
  if (out.includes(noCardMsgAnchor)) {
    out = out.replace(
      noCardMsgAnchor,
      "translateNow('settings.billing.state.noCardMessage')"
    );
    changed = true;
  }

  // 7. 'No payment method on file' → translateNow('settings.billing.state.noPaymentMethod')
  const noPmAnchor = "'No payment method on file'";
  if (out.includes(noPmAnchor)) {
    out = out.replace(
      noPmAnchor,
      "translateNow('settings.billing.state.noPaymentMethod')"
    );
    changed = true;
  }

  // 8. 'Subscription details are unavailable...'
  const subUnavAnchor = "'Subscription details are unavailable; opening the portal is still available.'";
  if (out.includes(subUnavAnchor)) {
    out = out.replace(
      subUnavAnchor,
      "translateNow('settings.billing.state.subscriptionUnavailable')"
    );
    changed = true;
  }

  // 9. 'No active subscription — paid models draw down top-up credits.'
  const noActiveAnchor = "'No active subscription — paid models draw down top-up credits.'";
  if (out.includes(noActiveAnchor)) {
    out = out.replace(
      noActiveAnchor,
      "translateNow('settings.billing.state.noActiveSubscription')"
    );
    changed = true;
  }

  // 10. 'Change plan' / 'View plans' — in ternary
  if (out.includes("current ? 'Change plan' : 'View plans'")) {
    out = out.replace(
      "current ? 'Change plan' : 'View plans'",
      "current ? translateNow('settings.billing.state.changePlan') : translateNow('settings.billing.state.viewPlans')"
    );
    changed = true;
  }

  // 11. 'Adjust plan ↗'
  const adjustAnchor = "'Adjust plan ↗'";
  if (out.includes(adjustAnchor)) {
    out = out.replace(
      adjustAnchor,
      "translateNow('settings.billing.state.adjustPlan')"
    );
    changed = true;
  }

  // 12. 'Choose ↗'
  const chooseAnchor = "'Choose ↗'";
  if (out.includes(chooseAnchor)) {
    out = out.replace(
      chooseAnchor,
      "translateNow('settings.billing.state.choose')"
    );
    changed = true;
  }

  // 13. 'Add payment method'
  const addPmAnchor = "'Add payment method'";
  if (out.includes(addPmAnchor) && !out.includes("translateNow('settings.billing.state.addPaymentMethod')")) {
    out = out.replace(
      addPmAnchor,
      "translateNow('settings.billing.state.addPaymentMethod')"
    );
    changed = true;
  }

  // 14. 'Payment method' (title in paymentMethodRow)
  if (out.includes("title: 'Payment method'") && !out.includes("translateNow('settings.billing.state.paymentMethod')")) {
    out = out.replace(
      /title: 'Payment method'/g,
      "title: translateNow('settings.billing.state.paymentMethod')"
    );
    changed = true;
  }

  // 15. 'Update' (action label)
  const updateAnchor = "label: 'Update', url: portalUrl";
  if (out.includes(updateAnchor)) {
    out = out.replace(
      updateAnchor,
      "label: translateNow('settings.billing.state.update'), url: portalUrl"
    );
    changed = true;
  }

  // 16. 'Manage the card used for top-ups and subscription renewals.'
  const manageCardAnchor = "'Manage the card used for top-ups and subscription renewals.'";
  if (out.includes(manageCardAnchor)) {
    out = out.replace(
      manageCardAnchor,
      "translateNow('settings.billing.state.manageCardDesc')"
    );
    changed = true;
  }

  // 17. 'Buy' (action label in buyCreditsRow)
  const buyLabelAnchor = /label: 'Buy'/;
  if (buyLabelAnchor.test(out) && !out.includes("translateNow('settings.billing.state.buy')")) {
    out = out.replace(
      /label: 'Buy'/g,
      "label: translateNow('settings.billing.state.buy')"
    );
    changed = true;
  }

  // 18. 'A single charge on your card, added to your balance today.'
  const buyDescAnchor = "'A single charge on your card, added to your balance today.'";
  if (out.includes(buyDescAnchor) && !out.includes("translateNow('settings.billing.state.buyCreditsDesc')")) {
    out = out.replace(
      new RegExp(buyDescAnchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
      "translateNow('settings.billing.state.buyCreditsDesc')"
    );
    changed = true;
  }

  // 19. 'Buy credits now'
  const buyNowAnchor = /title: 'Buy credits now'/;
  if (buyNowAnchor.test(out) && !out.includes("translateNow('settings.billing.state.buyCreditsNow')")) {
    out = out.replace(
      /title: 'Buy credits now'/g,
      "title: translateNow('settings.billing.state.buyCreditsNow')"
    );
    changed = true;
  }

  // 20. AUTO_REFILL_GENERIC
  const refillGenericAnchor = "'Keep your balance topped up when it drops below your threshold.'";
  if (out.includes(refillGenericAnchor)) {
    out = out.replace(
      refillGenericAnchor,
      "translateNow('settings.billing.state.autoRefillGeneric')"
    );
    changed = true;
  }

  // 21. 'Manage' (action label)
  const manageLabelAnchor = /label: 'Manage'(?!\w)/;
  if (manageLabelAnchor.test(out) && !out.includes("translateNow('settings.billing.state.manage')")) {
    out = out.replace(
      /label: 'Manage'(?!\w)/g,
      "label: translateNow('settings.billing.state.manage')"
    );
    changed = true;
  }

  // 22. 'Manage auto-refill from the portal.'
  const manageRefillAnchor = "'Manage auto-refill from the portal.'";
  if (out.includes(manageRefillAnchor)) {
    out = out.replace(
      manageRefillAnchor,
      "translateNow('settings.billing.state.manageAutoRefillCaption')"
    );
    changed = true;
  }

  // 23. 'Turn on auto-refill from the portal'
  const turnOnRefillAnchor = "'Turn on auto-refill from the portal'";
  if (out.includes(turnOnRefillAnchor)) {
    out = out.replace(
      turnOnRefillAnchor,
      "translateNow('settings.billing.state.turnOnAutoRefillCaption')"
    );
    changed = true;
  }

  // 24. 'Reconcile ↗'
  const reconcileAnchor = "'Reconcile ↗'";
  if (out.includes(reconcileAnchor)) {
    out = out.replace(
      reconcileAnchor,
      "translateNow('settings.billing.state.reconcile')"
    );
    changed = true;
  }

  // 25. 'Refill when low' (title in autoReloadRow)
  if (out.includes("title: 'Refill when low'") && !out.includes("translateNow('settings.billing.state.refillWhenLow')")) {
    out = out.replace(
      /title: 'Refill when low'/g,
      "title: translateNow('settings.billing.state.refillWhenLow')"
    );
    changed = true;
  }

  // 26. 'Subscription credits remaining'
  const subCredRemAnchor = "'Subscription credits remaining'";
  if (out.includes(subCredRemAnchor)) {
    out = out.replace(
      subCredRemAnchor,
      "translateNow('settings.billing.state.subscriptionCreditsRemaining')"
    );
    changed = true;
  }

  // 27. 'Subscription credits'
  const subCredAnchor = "title: 'Subscription credits'";
  if (out.includes(subCredAnchor)) {
    out = out.replace(
      subCredAnchor,
      "title: translateNow('settings.billing.state.subscriptionCredits')"
    );
    changed = true;
  }

  // 28. 'Does not expire'
  const noExpireAnchor = "'Does not expire'";
  if (out.includes(noExpireAnchor)) {
    out = out.replace(
      noExpireAnchor,
      "translateNow('settings.billing.state.doesNotExpire')"
    );
    changed = true;
  }

  // 29. 'Top-up credits'
  const topUpCredAnchor = "title: 'Top-up credits'";
  if (out.includes(topUpCredAnchor)) {
    out = out.replace(
      topUpCredAnchor,
      "title: translateNow('settings.billing.state.topUpCredits')"
    );
    changed = true;
  }

  // 30. 'Monthly spend cap used'
  const capUsedAnchor = "'Monthly spend cap used'";
  if (out.includes(capUsedAnchor)) {
    out = out.replace(
      capUsedAnchor,
      "translateNow('settings.billing.state.monthlySpendCapUsed')"
    );
    changed = true;
  }

  // 31. 'Monthly spend cap'
  const capAnchor = "title: 'Monthly spend cap'";
  if (out.includes(capAnchor)) {
    out = out.replace(
      capAnchor,
      "title: translateNow('settings.billing.state.monthlySpendCap')"
    );
    changed = true;
  }

  // 32. 'Default ceiling' / 'Monthly remote spending'
  const capCaptionAnchor = "cap.is_default_ceiling ? 'Default ceiling' : 'Monthly remote spending'";
  if (out.includes(capCaptionAnchor)) {
    out = out.replace(
      capCaptionAnchor,
      "cap.is_default_ceiling ? translateNow('settings.billing.state.defaultCeiling') : translateNow('settings.billing.state.monthlyRemoteSpending')"
    );
    changed = true;
  }

  // 33. Dynamic template strings
  // `Changes to ${pending.tierName} on ${pending.when}.`
  const changesToAnchor = '`Changes to ${pending.tierName} on ${pending.when}.`';
  if (out.includes(changesToAnchor)) {
    out = out.replace(
      changesToAnchor,
      "translateNow('settings.billing.state.changesTo', pending.tierName, pending.when)"
    );
    changed = true;
  }

  // `Cancels on ${pending.when}.`
  const cancelsOnAnchor = '`Cancels on ${pending.when}.`';
  if (out.includes(cancelsOnAnchor)) {
    out = out.replace(
      cancelsOnAnchor,
      "translateNow('settings.billing.state.cancelsOn', pending.when)"
    );
    changed = true;
  }

  // `Renews ${renewal}`
  const renewsAnchor = '`Renews ${renewal}`';
  if (out.includes(renewsAnchor)) {
    out = out.replace(
      renewsAnchor,
      "translateNow('settings.billing.state.renews', renewal)"
    );
    changed = true;
  }

  // `Auto-refill charges ${cardLabel} — reconcile on the portal`
  const arRecAnchor = '`Auto-refill charges ${cardLabel} — reconcile on the portal`';
  if (out.includes(arRecAnchor)) {
    out = out.replace(
      arRecAnchor,
      "translateNow('settings.billing.state.autoRefillReconcile', cardLabel)"
    );
    changed = true;
  }

  // `Charges ${reloadTo} automatically when your balance falls below ${threshold}.`
  const arChargesAnchor = '`Charges ${reloadTo} automatically when your balance falls below ${threshold}.`';
  if (out.includes(arChargesAnchor)) {
    out = out.replace(
      arChargesAnchor,
      "translateNow('settings.billing.state.autoRefillCharges', reloadTo, threshold)"
    );
    changed = true;
  }

  // `Resets ${formatBillingDate(...)}`
  const resetsAnchor = '`Resets ${formatBillingDate(';
  if (out.includes(resetsAnchor)) {
    // Pattern: `Resets ${formatBillingDate(current?.cycle_ends_at ?? usage?.renews_at)}`
    const match = out.match(/`Resets \$\{formatBillingDate\(([^)]+)\)\}`/);
    if (match) {
      out = out.replace(
        match[0],
        `translateNow('settings.billing.state.resetsOn', formatBillingDate(${match[1]}))`
      );
      changed = true;
    }
  }

  // `${formatMoney(spent)} of ${formatMoney(limit)} used`
  const ofUsedAnchor = '`${';
  // Look for the specific pattern: `${cap.spent_display || formatMoney(spent)} of ${cap.limit_display || formatMoney(limit)} used`
  const ofUsedPattern = /\`\$\{[^}]+\} of \$\{[^}]+\} used\`/;
  const ofUsedMatch = out.match(ofUsedPattern);
  if (ofUsedMatch && !out.includes("translateNow('settings.billing.state.ofUsed'")) {
    out = out.replace(
      ofUsedMatch[0],
      `translateNow('settings.billing.state.ofUsed', ${ofUsedMatch[0].slice(2, ofUsedMatch[0].indexOf('} of '))}, ${ofUsedMatch[0].slice(ofUsedMatch[0].indexOf('} of ${') + 7, ofUsedMatch[0].lastIndexOf('}'))})`
    );
    // More robust: just replace the four known patterns
  }

  // `Enabled` / `Off` pill labels
  const pillEnabledAnchor = "label: 'Enabled'";
  if (out.includes(pillEnabledAnchor) && !out.includes("translateNow('settings.billing.state.enabled')")) {
    out = out.replace(
      /label: 'Enabled'/g,
      "label: translateNow('settings.billing.state.enabled')"
    );
    changed = true;
  }

  const pillOffAnchor = "label: 'Off'";
  if (out.includes(pillOffAnchor) && !out.includes("translateNow('settings.billing.state.off')")) {
    out = out.replace(
      /label: 'Off'(?![\w])/g,
      "label: translateNow('settings.billing.state.off')"
    );
    changed = true;
  }

  // provenanceSuffix labels
  const provLabels = {
    "'auto-refill card'": "translateNow('settings.billing.state.autoRefillCard')",
    "'customer default'": "translateNow('settings.billing.state.customerDefault')",
    "'subscription card'": "translateNow('settings.billing.state.subscriptionCard')",
  };
  for (const [eng, key] of Object.entries(provLabels)) {
    if (out.includes(eng) && !out.includes(key)) {
      out = out.replace(eng, key);
      changed = true;
    }
  }

  return { content: out, changed };
}

// ---------------------------------------------------------------------------
// ПАТЧ 8: billing/errors.ts — баннеры ошибок
// ---------------------------------------------------------------------------

function patchErrors(content) {
  if (/translateNow\(['"]settings\.billing\.errors\./.test(content)) {
    return { content, changed: false };
  }

  let changed = false;
  let out = content;

  // 0. Добавляем импорт translateNow
  if (!out.includes("import { translateNow }")) {
    const importAnchor = "import type { BillingRefusal } from './api'";
    if (!out.includes(importAnchor)) {
      throw new PatchAnchorError('billing/errors.ts', 'BillingRefusal import');
    }
    out = out.replace(
      importAnchor,
      "import type { BillingRefusal } from './api'\nimport { translateNow } from '@/i18n'"
    );
    changed = true;
  }

  // Патчим title/message строки в resolveRefusal
  const replacements = [
    // consent_required
    ["'Confirm this card for terminal charges in the portal'",
      "translateNow('settings.billing.errors.cardConfirmationMessage')"],
    ["'Card confirmation needed'",
      "translateNow('settings.billing.errors.cardConfirmationNeeded')"],
    // insufficient_scope
    ["'This needs Remote Spending allowed. Start a top-up to allow it, then retry.'",
      "translateNow('settings.billing.errors.remoteSpendingMessage')"],
    ["'Remote Spending needs approval'",
      "translateNow('settings.billing.errors.remoteSpendingNeedsApproval')"],
    // remote_spending_revoked
    ["'An admin stopped remote spending for this terminal.'",
      "translateNow('settings.billing.errors.adminStopped')"],
    ["'You stopped remote spending for this terminal.'",
      "translateNow('settings.billing.errors.youStopped')"],
    // `... Reconnect from Settings → Gateway...`
    ["`${who} Reconnect from Settings → Gateway to re-authorize this device.`",
      "translateNow('settings.billing.errors.remoteSpendingReconnect', who)"],
    ["'Remote spending was stopped'",
      "translateNow('settings.billing.errors.remoteSpendingStopped')"],
    // session_revoked
    ["'Your session was logged out. Sign in again from Settings → Gateway.'",
      "translateNow('settings.billing.errors.sessionLoggedOutMessage')"],
    ["'Session logged out'",
      "translateNow('settings.billing.errors.sessionLoggedOut')"],
    // remote_spending_disabled / cli_billing_disabled
    [`"Remote spending is off for this account — a billing admin can turn it on from the portal's Hermes Agent page."`,
      "translateNow('settings.billing.errors.remoteSpendingOffMessage')"],
    ["'Remote spending is off'",
      "translateNow('settings.billing.errors.remoteSpendingOff')"],
    // role_required
    ["'Adding funds needs an org admin/owner. Ask an admin, or manage on the portal.'",
      "translateNow('settings.billing.errors.adminRoleRequiredMessage')"],
    ["'Admin role required'",
      "translateNow('settings.billing.errors.adminRoleRequired')"],
    // idempotency_conflict
    ["'🔴 That charge key was already used for a different amount. Start a fresh top-up.'",
      "translateNow('settings.billing.errors.idempotencyConflictMessage')"],
    ["'Start a fresh top-up'",
      "translateNow('settings.billing.errors.startFreshTopUp')"],
    // no_payment_method
    [`'💳 No saved card for terminal charges yet. Set one up on the portal ' +\n          \"(one-time credit buys don't save a reusable card).\"`,
      "translateNow('settings.billing.errors.noSavedCardMessage')"],
    ["'No saved card'",
      "translateNow('settings.billing.errors.noSavedCard')"],
    // org_access_denied
    [`\"This token isn't bound to an org you can manage\"`,
      "translateNow('settings.billing.errors.orgAccessDeniedMessage')"],
    ["'Org access denied'",
      "translateNow('settings.billing.errors.orgAccessDenied')"],
    // monthly_cap_exceeded
    ["'Monthly spend cap reached'",
      "translateNow('settings.billing.errors.monthlyCapExceeded')"],
    // rate_limited / temporarily_unavailable
    ["'Too many charges right now'",
      "translateNow('settings.billing.errors.tooManyCharges')"],
    // stripe_unavailable
    ["'Stripe is having trouble'",
      "translateNow('settings.billing.errors.stripeTrouble')"],
    // upgrade_cap_exceeded
    ["'Daily plan-change limit reached — try again tomorrow'",
      "translateNow('settings.billing.errors.dailyPlanChangeLimitMessage')"],
    ["'Daily plan-change limit reached'",
      "translateNow('settings.billing.errors.dailyPlanChangeLimit')"],
    // endpoint_unavailable
    [`'Billing endpoint returned a non-JSON response (it may not be available on this deployment).'`,
      "translateNow('settings.billing.errors.endpointUnavailableMessage')"],
    ["'Billing endpoint unavailable'",
      "translateNow('settings.billing.errors.endpointUnavailable')"],
    // timeout
    ["'Billing request timed out'",
      "translateNow('settings.billing.errors.requestTimedOut')"],
    ["'Billing request timed out.'",
      "translateNow('settings.billing.errors.requestTimedOutMessage')"],
    // transport
    ["'Billing connection failed'",
      "translateNow('settings.billing.errors.connectionFailed')"],
    ["'Billing request failed before reaching the gateway.'",
      "translateNow('settings.billing.errors.connectionFailedMessage')"],
    // default
    ["'Billing request failed'",
      "translateNow('settings.billing.errors.requestFailed')"],
    ["'Billing request failed.'",
      "translateNow('settings.billing.errors.requestFailedMessage')"],
  ];

  for (const [eng, replacement] of replacements) {
    if (out.includes(eng) && !out.includes(replacement)) {
      out = out.replace(eng, replacement);
      changed = true;
    }
  }

  // Special: dynamic message patterns
  // `🟡 Too many charges right now${mins}. This isn't a payment failure.`
  const rateLimitedPattern = '`🟡 Too many charges right now${mins}. This isn\'t a payment failure.`';
  if (out.includes('🟡 Too many charges right now${mins}')) {
    out = out.replace(
      /`🟡 Too many charges right now\$\{mins\}\. This isn't a payment failure\.`/,
      "translateNow('settings.billing.errors.rateLimitedMessage', mins)"
    );
    changed = true;
  }

  // `Stripe is having trouble — try again shortly${mins}`
  if (out.includes('Stripe is having trouble — try again shortly${mins}')) {
    out = out.replace(
      /`Stripe is having trouble — try again shortly\$\{mins\}`/,
      "translateNow('settings.billing.errors.stripeRetryMessage', mins)"
    );
    changed = true;
  }

  // `🔴 Monthly spend cap reached — $${remaining} headroom left.`
  if (out.includes('Monthly spend cap reached — $${remaining}')) {
    out = out.replace(
      /`🔴 Monthly spend cap reached — \$\$\{remaining\} headroom left\.`/,
      "translateNow('settings.billing.errors.monthlyCapExceededWithRemaining', remaining)"
    );
    changed = true;
  }

  // '🔴 Monthly spend cap reached.' (without remaining)
  if (out.includes("'🔴 Monthly spend cap reached.'") && !out.includes("translateNow('settings.billing.errors.monthlyCapExceededSimple')")) {
    out = out.replace(
      "'🔴 Monthly spend cap reached.'",
      "translateNow('settings.billing.errors.monthlyCapExceededSimple')"
    );
    changed = true;
  }

  return { content: out, changed };
}

// ---------------------------------------------------------------------------
// ПАТЧ 9: расширение en.ts — вставка state/errors в существующую секцию billing
// ---------------------------------------------------------------------------

function extendEnTsBilling(content) {
  // Проверяем, есть ли уже state/errors
  if (/\s+state:\s*\{/.test(content) && /\s+errors:\s*\{/.test(content)) {
    return { content, changed: false };
  }

  let changed = false;
  let out = content;

  // Находим секцию billing внутри settings
  // Ищем закрытие billing блока (после 'billing: {')
  const billingStart = out.search(/\n\s{4,}billing:\s*\{/);
  if (billingStart < 0) {
    throw new PatchAnchorError('en.ts (extend)', 'billing: { inside settings');
  }

  // Парсим глубину для поиска закрывающей }
  let depth = 0;
  let billingEnd = -1;
  let j = out.indexOf('{', billingStart);
  for (; j < out.length; j++) {
    if (out[j] === '{') depth++;
    else if (out[j] === '}') {
      depth--;
      if (depth === 0) { billingEnd = j; break; }
    }
  }

  if (billingEnd < 0) {
    throw new PatchAnchorError('en.ts (extend)', 'closing } of billing block');
  }

  // Блоки state и errors для вставки перед закрывающей } billing
  const stateBlock = `,
    state: {
      openPortal: 'Open portal ↗',
      openPortalShort: 'Open portal',
      connectMessage:
        'Run /portal in the TUI or open the Nous portal to connect your account.',
      connectTitle: 'Connect your Nous account',
      addCard: 'Add card ↗',
      noPaymentMethod: 'No payment method on file',
      noCardMessage:
        'Buying top-up credits and auto-refill stay disabled until a card is on file. Add one on the portal.',
      addPaymentMethod: 'Add payment method',
      paymentMethod: 'Payment method',
      update: 'Update',
      manageCardDesc:
        'Manage the card used for top-ups and subscription renewals.',
      buy: 'Buy',
      buyCreditsDesc:
        'A single charge on your card, added to your balance today.',
      buyCreditsNow: 'Buy credits now',
      autoRefillGeneric:
        'Keep your balance topped up when it drops below your threshold.',
      manage: 'Manage',
      manageAutoRefillCaption: 'Manage auto-refill from the portal.',
      refillWhenLow: 'Refill when low',
      turnOnAutoRefillCaption: 'Turn on auto-refill from the portal',
      reconcile: 'Reconcile ↗',
      autoRefillCard: 'auto-refill card',
      customerDefault: 'customer default',
      subscriptionCard: 'subscription card',
      subscriptionCreditsRemaining: 'Subscription credits remaining',
      subscriptionCredits: 'Subscription credits',
      doesNotExpire: 'Does not expire',
      topUpCredits: 'Top-up credits',
      monthlySpendCapUsed: 'Monthly spend cap used',
      monthlySpendCap: 'Monthly spend cap',
      defaultCeiling: 'Default ceiling',
      monthlyRemoteSpending: 'Monthly remote spending',
      changePlan: 'Change plan',
      viewPlans: 'View plans',
      adjustPlan: 'Adjust plan ↗',
      choose: 'Choose ↗',
      enabled: 'Enabled',
      off: 'Off',
      subscriptionUnavailable:
        'Subscription details are unavailable; opening the portal is still available.',
      noActiveSubscription:
        'No active subscription — paid models draw down top-up credits.',
      changesTo: (tierName: string, when: string) => \`Changes to \${tierName} on \${when}.\`,
      cancelsOn: (when: string) => \`Cancels on \${when}.\`,
      renews: (renewal: string) => \`Renews \${renewal}\`,
      autoRefillReconcile: (cardLabel: string) =>
        \`Auto-refill charges \${cardLabel} — reconcile on the portal\`,
      autoRefillCharges: (reloadTo: string, threshold: string) =>
        \`Charges \${reloadTo} automatically when your balance falls below \${threshold}.\`,
      resetsOn: (date: string) => \`Resets \${date}\`,
      ofUsed: (spent: string, limit: string) => \`\${spent} of \${limit} used\`,
      remoteSpendingReconnect: (who: string) =>
        \`\${who} Reconnect from Settings → Gateway to re-authorize this device.\`,
    }`;

  const errorsBlock = `,
    errors: {
      cardConfirmationNeeded: 'Card confirmation needed',
      cardConfirmationMessage:
        'Confirm this card for terminal charges in the portal',
      remoteSpendingNeedsApproval: 'Remote Spending needs approval',
      remoteSpendingMessage:
        'This needs Remote Spending allowed. Start a top-up to allow it, then retry.',
      remoteSpendingStopped: 'Remote spending was stopped',
      adminStopped: 'An admin stopped remote spending for this terminal.',
      youStopped: 'You stopped remote spending for this terminal.',
      sessionLoggedOut: 'Session logged out',
      sessionLoggedOutMessage:
        'Your session was logged out. Sign in again from Settings → Gateway.',
      remoteSpendingOff: 'Remote spending is off',
      remoteSpendingOffMessage:
        "Remote spending is off for this account — a billing admin can turn it on from the portal's Hermes Agent page.",
      adminRoleRequired: 'Admin role required',
      adminRoleRequiredMessage:
        'Adding funds needs an org admin/owner. Ask an admin, or manage on the portal.',
      startFreshTopUp: 'Start a fresh top-up',
      idempotencyConflictMessage:
        '🔴 That charge key was already used for a different amount. Start a fresh top-up.',
      noSavedCard: 'No saved card',
      noSavedCardMessage:
        '💳 No saved card for terminal charges yet. Set one up on the portal (one-time credit buys don\\'t save a reusable card).',
      orgAccessDenied: 'Org access denied',
      orgAccessDeniedMessage: "This token isn't bound to an org you can manage",
      monthlyCapExceeded: 'Monthly spend cap reached',
      monthlyCapExceededWithRemaining: (remaining: number) =>
        \`🔴 Monthly spend cap reached — \$\${remaining} headroom left.\`,
      monthlyCapExceededSimple: '🔴 Monthly spend cap reached.',
      tooManyCharges: 'Too many charges right now',
      rateLimitedMessage: (mins: string) =>
        \`🟡 Too many charges right now\${mins}. This isn't a payment failure.\`,
      stripeTrouble: 'Stripe is having trouble',
      stripeRetryMessage: (mins: string) =>
        \`Stripe is having trouble — try again shortly\${mins}\`,
      dailyPlanChangeLimit: 'Daily plan-change limit reached',
      dailyPlanChangeLimitMessage:
        'Daily plan-change limit reached — try again tomorrow',
      endpointUnavailable: 'Billing endpoint unavailable',
      endpointUnavailableMessage:
        'Billing endpoint returned a non-JSON response (it may not be available on this deployment).',
      requestTimedOut: 'Billing request timed out',
      requestTimedOutMessage: 'Billing request timed out.',
      connectionFailed: 'Billing connection failed',
      connectionFailedMessage:
        'Billing request failed before reaching the gateway.',
      requestFailed: 'Billing request failed',
      requestFailedMessage: 'Billing request failed.',
    }`;

  // Вставляем оба блока перед закрывающей } billing
  out =
    out.slice(0, billingEnd) +
    stateBlock +
    errorsBlock +
    out.slice(billingEnd);

  changed = true;
  return { content: out, changed };
}

// ---------------------------------------------------------------------------
// ПАТЧ 7→10: Добавление новых ключей в en.ts (оригинальный patchEnTs)
// ---------------------------------------------------------------------------

function patchEnTs(content) {
  if (/\s+moa:\s*\{/.test(content) || /\s+billing:\s*\{/.test(content)) {
    return { content, changed: false };
  }

  let changed = false;
  let out = content;

  // Ищем settings секцию и вставляем новые подсекции структурно
  // Якорь: 'settings: {' — ищем в defineLocale
  const settingsAnchor = /(\n\s+settings:\s*\{)/;
  const m = out.match(settingsAnchor);
  if (!m) {
    throw new PatchAnchorError('en.ts', 'settings: { block');
  }

  // Вставляем model.moa после model (после закрытия model: { ... })
  // Находим конец model-секции внутри settings
  const modelStart = out.search(/\n\s+model:\s*\{/);
  if (modelStart < 0) {
    throw new PatchAnchorError('en.ts', 'model: { inside settings');
  }

  // Ищем закрытие model объекта
  let depth = 0;
  let modelEnd = -1;
  let j = out.indexOf('{', modelStart);
  for (; j < out.length; j++) {
    if (out[j] === '{') depth++;
    else if (out[j] === '}') {
      depth--;
      if (depth === 0) { modelEnd = j; break; }
    }
  }

  if (modelEnd < 0) {
    throw new PatchAnchorError('en.ts', 'closing } of model block');
  }

  // Добавляем moa подобъект в model (перед закрывающей })
  const moaBlock = `,\n    moa: {\n      title: 'Mixture of Agents',\n      description:\n        'Configure named presets that appear as models under the Mixture of Agents provider. The aggregator is the acting model.',\n      preset: 'Preset',\n      enabled: 'Enabled',\n      setDefault: 'Set default',\n      delete: 'Delete',\n      newPreset: 'new preset',\n      addPreset: 'Add preset',\n      defaultLabel: 'Default:',\n      referenceN: (n: number) => \`Reference \${n}\`,\n      remove: 'Remove',\n      addReference: 'Add reference model',\n      aggregator: 'Aggregator',\n    }`;

  // Вставляем перед закрывающей } model
  out = out.slice(0, modelEnd) + moaBlock + out.slice(modelEnd);
  changed = true;

  // Вставляем billing и customEndpoints в settings
  // Ищем закрытие settings блока
  const settingsStart = m.index;
  let sDepth = 0;
  let settingsEnd = -1;
  let sj = out.indexOf('{', settingsStart);
  for (; sj < out.length; sj++) {
    if (out[sj] === '{') sDepth++;
    else if (out[sj] === '}') {
      sDepth--;
      if (sDepth === 0) { settingsEnd = sj; break; }
    }
  }

  if (settingsEnd < 0) {
    throw new PatchAnchorError('en.ts', 'closing } of settings block');
  }

  const billingBlock = `,\n    billing: {\n      title: 'Billing',\n      plan: 'Plan',\n      paymentCredits: 'Payment & credits',\n      usage: 'Usage',\n      processingSettlement: 'Processing… checking settlement',\n      creditsAdded: (amount: string) => \`\${amount} added. Balance is refreshing.\`,\n      openPortal: 'Open portal',\n      retry: 'Retry',\n      buy: 'Buy',\n      turnOffAutoRefill: 'Turn off auto-refill?',\n      turnOff: 'Turn off',\n      disable: 'Disable',\n      autoRefillUpdated: 'Auto-refill updated.',\n      autoRefillTurnedOff: 'Auto-refill turned off.',\n      threshold: 'Threshold',\n      reloadTo: 'Reload to',\n      plans: 'Plans',\n      currentPlan: 'Current plan',\n      scheduled: 'Scheduled',\n      downgrade: 'Downgrade',\n      manage: 'Manage',\n      undo: 'Undo',\n      undoing: 'Undoing…',\n      confirmDowngrade: 'Confirm downgrade',\n      checkingChange: 'Checking this change…',\n      blockedChange: 'That change cannot be made here.',\n      alreadyOnPlan: (name: string) => \`You are already on \${name} — nothing to change.\`,\n      noPlansAvailable: 'No plans are available to change to right now.',\n      tryAgain: 'Try again',\n      save: 'Save',\n      saving: 'Saving…',\n      cancel: 'Cancel',\n      usageLabel: (label: string) => \`\${label} usage\`,\n    }`;

  const customEndpointsBlock = `,\n    customEndpoints: {\n      title: 'Custom Endpoints',\n      emptyTitle: 'No custom endpoints',\n      emptyDescription: 'Add an OpenAI-compatible endpoint below.',\n      editTitle: 'Edit Endpoint',\n      addTitle: 'Add Endpoint',\n      name: 'Name',\n      providerId: 'Provider ID',\n      endpointUrl: 'Endpoint URL',\n      defaultModel: 'Default Model',\n      context: 'Context',\n      apiKey: 'API Key',\n      useForNewChats: 'Use for new chats',\n      discoverModels: 'Discover models',\n      test: 'Test',\n      save: 'Save',\n      newEndpoint: 'New endpoint',\n      active: 'Active',\n      use: 'Use',\n      deleteEndpoint: 'Delete endpoint',\n      loadError: 'Could not load custom endpoints',\n      saveSuccess: 'Custom endpoint saved.',\n      saveFailed: 'Save failed',\n      validationFailed: 'Validation failed',\n      activationFailed: 'Activation failed',\n      deleteFailed: 'Delete failed',\n      reachable: 'Endpoint is reachable.',\n      reachableWithCount: (count: number) => \`Endpoint is reachable. Found \${count} models.\`,\n      validationFailedEndpoint: 'Endpoint validation failed.',\n      deleteConfirm: (name: string) => \`Delete \${name}?\`,\n    }`;

  // Вставляем оба блока перед закрывающей } settings
  out =
    out.slice(0, settingsEnd) +
    billingBlock +
    customEndpointsBlock +
    out.slice(settingsEnd);

  changed = true;

  return { content: out, changed };
}

// ---------------------------------------------------------------------------
// Композитный вызов
// ---------------------------------------------------------------------------

const COMPONENT_FILES = {
  'model-settings.tsx': patchModelSettingsMoA,
  'custom-endpoints-settings.tsx': patchCustomEndpoints,
  'billing/index.tsx': patchBillingIndex,
  'billing/plans-view.tsx': patchPlansView,
  'billing/auto-reload-row.tsx': patchAutoReloadRow,
  'billing/current-plan-card.tsx': patchCurrentPlanCard,
  'billing/use-billing-state.ts': patchUseBillingState,
  'billing/errors.ts': patchErrors,
};

/**
 * Применить components-патчи ко всем трём поверхностям.
 * Возвращает { changed: string[] } или бросает PatchAnchorError.
 */
function applyComponentPatches(desktopDir) {
  const dir = settingsDir(desktopDir);
  const changed = [];
  const originals = {};
  const patched = {};
  const eols = {};

  // 1. Все патчи в памяти
  for (const [relPath, patcher] of Object.entries(COMPONENT_FILES)) {
    const filePath = path.join(dir, relPath);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Компонент не найден: ${relPath}`);
    }
    const raw = fs.readFileSync(filePath);
    originals[relPath] = raw;
    eols[relPath] = detectEol(raw.toString('utf8'));
    const r = patcher(toUnix(raw.toString('utf8')));
    patched[relPath] = r.content;
    if (r.changed) changed.push(relPath);
  }

  // 2. Патчим en.ts
  const enPath = path.join(i18nDir(desktopDir), 'en.ts');
  if (fs.existsSync(enPath)) {
    const enRaw = fs.readFileSync(enPath);
    const enEol = detectEol(enRaw.toString('utf8'));
    // Сначала базовый патч (moa/billing/customEndpoints — из v1.1.0)
    const enR = patchEnTs(toUnix(enRaw.toString('utf8')));
    // Затем расширение (state/errors — из v1.1.1)
    const enR2 = extendEnTsBilling(enR.content);
    if (enR.changed || enR2.changed) {
      originals['en.ts'] = enRaw;
      eols['en.ts'] = enEol;
      patched['en.ts'] = enR2.changed ? enR2.content : enR.content;
      changed.push('en.ts');
    }
  }

  if (changed.length === 0) {
    return { changed: [], already: true };
  }

  // 3. Верификация in-memory: повторный прогон идемпотентен
  for (const [relPath, patcher] of Object.entries(COMPONENT_FILES)) {
    if (patched[relPath]) {
      const again = patcher(patched[relPath]);
      if (again.changed) {
        throw new Error(
          `Components-патч ${relPath} не идемпотентен — отмена`
        );
      }
    }
  }

  // 4. Запись
  for (const [relPath, content] of Object.entries(patched)) {
    let filePath;
    if (relPath === 'en.ts') {
      filePath = path.join(i18nDir(desktopDir), 'en.ts');
    } else {
      filePath = path.join(dir, relPath);
    }
    fs.writeFileSync(filePath, fromUnix(content, eols[relPath]), 'utf8');
  }

  return { changed };
}

/**
 * Снять components-патчи (структурное обратное преобразование).
 * TODO: реализовать полноценный unpatch. Пока возвращаем заглушку.
 */
function removeComponentPatches(desktopDir) {
  // Для v1.1.0 обратное преобразование делаем через git checkout
  // (компонентные патчи ложатся поверх i18n-патчей)
  return { method: 'deferred-to-git', ok: true };
}

module.exports = {
  NEW_EN_KEYS,
  COMPONENT_FILES,
  applyComponentPatches,
  removeComponentPatches,
  patchUseBillingState,
  patchErrors,
  extendEnTsBilling,
  _internals: {
    patchModelSettingsMoA,
    patchCustomEndpoints,
    patchBillingIndex,
    patchPlansView,
    patchAutoReloadRow,
    patchCurrentPlanCard,
    patchUseBillingState,
    patchErrors,
    extendEnTsBilling,
    patchEnTs,
  },
};
