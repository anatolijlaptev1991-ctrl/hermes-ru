'use strict';

/**
 * hermes-ru patch-engine — единый источник истины для наката/снятия русской локали.
 *
 * Принципы (архитектура «штатный цикл», v1.0):
 *  - Структурные якоря вместо зашитых списков локалей: патч работает на любой
 *    комбинации локалей upstream (en/zh/ja/ar/...), а не только на заученной.
 *  - Ноль тихих no-op: якорь не найден → PatchAnchorError → НИЧЕГО не пишется.
 *  - Транзакция: сначала все патчи в памяти + верификация, потом snapshot,
 *    потом запись, потом верификация на диске; любой сбой → restore snapshot.
 *  - Патч = обычные uncommitted-правки git-дерева Hermes: штатный updater
 *    (updates.non_interactive_local_changes=stash) сам переносит их при
 *    обновлениях; штатный content-hash build stamp сам триггерит пересборку.
 *  - EOL-preserving: каждый файл пишется в своём исходном EOL (CRLF/LF).
 *
 * Только node core. Без побочных эффектов при require.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const I18N_FILES = ['types.ts', 'catalog.ts', 'languages.ts'];
const RU_SENTINELS = ['Русский', 'Применить'];
const MAX_BACKUPS = 5;

class PatchAnchorError extends Error {
  constructor(file, anchor) {
    super(`Якорь не найден в ${file}: ${anchor}`);
    this.name = 'PatchAnchorError';
    this.file = file;
    this.anchor = anchor;
  }
}

// ---------------------------------------------------------------------------
// Пути
// ---------------------------------------------------------------------------

function getHermesHome() {
  if (process.env.HERMES_HOME) return path.resolve(process.env.HERMES_HOME);
  const localHermes = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'hermes') : null;
  const legacyHermes = path.join(os.homedir(), '.hermes');
  for (const candidate of [localHermes, legacyHermes]) {
    if (!candidate) continue;
    if (fs.existsSync(path.join(candidate, 'config.yaml')) ||
        fs.existsSync(path.join(candidate, 'hermes-agent'))) return candidate;
  }
  return localHermes || legacyHermes;
}

function getDataDir() {
  const dir = path.join(getHermesHome(), 'russian-loc');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function findDesktopDir(override) {
  const candidates = [
    override,
    process.env.HERMES_RU_DESKTOP_DIR,
    path.join(getHermesHome(), 'hermes-agent', 'apps', 'desktop'),
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'src', 'i18n', 'types.ts')) &&
        fs.existsSync(path.join(dir, 'package.json'))) {
      return path.resolve(dir);
    }
  }
  return null;
}

function findHermesCli() {
  const venvExe = path.join(getHermesHome(), 'hermes-agent', 'venv', 'Scripts', 'hermes.exe');
  if (fs.existsSync(venvExe)) return venvExe;
  try {
    const out = execFileSync('where.exe', ['hermes'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 });
    const first = String(out).split(/\r?\n/).map(s => s.trim()).find(Boolean);
    if (first && fs.existsSync(first)) return first;
  } catch { /* нет на PATH */ }
  return null;
}

function parseTasklistCsv(output) {
  return /(?:^|\n)"?Hermes\.exe"?,/i.test(String(output || '').replaceAll('\r', ''));
}

