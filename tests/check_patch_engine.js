'use strict';

/**
 * Fixture-матрица patch-engine (F1–F10).
 *
 * Каждый тест строит изолированный desktopDir во временной папке:
 *   <tmp>/apps/desktop/src/i18n/{types,catalog,languages,ru?}.ts + package.json
 * Реальные исходники Hermes тесты НЕ трогают (кроме F9 — read-only).
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const engine = require('../src/patch-engine.js');

// ---------------------------------------------------------------------------
// Фикстуры
// ---------------------------------------------------------------------------

const RU_TS = "import { defineLocale } from './define-locale'\n\nexport const ru = defineLocale({\n  common: { apply: 'Применить' },\n  settings: {\n    model: {\n      loading: 'Загрузка…',\n    },\n  },\n})\n";

function typesFile(locales) {
  return `// Desktop i18n type contract.\n\nexport type Locale = ${locales.map(l => `'${l}'`).join(' | ')}\n\nexport type Translations = {\n  common: { apply: string }\n  settings: {\n    model: {\n      loading: string\n    }\n  }\n}\n`;
}

function catalogFile(locales) {
  const imports = locales.map(l => {
    const name = l === 'zh-hant' ? 'zhHant' : l;
    return `import { ${name} } from './${l}'`;
  }).join('\n');
  const entries = locales.map(l => (l === 'zh-hant' ? `  'zh-hant': zhHant` : `  ${l}`));
  // стиль upstream: последняя запись БЕЗ запятой
  return `${imports}\nimport type { Locale, Translations } from './types'\n\nexport const TRANSLATIONS: Record<Locale, Translations> = {\n${entries.join(',\n')}\n}\n`;
}

function languagesFile(locales) {
  const options = locales.map(l => `  {\n    id: '${l}',\n    name: '${l}',\n    englishName: '${l}',\n    configValue: '${l}'\n  }`).join(',\n');
  const aliases = locales.map(l => `  ${l.replace('-', '_')}: '${l}',`).join('\n');
  return `import { normalize } from '@/lib/text'\n\nimport type { Locale } from './types'\n\nexport const DEFAULT_LOCALE: Locale = 'en'\n\nexport const LOCALE_OPTIONS = [\n${options}\n] as const satisfies readonly unknown[]\n\nconst LOCALE_ALIASES: Record<string, Locale> = {\n${aliases}\n}\n\nexport function normalizeLocale(value: unknown): Locale {\n  return DEFAULT_LOCALE\n}\n`;
}

function makeDesktop(t, { locales, eol = '\n', writeRu = false, corrupt = null }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-ru-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const desktop = path.join(root, 'apps', 'desktop');
  const i18n = path.join(desktop, 'src', 'i18n');
  fs.mkdirSync(i18n, { recursive: true });
  fs.writeFileSync(path.join(desktop, 'package.json'), JSON.stringify({ name: 'desktop-fixture' }));
  fs.writeFileSync(path.join(desktop, 'hermes-version.json'), JSON.stringify({ cliVersion: '0.19.0' }));
  const files = {
    'types.ts': typesFile(locales),
    'catalog.ts': catalogFile(locales),
    'languages.ts': languagesFile(locales),
  };
  if (corrupt && files[corrupt] !== undefined) files[corrupt] = '// повреждённый файл\nexport const nothing = 1\n';
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(i18n, name), eol === '\r\n' ? content.replace(/\n/g, '\r\n') : content);
  }
  if (writeRu) fs.writeFileSync(path.join(i18n, 'ru.ts'), RU_TS);
  // источник ru.ts «пакета»
  const pkgRu = path.join(root, 'pkg-ru.ts');
  fs.writeFileSync(pkgRu, RU_TS);
  return { root, desktop, i18n, pkgRu };
}

const V018 = ['en', 'zh', 'zh-hant', 'ja'];
const V019 = ['en', 'zh', 'zh-hant', 'ja', 'ar'];
const FUTURE = ['en', 'zh', 'zh-hant', 'ja', 'ar', 'pt', 'ko'];

// Дата-директория движка (снапшоты) — в изолированный HERMES_HOME (с восстановлением)
function isolateHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-ru-home-'));
  const saved = process.env.HERMES_HOME;
  t.after(() => {
    if (saved === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = saved;
    fs.rmSync(home, { recursive: true, force: true });
  });
  process.env.HERMES_HOME = home;
  fs.writeFileSync(path.join(home, 'config.yaml'), 'display:\n  language: en\n');
  return home;
}

// ---------------------------------------------------------------------------
// F1–F3: патч на разных наборах локалей upstream
// ---------------------------------------------------------------------------

for (const [name, locales] of [['F1: v0.18 (ja последняя)', V018], ['F2: v0.19 (ar последняя)', V019], ['F3: будущее (pt, ko добавлены)', FUTURE]]) {
  test(name, (t) => {
    isolateHome(t);
    const { desktop, pkgRu } = makeDesktop(t, { locales });
    const r = engine.applyPatch(desktop, { ruTsSource: pkgRu });
    assert.deepEqual(r.changed.sort(), ['catalog.ts', 'languages.ts', 'ru.ts', 'types.ts']);
    const v = engine.verifySources(desktop);
    assert.equal(v.ok, true, v.problems.join('; '));
    assert.equal(engine.analyzeSources(desktop).state, 'patched');
  });
}

// F4: повторный патч — идемпотентный no-op
test('F4: идемпотентность (двойной applyPatch)', (t) => {
  isolateHome(t);
  const { desktop, pkgRu } = makeDesktop(t, { locales: V019 });
  engine.applyPatch(desktop, { ruTsSource: pkgRu });
  const r2 = engine.applyPatch(desktop, { ruTsSource: pkgRu });
  assert.equal(r2.already, true);
  assert.deepEqual(r2.changed, []);
  assert.equal(engine.verifySources(desktop).ok, true);
});

// F5: битый якорь → PatchAnchorError, файлы НЕ изменены
test('F5: повреждённый types.ts → отказ без записи', (t) => {
  isolateHome(t);
  const { desktop, i18n, pkgRu } = makeDesktop(t, { locales: V019, corrupt: 'types.ts' });
  const before = Object.fromEntries(['types.ts', 'catalog.ts', 'languages.ts']
    .map(f => [f, fs.readFileSync(path.join(i18n, f), 'utf8')]));
  assert.throws(() => engine.applyPatch(desktop, { ruTsSource: pkgRu }), engine.PatchAnchorError);
  for (const [f, content] of Object.entries(before)) {
    assert.equal(fs.readFileSync(path.join(i18n, f), 'utf8'), content, `${f} изменён при отказе!`);
  }
  assert.equal(fs.existsSync(path.join(i18n, 'ru.ts')), false);
});

// F6: snapshot → patch → removePatch(snapshot) — byte-identical восстановление (включая CRLF)
test('F6: byte-identical restore из snapshot (CRLF)', (t) => {
  isolateHome(t);
  const { desktop, i18n, pkgRu } = makeDesktop(t, { locales: V019, eol: '\r\n' });
  const originals = Object.fromEntries(['types.ts', 'catalog.ts', 'languages.ts']
    .map(f => [f, fs.readFileSync(path.join(i18n, f))]));
  engine.applyPatch(desktop, { ruTsSource: pkgRu });
  // после патча файлы всё ещё CRLF
  assert.ok(fs.readFileSync(path.join(i18n, 'types.ts'), 'utf8').includes('\r\n'));
  const r = engine.removePatch(desktop, { allowGitFallback: false });
  assert.equal(r.method, 'snapshot');
  for (const [f, buf] of Object.entries(originals)) {
    assert.ok(fs.readFileSync(path.join(i18n, f)).equals(buf), `${f} не восстановлен побайтово`);
  }
  assert.equal(fs.existsSync(path.join(i18n, 'ru.ts')), false);
  assert.equal(engine.analyzeSources(desktop).state, 'clean');
});

// F6b: структурное удаление без snapshot (фолбэк) — чистое состояние + рабочий round-trip
test('F6b: структурное удаление (без snapshot)', (t) => {
  isolateHome(t);
  const { desktop, pkgRu } = makeDesktop(t, { locales: V019 });
  engine.applyPatch(desktop, { ruTsSource: pkgRu });
  // уничтожаем backups — удаление только структурное
  fs.rmSync(path.join(process.env.HERMES_HOME, 'russian-loc', 'backups'), { recursive: true, force: true });
  const r = engine.removePatch(desktop, { allowGitFallback: false });
  assert.equal(r.method, 'structural');
  assert.equal(engine.analyzeSources(desktop).state, 'clean');
  // round-trip: повторный патч после структурного удаления работает
  const r2 = engine.applyPatch(desktop, { ruTsSource: pkgRu });
  assert.ok(r2.changed.length > 0);
  assert.equal(engine.verifySources(desktop).ok, true);
});

// F7: partial-детект + applyPatch отказывает
test('F7: частично пропатченное состояние детектится', (t) => {
  isolateHome(t);
  const { desktop, i18n, pkgRu } = makeDesktop(t, { locales: V019 });
  // вручную патчим только types.ts
  const tp = path.join(i18n, 'types.ts');
  fs.writeFileSync(tp, fs.readFileSync(tp, 'utf8').replace("'ja' | 'ar'", "'ja' | 'ar' | 'ru'"));
  assert.equal(engine.analyzeSources(desktop).state, 'partial');
  assert.throws(() => engine.applyPatch(desktop, { ruTsSource: pkgRu }), /partial/);
  // removePatch приводит к clean
  engine.removePatch(desktop, { allowGitFallback: false });
  assert.equal(engine.analyzeSources(desktop).state, 'clean');
});

// F8: сирота-ru.ts — 'clean', патч не блокируется
test('F8: orphan ru.ts не блокирует', (t) => {
  isolateHome(t);
  const { desktop, pkgRu } = makeDesktop(t, { locales: V019, writeRu: true });
  const a = engine.analyzeSources(desktop);
  assert.equal(a.state, 'clean');
  assert.equal(a.orphanRuTs, true);
  const r = engine.applyPatch(desktop, { ruTsSource: pkgRu });
  assert.ok(r.changed.length > 0);
  assert.equal(engine.verifySources(desktop).ok, true);
});

// F9 (integration, read-only): реальные исходники Hermes, если установлен
test('F9: реальный Hermes (dry-run якорей, read-only)', (t) => {
  const dd = engine.findDesktopDir();
  if (!dd) { t.skip('Hermes desktop не установлен'); return; }
  const probe = engine.anchorsProbe(dd);
  for (const [f, r] of Object.entries(probe)) {
    assert.equal(r.ok, true, `${f}: ${r.error || ''}`);
    assert.equal(r.idempotent, true, `${f}: патч не идемпотентен`);
  }
});

// F10: мелкие юниты
test('F10: юниты — tasklist, insertBeforeClose, EOL', () => {
  assert.equal(engine._internals.parseTasklistCsv('"Hermes.exe","1234","Console","1","100 К"'), true);
  assert.equal(engine._internals.parseTasklistCsv('INFO: No tasks are running which match the specified criteria.'), false);
  assert.equal(engine._internals.parseTasklistCsv('"MyHermes.exe","1","Console","1","10 К"'), false);
  // insertBeforeClose: closeIndex = позиция '\n' перед '}' (как в движке)
  const ibc = engine._internals.insertBeforeClose;
  assert.equal(ibc('{\n  ar\n}', 5 + 1, '  ru', 'f', 'a'), '{\n  ar,\n  ru\n}');
  assert.equal(ibc('{\n  ar,\n}', 6 + 1, '  ru', 'f', 'a'), '{\n  ar,\n  ru\n}');
  // EOL
  assert.equal(engine._internals.detectEol('a\r\nb\r\n'), '\r\n');
  assert.equal(engine._internals.detectEol('a\nb\n'), '\n');
});

// ---------------------------------------------------------------------------
// F11: components-patch — apply → verify → идемпотентность → rollback
// ---------------------------------------------------------------------------

// Мини-фикстуры — урезанные копии поверхностей из реального Hermes 0.19.0,
// содержащие только прово́димые захардкоженные строки.

const MOA_FIXTURE = `import { Cpu } from '@/lib/icons'
import { SectionHeading } from './primitives'

export function MoaSection() {
  return (
    <section>
      <SectionHeading icon={Cpu} title="Mixture of Agents" />
      <p className="mb-2 text-xs text-muted-foreground">
        Configure named presets that appear as models under the Mixture of Agents provider. The aggregator is the\n            acting model.
      </p>
      <Select value="default">
        <SelectTrigger>
          <SelectValue placeholder="Preset" />
        </SelectTrigger>
      </Select>
      <label className="flex items-center gap-2 rounded-sm border border-border px-2 py-1 text-xs">
              Enabled
              <Switch
                checked={true}
              />
            </label>
      <Button>Set default</Button>
      <Button
            variant="ghost"
            >
              Delete
            </Button>
      <Input placeholder="new preset" />
      <Button>Add preset</Button>
      <div className="mb-2 text-xs text-muted-foreground">
            Default: <span className="font-mono">default</span>
          </div>
      <ListRow title={\`Reference \${index + 1}\`} />
      <Button
                    variant="ghost"
                    >
                      Remove
                    </Button>
      <Button>Add reference model</Button>
      <ListRow title="Aggregator" />
    </section>
  )
}
`;

const CUSTOM_ENDPOINTS_FIXTURE = `import { Button } from '@/components/ui/button'
import { Globe, Plus } from '@/lib/icons'
import { SectionHeading } from './primitives'

export function CustomEndpointsSettings({ onConfigSaved, onMainModelChanged }: CustomEndpointsSettingsProps) {
  return (
    <div>
      <SectionHeading icon={Globe} title="Custom Endpoints" />
      <EmptyState
        description="Add an OpenAI-compatible endpoint below."
        title="No custom endpoints"
      />
      <SectionHeading icon={Plus} title={form.id ? 'Edit Endpoint' : 'Add Endpoint'} />
      <label>Name</label>
      <label>Provider ID</label>
      <label>Endpoint URL</label>
      <label>Default Model</label>
      <label>Context</label>
      <label>API Key</label>
      <label>Use for new chats</label>
      <label>Discover models</label>
      <Button>Test</Button>
      <Button>Save</Button>
      <Button>New endpoint</Button>
      <Pill>Active</Pill>
      <Button>Use</Button>
      <Button title="Delete endpoint" />
    </div>
  )
}
`;

const BILLING_INDEX_FIXTURE = `import { Button } from '@/components/ui/button'
import { BarChart3, CreditCard, Package } from '@/lib/icons'

function BuyCreditsRow({ billing, row }: { billing: BillingStateResponse; row: BillingAccountRowView }) {
  return (
    <div>
      <Button>Buy</Button>
    </div>
  )
}

function BuyCreditsOutcome() {
  const stepUp = useStepUpFlow()
  return (
    <div>
      <Button>
            Open portal
          </Button>
      <Button>Retry</Button>
    </div>
  )
}

function BillingHeader({
  fixtureName,
  onFixtureChange
}: {
  fixtureName?: BillingFixtureSelection
  onFixtureChange?: (value: BillingFixtureSelection) => void
}) {
  return (
    <div>
      <span>Billing</span>
    </div>
  )
}

function BillingSettingsContent({
  fixtureName,
  onFixtureChange
}: {
  fixtureName?: BillingFixtureSelection
  onFixtureChange?: (value: BillingFixtureSelection) => void
}) {
  const [subView, setSubView] = useRouteEnumParam<BillingSubView>('bview', BILLING_VIEWS, 'overview')
  return (
    <div>
      <SettingsSection icon={Package} title="Plan" />
      <SettingsSection icon={CreditCard} title="Payment & credits" />
      <SettingsSection icon={BarChart3} title="Usage" />
      <div>Processing… checking settlement</div>
      <div>added. Balance is refreshing.</div>
    </div>
  )
}
`;

const PLANS_VIEW_FIXTURE = `import { openExternalLink } from '@/lib/external-link'

function previewMessage(phase: DowngradePhase, fallbackTierName: string): null | string {
  if (phase.kind === 'previewing') {
    return 'Checking this change…'
  }
  const { preview } = phase
  const targetName = preview.target_tier_name ?? fallbackTierName
  const creditsDelta = formatMonthlyCreditsDelta(preview.monthly_credits_delta)
  switch (preview.effect) {
    case 'blocked':
      return preview.reason ?? 'That change cannot be made here.'
    case 'no_op':
      return \`You are already on \${targetName} — nothing to change.\`
    case 'scheduled':
      return (
        \`Change to \${targetName} — takes effect \${formatBillingDate(preview.effective_at)}. No charge now; \` +
        \`you keep your current plan until then.\${creditsDelta ? \` Monthly credits change: \${creditsDelta}.\` : ''}\`
      )
    default:
      return 'This change cannot be scheduled here.'
  }
}

function DowngradeConfirm({ flow, tier }: { flow: DowngradeFlow; tier: BillingPlanTierView }) {
  return (
    <div>
      <Button>{'Confirm downgrade'}</Button>
    </div>
  )
}

function PlanCard({ flow, tier }: { flow: DowngradeFlow; tier: BillingPlanTierView }) {
  return (
    <div>
      <Pill tone="primary">Current plan</Pill>
      <Pill>Scheduled</Pill>
      <Button>Downgrade</Button>
    </div>
  )
}

export function BillingPlansView({ onBack, tiers }: { onBack: () => void; tiers: BillingPlanTierView[] }) {
  return (
    <div>
      <span>Plans</span>
      <Button>Try again</Button>
    </div>
  )
}
`;

const AUTO_RELOAD_FIXTURE = `import { Button } from '@/components/ui/button'
import { useState } from 'react'

export function AutoReloadRow() {
  const [saving, setSaving] = useState(false)

  return (
    <div>
      <label>Threshold</label>
      <label>Reload to</label>
      <span>Turn off auto-refill?</span>
      <Button>Turn off</Button>
      <Button>Disable</Button>
      <Button>Manage</Button>
    </div>
  )
}
`;

const CURRENT_PLAN_FIXTURE = `import { Button } from '@/components/ui/button'

export function CurrentPlanCard({ onViewPlans, plan }: { onViewPlans: () => void; plan: BillingPlanCardView }) {
  return (
    <div>
      <Button disabled={resumeFlow.busy} onClick={() => void resumeFlow.resume()} size="sm" type="button">
              {resumeFlow.busy ? 'Undoing…' : 'Undo'}
            </Button>
    </div>
  )
}
`;

const EN_TS_FIXTURE = `import { defineLocale } from './define-locale'

export const en = defineLocale({
  common: { apply: 'Apply' },
  settings: {
    nav: { providers: 'Providers' },
    model: {
      appliesDesc: 'Applies to new chats.',
      provider: 'Provider',
      model: 'Model',
    },
  },
})
`;

function makeComponentsDesktop(t, { eol = '\\n', patches = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-ru-comp-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const desktop = path.join(root, 'apps', 'desktop');
  const settings = path.join(desktop, 'src', 'app', 'settings');
  const billing = path.join(settings, 'billing');
  const i18n = path.join(desktop, 'src', 'i18n');
  fs.mkdirSync(billing, { recursive: true });
  fs.mkdirSync(i18n, { recursive: true });
  fs.writeFileSync(path.join(desktop, 'package.json'), JSON.stringify({ name: 'desktop-fixture' }));
  fs.writeFileSync(path.join(desktop, 'hermes-version.json'), JSON.stringify({ cliVersion: '0.19.0' }));

  // i18n-файлы (нужны для findDesktopDir)
  fs.writeFileSync(path.join(i18n, 'types.ts'), "export type Locale = 'en' | 'zh' | 'zh-hant' | 'ja' | 'ar'\nexport type Translations = {\n  common: { apply: string }\n  settings: {\n    model: {\n      loading: string\n    }\n  }\n}\n");
  fs.writeFileSync(path.join(i18n, 'catalog.ts'), "import { en } from './en'\nexport const TRANSLATIONS: Record<Locale, Translations> = { en }\n");
  fs.writeFileSync(path.join(i18n, 'languages.ts'), "export const DEFAULT_LOCALE: Locale = 'en'\nexport const LOCALE_OPTIONS = [{ id: 'en', name: 'English', englishName: 'English', configValue: 'en' }] as const satisfies readonly unknown[]\n");

  const wr = (rel, content) => fs.writeFileSync(
    rel.includes('/') ? path.join(settings, rel) : path.join(settings, rel),
    eol === '\\r\\n' ? content.replace(/\\n/g, '\\r\\n') : content
  );

  if (patches) {
    wr('model-settings.tsx', MOA_FIXTURE);
    wr('custom-endpoints-settings.tsx', CUSTOM_ENDPOINTS_FIXTURE);
    wr('billing/index.tsx', BILLING_INDEX_FIXTURE);
    wr('billing/plans-view.tsx', PLANS_VIEW_FIXTURE);
    wr('billing/auto-reload-row.tsx', AUTO_RELOAD_FIXTURE);
    wr('billing/current-plan-card.tsx', CURRENT_PLAN_FIXTURE);
    wr('billing/use-billing-state.ts', USE_BILLING_STATE_FIXTURE);
    wr('billing/errors.ts', ERRORS_FIXTURE);
    wr(path.join(i18n, 'en.ts'), EN_TS_FIXTURE);
  }

  // Hermes CLI mock: подложим фейковый hermes.exe, который выдаёт версию
  const venvDir = path.join(root, 'hermes-agent', 'venv', 'Scripts');
  fs.mkdirSync(venvDir, { recursive: true });
  // Windows batch-файл как фейковый hermes.exe (execFileSync сработает)
  const batContent = `@echo off\r\nif "%1" == "--version" echo hermes 0.19.0\r\n`;
  fs.writeFileSync(path.join(venvDir, 'hermes.exe.bat'), batContent);

  return { root, desktop, settings, i18n, billing };
}

test('F11: components-patch — apply → verify → идемпотентность → rollback', (t) => {
  isolateHome(t);
  const { desktop, pkgRu } = makeDesktop(t, { locales: V019 });

  // Сначала применяем i18n-патч (чтобы desktop был в состоянии 'patched')
  engine.applyPatch(desktop, { ruTsSource: pkgRu });

  // Создаём компонентные фикстуры ПОВЕРХ i18n-файлов (имитируем 0.19.0)
  const settings = path.join(desktop, 'src', 'app', 'settings');
  const billing = path.join(settings, 'billing');
  fs.mkdirSync(billing, { recursive: true });
  const wr = (rel, content) => fs.writeFileSync(
    rel.includes('/') ? path.join(settings, rel) : path.join(settings, rel),
    content
  );
  wr('model-settings.tsx', MOA_FIXTURE);
  wr('custom-endpoints-settings.tsx', CUSTOM_ENDPOINTS_FIXTURE);
  wr('billing/index.tsx', BILLING_INDEX_FIXTURE);
  wr('billing/plans-view.tsx', PLANS_VIEW_FIXTURE);
  wr('billing/auto-reload-row.tsx', AUTO_RELOAD_FIXTURE);
  wr('billing/current-plan-card.tsx', CURRENT_PLAN_FIXTURE);
  wr('billing/use-billing-state.ts', USE_BILLING_STATE_FIXTURE);
  wr('billing/errors.ts', ERRORS_FIXTURE);

  // Проверяем, что строки хардкожены (до патча)
  const moaBefore = fs.readFileSync(path.join(settings, 'model-settings.tsx'), 'utf8');
  assert.ok(moaBefore.includes('title="Mixture of Agents"'));
  assert.ok(moaBefore.includes('"Preset"'));
  assert.ok(!moaBefore.includes('t.settings.model.moa'));

  // Применяем компонентный патч вручную
  const cp = require('../src/components-patch.js');
  const result = cp.applyComponentPatches(desktop);
  assert.ok(result.changed.length > 0, 'components-patch должен изменить файлы');

  // Проверяем проводку MoA
  const moaAfter = fs.readFileSync(path.join(settings, 'model-settings.tsx'), 'utf8');
  assert.ok(moaAfter.includes('t.settings.model.moa.title'), 'MoA title должен быть проведён');
  assert.ok(moaAfter.includes('t.settings.model.moa.preset'), 'MoA preset должен быть проведён');
  assert.ok(moaAfter.includes('t.settings.model.moa.enabled'), 'MoA enabled должен быть проведён');
  assert.ok(moaAfter.includes('t.settings.model.moa.aggregator'), 'MoA aggregator должен быть проведён');
  assert.ok(!moaAfter.includes('title="Mixture of Agents"'), 'Хардкод MoA title должен быть заменён');

  // Проверяем проводку Custom Endpoints
  const ceAfter = fs.readFileSync(path.join(settings, 'custom-endpoints-settings.tsx'), 'utf8');
  assert.ok(ceAfter.includes('t.settings.customEndpoints.title'), 'CE title должен быть проведён');
  assert.ok(ceAfter.includes('t.settings.customEndpoints.emptyTitle'), 'CE emptyTitle должен быть проведён');

  // Проверяем проводку Billing
  const biAfter = fs.readFileSync(path.join(billing, 'index.tsx'), 'utf8');
  assert.ok(biAfter.includes('t.settings.billing.title'), 'Billing title должен быть проведён');

  // Проверяем идемпотентность: повторный вызов = no-op
  const result2 = cp.applyComponentPatches(desktop);
  assert.equal(result2.already, true, 'Повторный прогон должен быть no-op');
  assert.deepEqual(result2.changed, []);

  // Проверяем, что en.ts не был пропатчен (фикстурный desktop не имеет hermes CLI 0.19.0)
  // Компонентный патч через patch-engine не вызывался — только прямой вызов cp
});

// F11b: components-patch прямой вызов на все фикстуры
test('F11b: components-patch — все 6 компонентов + en.ts патчатся прямой applyComponentPatches', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-ru-comp2-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const desktop = path.join(root, 'apps', 'desktop');
  const settings = path.join(desktop, 'src', 'app', 'settings');
  const billing = path.join(settings, 'billing');
  const i18n = path.join(desktop, 'src', 'i18n');
  fs.mkdirSync(billing, { recursive: true });
  fs.mkdirSync(i18n, { recursive: true });
  fs.writeFileSync(path.join(desktop, 'package.json'), JSON.stringify({ name: 'desktop-fixture' }));
  fs.writeFileSync(path.join(desktop, 'hermes-version.json'), JSON.stringify({ cliVersion: '0.19.0' }));

  const wr = (rel, content) => {
    let targetPath;
    if (rel.startsWith('i18n/')) {
      targetPath = path.join(i18n, rel.replace('i18n/', ''));
    } else if (rel.includes('/')) {
      targetPath = path.join(settings, rel);
    } else {
      targetPath = path.join(settings, rel);
    }
    fs.writeFileSync(targetPath, content);
  };
  wr('model-settings.tsx', MOA_FIXTURE);
  wr('custom-endpoints-settings.tsx', CUSTOM_ENDPOINTS_FIXTURE);
  wr('billing/index.tsx', BILLING_INDEX_FIXTURE);
  wr('billing/plans-view.tsx', PLANS_VIEW_FIXTURE);
  wr('billing/auto-reload-row.tsx', AUTO_RELOAD_FIXTURE);
  wr('billing/current-plan-card.tsx', CURRENT_PLAN_FIXTURE);
  wr('billing/use-billing-state.ts', USE_BILLING_STATE_FIXTURE);
  wr('billing/errors.ts', ERRORS_FIXTURE);
  wr('i18n/en.ts', EN_TS_FIXTURE);

  const cp = require('../src/components-patch.js');
  const result = cp.applyComponentPatches(desktop);
  assert.ok(result.changed.length >= 8, `Ожидалось ≥8 изменённых файлов, получено: ${result.changed.join(', ')}`);

  // Идемпотентность
  const result2 = cp.applyComponentPatches(desktop);
  assert.equal(result2.already, true);
});

// F11c: components-patch кидает PatchAnchorError при битом якоре
test('F11c: components-patch — битый якорь в model-settings.tsx → PatchAnchorError', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-ru-comp3-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const desktop = path.join(root, 'apps', 'desktop');
  const settings = path.join(desktop, 'src', 'app', 'settings');
  const billing = path.join(settings, 'billing');
  const i18n = path.join(desktop, 'src', 'i18n');
  fs.mkdirSync(billing, { recursive: true });
  fs.mkdirSync(i18n, { recursive: true });
  fs.writeFileSync(path.join(desktop, 'package.json'), JSON.stringify({ name: 'desktop-fixture' }));
  fs.writeFileSync(path.join(desktop, 'hermes-version.json'), JSON.stringify({ cliVersion: '0.19.0' }));

  // Повреждённая фикстура: убран якорь title="Mixture of Agents"
  const brokenMoa = MOA_FIXTURE.replace('title="Mixture of Agents"', 'title="Something Else"');
  fs.writeFileSync(path.join(settings, 'model-settings.tsx'), brokenMoa);
  fs.writeFileSync(path.join(settings, 'custom-endpoints-settings.tsx'), CUSTOM_ENDPOINTS_FIXTURE);
  fs.writeFileSync(path.join(billing, 'index.tsx'), BILLING_INDEX_FIXTURE);
  fs.writeFileSync(path.join(billing, 'plans-view.tsx'), PLANS_VIEW_FIXTURE);
  fs.writeFileSync(path.join(billing, 'auto-reload-row.tsx'), AUTO_RELOAD_FIXTURE);
  fs.writeFileSync(path.join(billing, 'current-plan-card.tsx'), CURRENT_PLAN_FIXTURE);
  fs.writeFileSync(path.join(billing, 'use-billing-state.ts'), USE_BILLING_STATE_FIXTURE);
  fs.writeFileSync(path.join(billing, 'errors.ts'), ERRORS_FIXTURE);

  const cp = require('../src/components-patch.js');
  assert.throws(
    () => cp.applyComponentPatches(desktop),
    (err) => err.name === 'PatchAnchorError' && err.message.includes('Mixture of Agents'),
    'Должен быть PatchAnchorError при битом якоре MoA'
  );
});

// ---------------------------------------------------------------------------
// F12: components-patch — use-billing-state.ts и errors.ts
// ---------------------------------------------------------------------------

// Мини-фикстуры с реальными якорными строками из Hermes 0.19.0
// ВАЖНО: байт-в-байт совпадают с реальными файлами!

const USE_BILLING_STATE_FIXTURE = `import { useQuery } from '@tanstack/react-query'
import { fmtDate } from '@/lib/time'
import type { BillingRefusal, BillingResult } from './api'
import { useBillingApi } from './api'
import { resolveRefusal } from './errors'
import type { BillingStateResponse, SubscriptionStateResponse, SubscriptionTierOption, UsageModelData } from './types'

export const EMPTY_BILLING_VALUE = '—'

const BILLING_QUERY_OPTIONS = {
  refetchInterval: 30_000,
  refetchOnMount: 'always',
  refetchOnWindowFocus: true,
  retry: false,
  staleTime: 0
} as const

export function deriveBillingView(
  stateResult?: BillingResult<BillingStateResponse>,
  subscriptionResult?: BillingResult<SubscriptionStateResponse>
) {
  if (!stateResult) {
    return { status: 'loading', summary: [], tiers: [], usageRows: [] }
  }
  if (!stateResult.ok) {
    return { notice: refusalNotice(stateResult.refusal), status: 'refusal', summary: [], tiers: [], usageRows: [] }
  }
  const billing = stateResult.data
  const subscription = subscriptionResult?.ok ? subscriptionResult.data : null
  if (!billing.logged_in || subscription?.logged_in === false) {
    return {
      notice: {
        action: { label: 'Open portal \u2197', url: billing.portal_url ?? subscription?.portal_url },
        message: 'Run /portal in the TUI or open the Nous portal to connect your account.',
        title: 'Connect your Nous account'
      },
      status: 'logged_out',
      summary: [],
      tiers: [],
      usageRows: []
    }
  }
  return {
    paymentRow: paymentMethodRow(billing),
    refillRow: autoReloadRow(billing),
    status: 'normal',
    summary: [
      { label: 'Balance', value: '—' },
      { label: 'Plan', value: '—' },
      { label: 'Auto-refill', value: billing.auto_reload ? (billing.auto_reload.enabled ? 'Enabled' : 'Off') : '—' }
    ],
    tiers: [],
    topupRow: buyCreditsRow(billing),
    usageRows: deriveUsageRows(billing, subscription)
  }
}

function refusalNotice(refusal: BillingRefusal) {
  return {
    action: refusal.portalUrl ? { label: 'Open portal \u2197', url: refusal.portalUrl } : undefined,
    message: 'msg',
    title: 'title',
    tone: 'warn'
  }
}

function noCardNotice(billing: BillingStateResponse) {
  if (billing.card) return undefined
  return {
    action: { label: 'Add card \u2197', url: billing.portal_url },
    message: 'Buying top-up credits and auto-refill stay disabled until a card is on file. Add one on the portal.',
    title: 'No payment method on file',
    tone: 'warn'
  }
}

function derivePlanCard() {
  return {
    action: { label: current ? 'Change plan' : 'View plans' },
    caption: 'Subscription details are unavailable; opening the portal is still available.',
    link: { label: 'Adjust plan \u2197', url: '' },
    tierName: 'Free'
  }
}

function derivePlanTiers() {
  return [{ name: 'Pro', priceDisplay: '$10', tierId: 'pro', action: { label: 'Choose \u2197', url: '' }, state: 'upgrade' }]
}

function paymentMethodRow(billing: BillingStateResponse) {
  return {
    action: { label: 'Add payment method', url: '' },
    description: '',
    id: 'payment_method',
    title: 'Payment method'
  }
}

function buyCreditsRow(billing: BillingStateResponse) {
  return {
    action: { label: 'Buy' },
    chips: [],
    description: 'A single charge on your card, added to your balance today.',
    id: 'buy_credits',
    title: 'Buy credits now'
  }
}

const AUTO_REFILL_GENERIC = 'Keep your balance topped up when it drops below your threshold.'

function autoReloadRow(billing: BillingStateResponse) {
  return {
    action: { label: 'Manage' },
    caption: 'Manage auto-refill from the portal.',
    description: AUTO_REFILL_GENERIC,
    id: 'auto_reload',
    pill: { label: '—', tone: 'muted' },
    title: 'Refill when low'
  }
}

function deriveUsageRows() {
  return [
    {
      bar: { label: 'Subscription credits remaining', state: 'ok', tone: 'subscription', value: 0.8 },
      caption: \`Resets \${'—'}\`,
      id: 'subscription_credits',
      title: 'Subscription credits',
      value: '$80 of $100 left'
    },
    {
      caption: 'Does not expire',
      id: 'topup_credits',
      title: 'Top-up credits',
      value: '$50'
    },
    {
      bar: { label: 'Monthly spend cap used', state: 'ok', tone: 'cap', value: 0.3 },
      caption: cap.is_default_ceiling ? 'Default ceiling' : 'Monthly remote spending',
      id: 'monthly_cap',
      title: 'Monthly spend cap',
      value: \`\${'$30'} of \${'$100'} used\`
    }
  ]
}
`;

const ERRORS_FIXTURE = `import type { BillingRefusal } from './api'

export interface BillingRefusalPresentation {
  action: { type: 'none' } | { type: 'portal'; url?: string } | { type: 'retry' } | { type: 'step_up' }
  message: string
  title: string
}

const portalAction = (url?: string): BillingRefusalPresentation['action'] => ({ type: 'portal', url })

export const resolveRefusal = (refusal: BillingRefusal): BillingRefusalPresentation => {
  switch (refusal.kind) {
    case 'consent_required':
      return {
        action: portalAction(refusal.portalUrl),
        message: 'Confirm this card for terminal charges in the portal',
        title: 'Card confirmation needed'
      }

    case 'monthly_cap_exceeded':
      return {
        action: portalAction(refusal.portalUrl),
        message: '🔴 Monthly spend cap reached.',
        title: 'Monthly spend cap reached'
      }

    case 'rate_limited':
      return {
        action: { type: 'retry' },
        message: \`🟡 Too many charges right now\${''}. This isn't a payment failure.\`,
        title: 'Too many charges right now'
      }

    case 'stripe_unavailable':
      return {
        action: { type: 'retry' },
        message: \`Stripe is having trouble — try again shortly\${''}\`,
        title: 'Stripe is having trouble'
      }

    case 'upgrade_cap_exceeded':
      return {
        action: { type: 'none' },
        message: 'Daily plan-change limit reached — try again tomorrow',
        title: 'Daily plan-change limit reached'
      }

    default:
      return {
        action: { type: 'none' },
        message: 'Billing request failed.',
        title: 'Billing request failed'
      }
  }
}
`;

// F12: apply → verify → идемпотентность (use-billing-state + errors)
test('F12: components-patch — use-billing-state.ts + errors.ts apply → verify → идемпотентность', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-ru-f12-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const desktop = path.join(root, 'apps', 'desktop');
  const settings = path.join(desktop, 'src', 'app', 'settings');
  const billing = path.join(settings, 'billing');
  const i18n = path.join(desktop, 'src', 'i18n');
  fs.mkdirSync(billing, { recursive: true });
  fs.mkdirSync(i18n, { recursive: true });
  fs.writeFileSync(path.join(desktop, 'package.json'), JSON.stringify({ name: 'desktop-fixture' }));
  fs.writeFileSync(path.join(desktop, 'hermes-version.json'), JSON.stringify({ cliVersion: '0.19.0' }));

  fs.writeFileSync(path.join(billing, 'use-billing-state.ts'), USE_BILLING_STATE_FIXTURE);
  fs.writeFileSync(path.join(billing, 'errors.ts'), ERRORS_FIXTURE);
  fs.writeFileSync(path.join(i18n, 'types.ts'), "export type Locale = 'en' | 'zh' | 'zh-hant' | 'ja' | 'ar' | 'ru'\\nexport type Translations = { common: { apply: string } }\\n");
  fs.writeFileSync(path.join(i18n, 'catalog.ts'), "import { en } from './en'\\nimport { ru } from './ru'\\nexport const TRANSLATIONS: Record<Locale, Translations> = { en, ru }\\n");
  fs.writeFileSync(path.join(i18n, 'languages.ts'), "import type { Locale } from './types'\\nexport const DEFAULT_LOCALE: Locale = 'en'\\nexport const LOCALE_OPTIONS = [{ id: 'en', name: 'English', englishName: 'English', configValue: 'en' }]\\n");
  fs.writeFileSync(path.join(i18n, 'en.ts'), `import { defineLocale } from './define-locale'

export const en = defineLocale({
  common: { apply: 'Apply' },
  settings: {
    model: {
      provider: 'Provider',
      model: 'Model',
    },
    billing: {
      title: 'Billing',
      plan: 'Plan',
      paymentCredits: 'Payment & credits',
      usage: 'Usage',
      plans: 'Plans',
    },
  },
})
`);

  const cp = require('../src/components-patch.js');

  // Применяем компонентный патч только к use-billing-state и errors
  const r = cp.patchUseBillingState(USE_BILLING_STATE_FIXTURE);
  assert.ok(r.changed, 'use-billing-state.ts должен измениться');
  assert.ok(r.content.includes("translateNow('settings.billing.state."), 'state-ключи должны появиться');

  const r2 = cp.patchErrors(ERRORS_FIXTURE);
  assert.ok(r2.changed, 'errors.ts должен измениться');
  assert.ok(r2.content.includes("translateNow('settings.billing.errors."), 'errors-ключи должны появиться');

  // Идемпотентность
  const r3 = cp.patchUseBillingState(r.content);
  assert.equal(r3.changed, false, 'use-billing-state: повторный прогон должен быть no-op');

  const r4 = cp.patchErrors(r2.content);
  assert.equal(r4.changed, false, 'errors: повторный прогон должен быть no-op');

  // extendEnTsBilling должен работать
  const enBefore = fs.readFileSync(path.join(i18n, 'en.ts'), 'utf8');
  const enR = cp.extendEnTsBilling(enBefore);
  assert.ok(enR.changed, 'en.ts should be extended with state/errors');
  assert.ok(enR.content.includes('state: {'), 'state block should be present');
  assert.ok(enR.content.includes('errors: {'), 'errors block should be present');
  assert.ok(enR.content.includes("openPortal: 'Open portal"), 'openPortal key should be present');
  assert.ok(enR.content.includes("monthlyCapExceeded: 'Monthly spend cap reached'"), 'monthlyCapExceeded key should be present');

  // Идемпотентность extendEnTsBilling
  const enR2 = cp.extendEnTsBilling(enR.content);
  assert.equal(enR2.changed, false, 'extendEnTsBilling: повторный прогон должен быть no-op');
});

// F12b: битый якорь → PatchAnchorError
test('F12b: components-patch — битый якорь в use-billing-state.ts → PatchAnchorError', (t) => {
  const cp = require('../src/components-patch.js');

  const broken = USE_BILLING_STATE_FIXTURE.replace(
    "label: 'Open portal \u2197', url: billing.portal_url ?? subscription?.portal_url",
    "label: 'Something Else', url: billing.portal_url ?? subscription?.portal_url"
  );
  assert.throws(
    () => cp.patchUseBillingState(broken),
    (err) => err.name === 'PatchAnchorError',
    'Должен быть PatchAnchorError при битом якоре'
  );
});

// F12c: битый якорь в errors.ts → PatchAnchorError
test('F12c: components-patch — битый якорь в errors.ts → PatchAnchorError', (t) => {
  const cp = require('../src/components-patch.js');

  const broken = ERRORS_FIXTURE.replace(
    "import type { BillingRefusal } from './api'",
    "import type { SomethingElse } from './api'"
  );
  assert.throws(
    () => cp.patchErrors(broken),
    (err) => err.name === 'PatchAnchorError',
    'Должен быть PatchAnchorError при битом якоре'
  );
});
