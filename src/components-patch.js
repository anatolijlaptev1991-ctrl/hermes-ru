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
// ПАТЧ 7: Добавление новых ключей в en.ts
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
    const enR = patchEnTs(toUnix(enRaw.toString('utf8')));
    if (enR.changed) {
      originals['en.ts'] = enRaw;
      eols['en.ts'] = enEol;
      patched['en.ts'] = enR.content;
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
  _internals: {
    patchModelSettingsMoA,
    patchCustomEndpoints,
    patchBillingIndex,
    patchPlansView,
    patchAutoReloadRow,
    patchCurrentPlanCard,
    patchEnTs,
  },
};
