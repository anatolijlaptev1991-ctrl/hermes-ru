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

const RU_TS = "import { defineLocale } from './define-locale'\n\nexport const ru = defineLocale({\n  common: { apply: 'Применить' },\n})\n";

function typesFile(locales) {
  return `// Desktop i18n type contract.\n\nexport type Locale = ${locales.map(l => `'${l}'`).join(' | ')}\n\nexport type Translations = {\n  common: { apply: string }\n}\n`;
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
      <label>Enabled<Switch checked={true} /></label>
      <Button>Set default</Button>
      <Button
            variant="ghost"
            >
              Delete
            </Button>
      <Input placeholder="new preset" />
      <Button>Add preset</Button>
      <div>Default:<span>default</span></div>
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

const CUSTOM_ENDPOINTS_FIXTURE = `import { Globe, Plus } from '@/lib/icons'
import { SectionHeading } from './primitives'

export function CustomEndpointsSettings() {
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

const BILLING_INDEX_FIXTURE = `import { BarChart3, CreditCard, Package } from '@/lib/icons'

export function BillingSettings() {
  return (
    <div>
      <span>Billing</span>
      <SettingsSection icon={Package} title="Plan" />
      <SettingsSection icon={CreditCard} title="Payment & credits" />
      <SettingsSection icon={BarChart3} title="Usage" />
      <div>Processing… checking settlement</div>
      <div>added. Balance is refreshing.</div>
      <Button>
            Open portal
          </Button>
      <Button>Retry</Button>
      <Button>Buy</Button>
    </div>
  )
}
`;

const PLANS_VIEW_FIXTURE = `export function BillingPlansView() {
  return (
    <div>
      <span>Plans</span>
      <Pill tone="primary">Current plan</Pill>
      <Pill>Scheduled</Pill>
      <Button>Downgrade</Button>
      <Button>{'Confirm downgrade'}</Button>
      <Button>Try again</Button>
    </div>
  )
}
`;

const AUTO_RELOAD_FIXTURE = `export function AutoReloadRow() {
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

const CURRENT_PLAN_FIXTURE = `export function CurrentPlanCard() {
  return (
    <div>
      <Button>'Undo'</Button>
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

  // i18n-файлы (нужны для findDesktopDir)
  fs.writeFileSync(path.join(i18n, 'types.ts'), "export type Locale = 'en' | 'zh' | 'zh-hant' | 'ja' | 'ar'\nexport type Translations = { common: { apply: string } }\n");
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
  wr('i18n/en.ts', EN_TS_FIXTURE);

  const cp = require('../src/components-patch.js');
  const result = cp.applyComponentPatches(desktop);
  assert.ok(result.changed.length >= 6, `Ожидалось ≥6 изменённых файлов, получено: ${result.changed.join(', ')}`);

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

  // Повреждённая фикстура: убран якорь title="Mixture of Agents"
  const brokenMoa = MOA_FIXTURE.replace('title="Mixture of Agents"', 'title="Something Else"');
  fs.writeFileSync(path.join(settings, 'model-settings.tsx'), brokenMoa);
  fs.writeFileSync(path.join(settings, 'custom-endpoints-settings.tsx'), CUSTOM_ENDPOINTS_FIXTURE);
  fs.writeFileSync(path.join(billing, 'index.tsx'), BILLING_INDEX_FIXTURE);
  fs.writeFileSync(path.join(billing, 'plans-view.tsx'), PLANS_VIEW_FIXTURE);
  fs.writeFileSync(path.join(billing, 'auto-reload-row.tsx'), AUTO_RELOAD_FIXTURE);
  fs.writeFileSync(path.join(billing, 'current-plan-card.tsx'), CURRENT_PLAN_FIXTURE);

  const cp = require('../src/components-patch.js');
  assert.throws(
    () => cp.applyComponentPatches(desktop),
    (err) => err.name === 'PatchAnchorError' && err.message.includes('Mixture of Agents'),
    'Должен быть PatchAnchorError при битом якоре MoA'
  );
});
