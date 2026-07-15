# История изменений hermes-ru

## v0.19.2 (2026-07-15)

Раунд 3 аудита (6 багов):
- catalog.ts regex CRLF-tolerant
- Автообновление: копирует ru.ts + создаёт pending-build
- Self-heal: восстанавливает пропавший marker
- dist copy: проверка app.asar.unpacked
- commandStatus: marker try/catch
- package-lock: убран asar

## v0.19.1 (2026-07-15)

Раунд 2 аудита (6 багов):
- Self-heal проверяет 3 файла (types+catalog+ru.ts)
- pending-build.json try/catch
- Build output видим (inherit)
- Автообновление: версия только при наличии ru.ts
- pending-build перед GitHub API
- Убрана неиспользуемая extractedDist

## v0.19.0 (2026-07-15)

**Полный аудит и очистка** (8 аудиторов, 4 верификатора):

### Критические исправления
- **catalog.ts regex**: исправлен — `ja,` вместо `ja` (перевод не применялся)
- **Автообновление**: `applyTranslation()` → `applyTranslationInPlace()` (был ReferenceError)
- **status**: теперь показывает pending-build (раньше врал «не установлено»)
- **repair**: теперь вызывает `stageToPersistent` (launcher обновлялся)
- **install --restart**: теперь реально запускает launcher

### Очистка пакета: 38 МБ → 260 КБ
- Убран `dist/` (37 МБ, мёртвый груз)
- Убран `@electron/asar` dependency (не используется)
- Убран `config/translations-map.json` и `hardcoded-strings.json` (мёртвый код)
- Убраны лишние `src/i18n/` файлы (оставлен только `ru.ts`)
- Удалён мёртвый код: `recursiveCopy`, `fileHash`, `killHermes`, `isHermesRunning`, `BACKUP_NAME`, `DIST_DIR`, `crypto`

### Улучшения
- Имя ярлыка унифицировано: «Hermes RU» во всех файлах
- Version sync: package.json, compat.json, package-lock.json
- Build retry limit: 3 попытки, потом pending удаляется
- Preflight: проверка `node_modules` перед build
- `needsPatch`: проверяет types.ts + catalog.ts + ru.ts
- Build output: stderr виден пользователю

## v0.18.0–0.18.5 (2026-07-14)

- Переход на `defineLocale+build` (нативная система i18n Hermes)
- Staging: install НЕ делает build, launcher делает
- Исправлены пути (3 уровня вверх)
- `src/` добавлен в npm-пакет
- pending-build + dist copy в launcher

## v0.17.0–0.17.2 (2026-07-13)

- Первый публичный релиз
- Self-healing launcher, npm-пакет, GitHub Release
