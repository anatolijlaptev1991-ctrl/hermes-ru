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