function isHermesRunning() {
  if (process.platform !== 'win32') return false;
  try {
    const output = execFileSync('tasklist.exe', ['/FI', 'IMAGENAME eq Hermes.exe', '/FO', 'CSV', '/NH'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 });
    return parseTasklistCsv(output);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// EOL + байты
// ---------------------------------------------------------------------------

function detectEol(content) {
  const crlf = (content.match(/\r\n/g) || []).length;
  const lf = (content.match(/(?<!\r)\n/g) || []).length;
  return crlf > lf ? '\r\n' : '\n';
}

function toUnix(s) { return s.replace(/\r\n/g, '\n'); }
function fromUnix(s, eol) { return eol === '\r\n' ? s.replace(/\n/g, '\r\n') : s; }

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

// ---------------------------------------------------------------------------
// Структурные патчи (в памяти, на \n-нормализованном тексте)
// Каждый: { content, changed } или бросает PatchAnchorError. Идемпотентны.
// ---------------------------------------------------------------------------

/** Вставить `insert` перед закрывающей скобкой объекта/массива, корректно
 *  расставив запятую: `…ar\n}` → `…ar,\n  ru\n}`; `…ar,\n}` → `…ar,\n  ru\n}`.
 *  closeIndex — позиция '\n' непосредственно перед '}' (как даёт indexOf('\n}')). */
function insertBeforeClose(content, closeIndex, insertLines, file, anchorName) {
  const before = content.slice(0, closeIndex);
  const after = content.slice(closeIndex); // начинается с '\n}'
  const trimmedEnd = before.replace(/\s+$/, '');
  if (!trimmedEnd) throw new PatchAnchorError(file, anchorName + ' (пустой блок)');
  const lastChar = trimmedEnd[trimmedEnd.length - 1];
  const comma = (lastChar !== '{' && lastChar !== '[' && lastChar !== ',') ? ',' : '';
  return trimmedEnd + comma + '\n' + insertLines + after;
}

function patchTypesContent(content) {
  // Идемпотентность: 'ru' уже есть в union (в любом стиле: |'ru' / | 'ru' / 'ru'|)
  if (/export type Locale\s*=[^;\n]*'ru'/.test(content)) {
    return { content, changed: false };
  }
  const m = content.match(/^(export type Locale\s*=\s*)([^\n;]+?)([ \t]*)$/m);
  if (!m) throw new PatchAnchorError('types.ts', 'export type Locale = …');
  if (!/'[a-z-]+'/.test(m[2])) throw new PatchAnchorError('types.ts', 'члены Locale-union');
  return { content: content.replace(m[0], `${m[1]}${m[2]} | 'ru'${m[3]}`), changed: true };
}

function patchCatalogContent(content) {
  let changed = false;
  let out = content;

  // 1. import { ru } from './ru' — в алфавитной позиции среди locale-imports
  //    (perfectionist/sort-imports: './ru' после './ja', до './zh'/'./zh-hant';
  //    если большего пути нет — после последнего).
  if (!/from\s*'\.\/ru'/.test(out)) {
    const importRe = /^import\s+(?:type\s+)?\{\s*[\w,\s]*\w\s*\}\s*from\s*'(\.\/[\w-]+)'\s*;?\s*$/gm;
    const imports = [];
    let m;
    while ((m = importRe.exec(out)) !== null) imports.push({ index: m.index, text: m[0], p: m[1] });
    if (!imports.length) throw new PatchAnchorError('catalog.ts', "import { … } from './<locale>'");
    const greater = imports.find(im => im.p > './ru');
    if (greater) {
      out = out.slice(0, greater.index) + "import { ru } from './ru'\n" + out.slice(greater.index);
    } else {
      const last = imports[imports.length - 1];
      const insertAt = last.index + last.text.length;
      out = out.slice(0, insertAt) + "\nimport { ru } from './ru'" + out.slice(insertAt);
    }
    changed = true;
  }

  // 2. ru в TRANSLATIONS
  const tStart = out.search(/export const TRANSLATIONS[^[{]*\{/);
  if (tStart < 0) throw new PatchAnchorError('catalog.ts', 'export const TRANSLATIONS … {');
  const blockEnd = out.indexOf('\n}', tStart);
  if (blockEnd < 0) throw new PatchAnchorError('catalog.ts', 'закрывающая } TRANSLATIONS');
  const block = out.slice(tStart, blockEnd);
  if (!/(?:^|[,{\s])ru(?:\s*,|\s*$)/m.test(block)) {
    out = insertBeforeClose(out, blockEnd, '  ru', 'catalog.ts', 'тело TRANSLATIONS');
    changed = true;
  }
  return { content: out, changed };
}

function patchLanguagesContent(content) {
  let changed = false;
  let out = content;

  // 1. Опция Русский в LOCALE_OPTIONS — перед `] as const`
  if (!/id:\s*'ru'/.test(out)) {
    const asConst = out.search(/\]\s*as const/);
    if (asConst < 0) throw new PatchAnchorError('languages.ts', '] as const (LOCALE_OPTIONS)');
    if ((out.match(/\]\s*as const/g) || []).length !== 1) {
      throw new PatchAnchorError('languages.ts', '] as const не уникален');
    }
    const option = "  {\n    id: 'ru',\n    name: 'Русский',\n    englishName: 'Russian',\n    configValue: 'ru'\n  }";
    // закрывающая `]` массива находится на позиции asConst; вставляем перед ней
    out = insertBeforeClose(out, asConst, option, 'languages.ts', 'LOCALE_OPTIONS');
    changed = true;
  }

  // 2. Алиасы в LOCALE_ALIASES
  if (!/^\s*ru:\s*'ru'/m.test(out)) {
    const aStart = out.search(/LOCALE_ALIASES[^[{]*\{/);
    if (aStart < 0) throw new PatchAnchorError('languages.ts', 'LOCALE_ALIASES … {');
    const aEnd = out.indexOf('\n}', aStart);
    if (aEnd < 0) throw new PatchAnchorError('languages.ts', 'закрывающая } LOCALE_ALIASES');
    const aliases = "  ru: 'ru',\n  'ru-ru': 'ru',\n  ru_ru: 'ru',\n  'русский': 'ru'";
    out = insertBeforeClose(out, aEnd, aliases, 'languages.ts', 'тело LOCALE_ALIASES');
    changed = true;
  }
  return { content: out, changed };
}

const PATCHERS = {
  'types.ts': patchTypesContent,
  'catalog.ts': patchCatalogContent,
  'languages.ts': patchLanguagesContent,
};

// ---------------------------------------------------------------------------
// Структурное удаление (fallback removePatch, когда нет snapshot)
// ---------------------------------------------------------------------------

function unpatchTypesContent(content) {
  const m = content.match(/^(export type Locale\s*=\s*)([^\n;]+?)([ \t]*)$/m);
  if (!m) return { content, changed: false };
  if (!/\|\s*'ru'|'ru'\s*\|/.test(m[2])) return { content, changed: false };
  const members = m[2].split('|').map(s => s.trim()).filter(s => s !== "'ru'");
  return { content: content.replace(m[0], `${m[1]}${members.join(' | ')}${m[3]}`), changed: true };
}

function unpatchCatalogContent(content) {
  let out = content;
  let changed = false;
  const before = out;
  out = out.replace(/\r?\n?import\s*\{\s*ru\s*\}\s*from\s*'\.\/ru'\s*;?/, '');
  if (out !== before) changed = true;
  const tStart = out.search(/export const TRANSLATIONS[^[{]*\{/);
  if (tStart >= 0) {
    const blockEnd = out.indexOf('\n}', tStart);
    if (blockEnd > 0) {
      let block = out.slice(tStart, blockEnd);
      const nb = block
        .replace(/,\s*\bru\s*$/, '')          // `,\n  ru` в конце
        .replace(/\bru\s*,\s*/, '')            // `ru, ` в середине/начале
        .replace(/,\s*,/, ',');
      if (nb !== block) { out = out.slice(0, tStart) + nb + out.slice(blockEnd); changed = true; }
    }
  }
  return { content: out, changed };
}

function unpatchLanguagesContent(content) {
  let out = content;
  // Блок опции ru: `,\n  {\n    id: 'ru',…\n  }` перед `] as const`
  out = out.replace(/,?\s*\{\s*id:\s*'ru',\s*name:[^}]*\}(\s*\]\s*as const)/, '$1');
  // Алиасы ru (5 строк подряд, с возможной финальной запятой)
  out = out.replace(/,?\s*ru:\s*'ru',\s*\n\s*'ru-ru':\s*'ru',\s*\n\s*ru_ru:\s*'ru',\s*\n\s*русский:\s*'ru',\s*\n\s*'русский':\s*'ru',?/, '');
  // Одиночные варианты (если блок отличался)
  out = out.replace(/,?\s*ru:\s*'ru',?/, '');
  out = out.replace(/,?\s*'ru-ru':\s*'ru',?/, '');
  out = out.replace(/,?\s*ru_ru:\s*'ru',?/, '');
  out = out.replace(/,?\s*русский:\s*'ru',?/, '');
  out = out.replace(/,?\s*'русский':\s*'ru',?/, '');
  // Артефакты собственного удаления: двойные запятые и пустые строки перед }
  out = out.replace(/,(\s*,)+/g, ',').replace(/,\s*\n\s*\n\s*}/g, '\n}');
  return { content: out, changed: out !== content };
}

const UNPATCHERS = {
  'types.ts': unpatchTypesContent,
  'catalog.ts': unpatchCatalogContent,
  'languages.ts': unpatchLanguagesContent,
};

// ---------------------------------------------------------------------------
// Анализ и верификация
// ---------------------------------------------------------------------------

function i18nDir(desktopDir) { return path.join(desktopDir, 'src', 'i18n'); }

function filePatchedFlags(desktopDir) {
  const dir = i18nDir(desktopDir);
  const read = (f) => { try { return toUnix(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } };
  const types = read('types.ts');
  const catalog = read('catalog.ts');
  const languages = read('languages.ts');
  const ruPath = path.join(dir, 'ru.ts');
  const ru = fs.existsSync(ruPath) ? toUnix(fs.readFileSync(ruPath, 'utf8')) : null;

  const flags = {
    typesHasRu: !!types && /export type Locale\s*=[^;\n]*'ru'/.test(types),
    catalogImportsRu: !!catalog && /from\s*'\.\/ru'/.test(catalog),
    catalogRegistersRu: false,
    languagesHasOption: !!languages && /id:\s*'ru'/.test(languages),
    languagesHasAlias: !!languages && /^\s*ru:\s*'ru'/m.test(languages),
    ruTsExists: ru !== null,
    ruTsValid: !!ru && /defineLocale/.test(ru),
    filesExist: { types: types !== null, catalog: catalog !== null, languages: languages !== null },
  };
  if (catalog) {
    const tStart = catalog.search(/export const TRANSLATIONS[^[{]*\{/);
    const blockEnd = tStart >= 0 ? catalog.indexOf('\n}', tStart) : -1;
    if (tStart >= 0 && blockEnd > 0) {
      flags.catalogRegistersRu = /(?:^|[,{\s])ru(?:\s*,|\s*$)/m.test(catalog.slice(tStart, blockEnd));
    }
  }
  return flags;
}

/** dry-run: прошли бы якоря на текущем содержимом (ничего не пишет). */
function anchorsProbe(desktopDir) {
  const dir = i18nDir(desktopDir);
  const report = {};
  for (const f of I18N_FILES) {
    try {
      const raw = toUnix(fs.readFileSync(path.join(dir, f), 'utf8'));
      const r = PATCHERS[f](raw);
      // патч «сработал» — но также убеждаемся, что результат проходит верификацию
      const verify = PATCHERS[f](r.content); // второй прогон — идемпотентность
      report[f] = { ok: true, idempotent: verify.changed === false };
    } catch (e) {
      report[f] = { ok: false, error: e.message };
    }
  }
  return report;
}

function analyzeSources(desktopDir) {
  const f = filePatchedFlags(desktopDir);
  // tracked-аспекты — то, что живёт в git-файлах upstream; ru.ts — наш untracked файл.
  // Сирота-ru.ts (остаток старой установки при чистых tracked-файлах) НЕ делает
  // состояние 'partial': файл ни на что не влияет, пока не зарегистрирован.
  const trackedAspects = [f.typesHasRu, f.catalogImportsRu, f.catalogRegistersRu, f.languagesHasOption, f.languagesHasAlias];
  const all = trackedAspects.every(Boolean) && f.ruTsExists;
  const trackedNone = !trackedAspects.some(Boolean);
  let state;
  if (all) state = 'patched';
  else if (trackedNone) state = 'clean';
  else state = 'partial';
  return {
    state,
    orphanRuTs: trackedNone && f.ruTsExists,
    flags: f,
  };
}

function verifySources(desktopDir) {
  const { flags } = analyzeSources(desktopDir);
  const problems = [];
  if (!flags.filesExist.types) problems.push('types.ts отсутствует');
  if (!flags.filesExist.catalog) problems.push('catalog.ts отсутствует');
  if (!flags.filesExist.languages) problems.push('languages.ts отсутствует');
  if (!flags.typesHasRu) problems.push("types.ts: 'ru' не в Locale-union");
  if (!flags.catalogImportsRu) problems.push("catalog.ts: нет import { ru } from './ru'");
  if (!flags.catalogRegistersRu) problems.push('catalog.ts: ru не зарегистрирован в TRANSLATIONS');
  if (!flags.languagesHasOption) problems.push("languages.ts: нет опции id: 'ru' в LOCALE_OPTIONS");
  if (!flags.languagesHasAlias) problems.push("languages.ts: нет алиаса ru: 'ru' в LOCALE_ALIASES");
  if (!flags.ruTsExists) problems.push('ru.ts отсутствует в src/i18n/');
  else if (!flags.ruTsValid) problems.push('ru.ts не содержит defineLocale');
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// Snapshot / restore (Buffer-level, SHA256 manifest)
// ---------------------------------------------------------------------------

function snapshotSources(desktopDir) {
  const dir = i18nDir(desktopDir);
  const settingsDir = path.join(desktopDir, 'src', 'app', 'settings');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(getDataDir(), 'backups', stamp);
  fs.mkdirSync(backupDir, { recursive: true });
  const manifest = { createdAt: new Date().toISOString(), desktopDir, files: [] };

  // Плоские i18n-файлы + en.ts (его патчит components-patch) + компоненты
  let componentRels = [];
  try {
    componentRels = Object.keys(require('./components-patch').COMPONENT_FILES);
  } catch { /* модуль старой версии — только i18n */ }
  const targets = [
    ...[...I18N_FILES, 'ru.ts', 'en.ts'].map(f => ({ rel: f, abs: path.join(dir, f) })),
    { rel: 'src/app/settings/ru-constants.ts', abs: path.join(desktopDir, 'src', 'app', 'settings', 'ru-constants.ts') },
    ...componentRels.map(f => ({ rel: `src/app/settings/${f}`, abs: path.join(settingsDir, f) })),
  ];

  for (const t of targets) {
    const entry = { file: t.rel, existed: fs.existsSync(t.abs) };
    if (entry.existed) {
      const buf = fs.readFileSync(t.abs);
      fs.writeFileSync(path.join(backupDir, t.rel.replace(/[\\/]/g, '__')), buf);
      entry.sha256 = sha256(buf);
    }
    manifest.files.push(entry);
  }
  fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  pruneBackups();
  return { backupDir, manifest };
}

function pruneBackups() {
  const root = path.join(getDataDir(), 'backups');
  if (!fs.existsSync(root)) return;
  const dirs = fs.readdirSync(root).map(d => path.join(root, d))
    .filter(p => fs.statSync(p).isDirectory()).sort();
  while (dirs.length > MAX_BACKUPS) {
    const victim = dirs.shift();
    try { fs.rmSync(victim, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

function restoreFromBackup(backupDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, 'manifest.json'), 'utf8'));
  const dir = i18nDir(manifest.desktopDir);
  for (const entry of manifest.files) {
    // Совместимость: плоские имена (старые манифесты) — i18n-файлы;
    // пути с '/' — относительно desktopDir (components-patch покрытие v1.1.3+)
    const target = entry.file.includes('/')
      ? path.join(manifest.desktopDir, entry.file)
      : path.join(dir, entry.file);
    if (entry.existed) {
      const buf = fs.readFileSync(path.join(backupDir, entry.file.replace(/[\\/]/g, '__')));
      if (sha256(buf) !== entry.sha256) throw new Error(`snapshot повреждён: ${entry.file}`);
      fs.writeFileSync(target, buf);
    } else if (fs.existsSync(target)) {
      fs.rmSync(target, { force: true });
    }
  }
}

function newestBackup(desktopDir) {
  const root = path.join(getDataDir(), 'backups');
  if (!fs.existsSync(root)) return null;
  const dirs = fs.readdirSync(root).map(d => path.join(root, d))
    .filter(p => fs.statSync(p).isDirectory() &&
      fs.existsSync(path.join(p, 'manifest.json')))
    .filter(p => {
      try { return JSON.parse(fs.readFileSync(path.join(p, 'manifest.json'), 'utf8')).desktopDir === desktopDir; }
      catch { return false; }
    })
    .sort();
  return dirs.length ? dirs[dirs.length - 1] : null;
}

// ---------------------------------------------------------------------------
// applyPatch / removePatch — транзакции
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Version gate для components-patch (0.19.x: 0.19.0 + 0.19.1)
// ---------------------------------------------------------------------------

function isVersion019(desktopDir) {
  // Явный маркер версии в дереве (фикстуры тестов; иначе шаг 5 applyPatch
  // в тестах молча пропускался бы — слепая зона, нашедшая ReferenceError v1.1.2)
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(desktopDir, 'hermes-version.json'), 'utf8'));
    if (marker.cliVersion) return /^0\.19\./.test(marker.cliVersion);
  } catch { /* нет маркера — штатный путь */ }
  const info = detectHermes(desktopDir);
  return info.cliVersion ? /^0\.19\./.test(info.cliVersion) : false;
}

// ---------------------------------------------------------------------------
// applyPatch / removePatch — транзакции
// ---------------------------------------------------------------------------

function applyPatch(desktopDir, { ruTsSource } = {}) {
  const dir = i18nDir(desktopDir);
  for (const f of I18N_FILES) {
    if (!fs.existsSync(path.join(dir, f))) throw new Error(`Не найден src/i18n/${f} в ${desktopDir}`);
  }
  const ruSource = ruTsSource || path.join(__dirname, 'i18n', 'ru.ts');
  if (!fs.existsSync(ruSource)) throw new Error(`ru.ts пакета не найден: ${ruSource}`);

  const current = analyzeSources(desktopDir);
  if (current.state === 'partial') {
    throw new Error("Исходники в состоянии 'partial' (прошлый патч лёг криво). Сначала: hermes-ru repair — он приведёт их к чистому виду.");
  }
  if (current.state === 'patched') {
    // Освежим ru.ts на случай обновления пакета
    const target = path.join(dir, 'ru.ts');
    const srcBuf = fs.readFileSync(ruSource);
    if (!fs.existsSync(target) || !fs.readFileSync(target).equals(srcBuf)) {
      const { backupDir } = snapshotSources(desktopDir);
      fs.writeFileSync(target, srcBuf);
      return { changed: ['ru.ts'], backupDir, already: false };
    }
    return { changed: [], already: true };
  }

  // 1. Все патчи в памяти (любой PatchAnchorError — до единой записи)
  const originals = {};
  const patched = {};
  const eols = {};
  for (const f of I18N_FILES) {
    const raw = fs.readFileSync(path.join(dir, f));
    originals[f] = raw;
    eols[f] = detectEol(raw.toString('utf8'));
    const r = PATCHERS[f](toUnix(raw.toString('utf8')));
    patched[f] = r.content;
  }
  // Верификация in-memory: повторный прогон идемпотентен + флаги на пропатченном тексте
  for (const f of I18N_FILES) {
    const again = PATCHERS[f](patched[f]);
    if (again.changed) throw new Error(`Патч ${f} не идемпотентен — отмена`);
  }

  // 2. Snapshot
  const { backupDir } = snapshotSources(desktopDir);

  // 3. Запись (EOL исходника)
  try {
    for (const f of I18N_FILES) {
      fs.writeFileSync(path.join(dir, f), fromUnix(patched[f], eols[f]), 'utf8');
    }
    fs.writeFileSync(path.join(dir, 'ru.ts'), fs.readFileSync(ruSource));

    // ru-constants.ts — реэкспорт FIELD_LABELS/FIELD_DESCRIPTIONS (билд-блокер с 0.19.1)
    const settingsDir = path.join(desktopDir, 'src', 'app', 'settings');
    const ruConstantsPath = path.join(settingsDir, 'ru-constants.ts');
    if (!fs.existsSync(ruConstantsPath)) {
      fs.mkdirSync(settingsDir, { recursive: true });
      const ruConstantsContent = `/**\n * Russian field-copy constants for settings UI.\n *\n * Temporary English fallback — re-exports the canonical English labels and\n * descriptions so the desktop app builds while Russian translations are being\n * authored.\n */\n\nimport { FIELD_DESCRIPTIONS, FIELD_LABELS } from '@/app/settings/constants'\n\nexport const RU_FIELD_LABELS: Record<string, string> = FIELD_LABELS\nexport const RU_FIELD_DESCRIPTIONS: Record<string, string> = FIELD_DESCRIPTIONS\n`;
      fs.writeFileSync(ruConstantsPath, ruConstantsContent, 'utf8');
    }
  } catch (e) {
    restoreFromBackup(backupDir);
    throw e;
  }

  // 4. Верификация на диске; сбой → restore
  const v = verifySources(desktopDir);
  if (!v.ok) {
    restoreFromBackup(backupDir);
    throw new Error('Верификация после записи не пройдена (откат выполнен): ' + v.problems.join('; '));
  }

  // 5. Components-patch (i18n-проводка MoA/billing/custom-endpoints) — для 0.19.x (0.19.0+)
  let componentChanged = [];
  if (isVersion019(desktopDir)) {
    const settingsDir = path.join(desktopDir, 'src', 'app', 'settings');
    const componentFilesExist =
      fs.existsSync(path.join(settingsDir, 'model-settings.tsx')) &&
      fs.existsSync(path.join(settingsDir, 'custom-endpoints-settings.tsx')) &&
      fs.existsSync(path.join(settingsDir, 'billing', 'index.tsx'));
    if (componentFilesExist) {
      try {
        const cp = require('./components-patch');
        const cpResult = cp.applyComponentPatches(desktopDir);
        if (cpResult.changed.length > 0) {
          componentChanged = cpResult.changed;
        }
      } catch (e) {
        restoreFromBackup(backupDir);
        throw new Error('Components-patch не удался (откат выполнен): ' + e.message);
      }
    }
  }

  const allChanged = [...I18N_FILES, 'ru.ts'];
  for (const f of componentChanged) {
    if (!allChanged.includes(f)) allChanged.push(f);
  }
  return { changed: allChanged, backupDir, already: false };
}

function removePatch(desktopDir, { allowGitFallback = true } = {}) {
  const dir = i18nDir(desktopDir);
  const backup = newestBackup(desktopDir);

  // Путь 1: snapshot (byte-identical)
  if (backup) {
    restoreFromBackup(backup);
    const st = analyzeSources(desktopDir).state;
    if (st === 'clean') return { method: 'snapshot', ok: true };
    // snapshot был сделан уже после частичного патча — идём дальше
  }

  // Путь 2: структурное удаление
  const state = analyzeSources(desktopDir);
  if (state.state !== 'clean') {
    const { backupDir } = snapshotSources(desktopDir); // страховка текущего состояния
    try {
      for (const f of I18N_FILES) {
        const p = path.join(dir, f);
        if (!fs.existsSync(p)) continue;
        const raw = fs.readFileSync(p).toString('utf8');
        const eol = detectEol(raw);
        const r = UNPATCHERS[f](toUnix(raw));
        if (r.changed) fs.writeFileSync(p, fromUnix(r.content, eol), 'utf8');
      }
      const ruPath = path.join(dir, 'ru.ts');
      if (fs.existsSync(ruPath)) fs.rmSync(ruPath, { force: true });
    } catch (e) {
      restoreFromBackup(backupDir);
      throw e;
    }
  }
  if (analyzeSources(desktopDir).state === 'clean') return { method: 'structural', ok: true };

  // Путь 3: git checkout tracked-файлов (только внутри git-репо Hermes)
  if (allowGitFallback) {
    try {
      execFileSync('git', ['checkout', '--', 'apps/desktop/src/i18n/types.ts', 'apps/desktop/src/i18n/catalog.ts', 'apps/desktop/src/i18n/languages.ts'],
        { cwd: path.resolve(desktopDir, '..', '..'), stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
      const ruPath = path.join(dir, 'ru.ts');
      if (fs.existsSync(ruPath)) fs.rmSync(ruPath, { force: true });
    } catch { /* не git-репо или нет git */ }
  }
  const finalState = analyzeSources(desktopDir).state;
  if (finalState !== 'clean') {
    throw new Error('removePatch: не удалось привести исходники к чистому состоянию');
  }
  return { method: 'git-fallback', ok: true };
}

// ---------------------------------------------------------------------------
// Hermes: версия, совместимость, конфиг, сборка
// ---------------------------------------------------------------------------

function detectHermes(desktopDir) {
  const info = { commit: null, branch: null, builtAt: null, cliVersion: null, installStampDirty: null };
  try {
    const stamp = JSON.parse(fs.readFileSync(path.join(desktopDir, 'release', 'win-unpacked', 'resources', 'install-stamp.json'), 'utf8'));
    info.commit = stamp.commit || null;
    info.branch = stamp.branch || null;
    info.builtAt = stamp.builtAt || null;
    info.installStampDirty = !!stamp.dirty;
  } catch { /* нет release */ }
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.resolve(desktopDir, '..', '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }).trim();
    info.gitHead = head;
  } catch { /* не git */ }
  const cli = findHermesCli();
  if (cli) {
    try {
      const out = execFileSync(cli, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 });
      const m = String(out).match(/v?(\d+\.\d+\.\d+)/);
      if (m) info.cliVersion = m[1];
    } catch { /* best effort */ }
  }
  return info;
}

function checkCompatibility(hermesInfo, compatPath) {
  let compat = { hermesVersions: [] };
  try { compat = JSON.parse(fs.readFileSync(compatPath || path.join(__dirname, '..', 'compat.json'), 'utf8')); } catch { /* нет файла */ }
  const known = compat.hermesVersions || [];
  if (hermesInfo.cliVersion && known.includes(hermesInfo.cliVersion)) {
    return { status: 'supported', reason: `Hermes ${hermesInfo.cliVersion} в списке совместимых` };
  }
  return {
    status: 'anchors-required',
    reason: `Hermes ${hermesInfo.cliVersion || 'неизвестной версии'} не в compat.json (${known.join(', ') || 'пусто'}). Патч разрешён только при 100% совпадении якорей (doctor показывает dry-run).`,
  };
}

function setConfigLanguage(language) {
  const cli = findHermesCli();
  if (!cli) {
    return { ok: false, reason: 'hermes CLI не найден', instruction: `Выполните вручную: hermes config set display.language ${language}` };
  }
  execFileSync(cli, ['config', 'set', 'display.language', language], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
  const out = execFileSync(cli, ['config', 'get', 'display.language'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
  const value = String(out).trim().split(/\r?\n/).pop().trim();
  if (value !== language) {
    return { ok: false, reason: `config get вернул '${value}' вместо '${language}'` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// dist-проверки (для status/verify после сборки)
// ---------------------------------------------------------------------------

function collectTextFiles(rootDir, acc = []) {
  if (!fs.existsSync(rootDir)) return acc;
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const p = path.join(rootDir, entry.name);
    if (entry.isDirectory()) collectTextFiles(p, acc);
    else if (/\.(?:js|css|html|json)$/i.test(entry.name)) acc.push(p);
  }
  return acc;
}

function distLooksHealthy(distDir) {
  const indexPath = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexPath)) return false;
  let html;
  try { html = fs.readFileSync(indexPath, 'utf8'); } catch { return false; }
  const refs = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map(m => m[1].split(/[?#]/)[0])
    .filter(r => r && !r.startsWith('#') && !/^(?:[a-z]+:)?\/\//i.test(r) && !r.startsWith('data:'));
  return refs.length > 0 && refs.every(r => fs.existsSync(path.join(distDir, r.replace(/^[/\\]+/, ''))));
}

function distContainsRussian(distDir) {
  const content = collectTextFiles(distDir).map(p => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }).join('\n');
  return RU_SENTINELS.every(s => content.includes(s));
}

function runtimeDistDir(desktopDir) {
  return path.join(desktopDir, 'release', 'win-unpacked', 'resources', 'app.asar.unpacked', 'dist');
}

/** electron.exe в workspace может быть захощен вверх по дереву (root node_modules). */
function findElectronExe(desktopDir) {
  let current = path.resolve(desktopDir);
  for (let i = 0; i < 8; i++) {
    const exe = path.join(current, 'node_modules', 'electron', 'dist', 'electron.exe');
    if (fs.existsSync(exe)) return exe;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Миграция legacy-состояния v0.22.x (~/.hermes/russian-loc)
// ---------------------------------------------------------------------------

function migrateLegacyDataDir() {
  const legacy = path.join(os.homedir(), '.hermes', 'russian-loc');
  const current = getDataDir();
  if (path.resolve(legacy).toLowerCase() === path.resolve(current).toLowerCase()) return { migrated: false };
  if (!fs.existsSync(legacy)) return { migrated: false };
  const moved = [];
  for (const item of ['ru.ts', 'hermes-ru.log']) {
    const src = path.join(legacy, item);
    const dst = path.join(current, item);
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      try { fs.copyFileSync(src, dst); moved.push(item); } catch { /* best effort */ }
    }
  }
  // Устаревшие артефакты v0.22 (launcher/pending/ярлык-данные) — просто отмечаем
  const stale = ['hermes-ru-launcher.js', 'pending-build.json', 'hermes-exe-path.txt', 'version.json', 'launcher.lock']
    .filter(f => fs.existsSync(path.join(legacy, f)));
  return { migrated: moved.length > 0 || stale.length > 0, moved, staleLeftovers: stale, legacyDir: legacy };
}

module.exports = {
  PatchAnchorError,
  RU_SENTINELS,
  getHermesHome,
  getDataDir,
  findDesktopDir,
  findHermesCli,
  isHermesRunning,
  analyzeSources,
  anchorsProbe,
  verifySources,
  applyPatch,
  removePatch,
  snapshotSources,
  restoreFromBackup,
  detectHermes,
  checkCompatibility,
  setConfigLanguage,
  distLooksHealthy,
  distContainsRussian,
  runtimeDistDir,
  findElectronExe,
  migrateLegacyDataDir,
  isVersion019,
  _internals: { PATCHERS, UNPATCHERS, detectEol, toUnix, fromUnix, insertBeforeClose, parseTasklistCsv },
};
