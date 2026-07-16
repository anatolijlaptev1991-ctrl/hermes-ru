# История изменений hermes-ru

## v0.22.4 (2026-07-16)

**Инлайн-PowerShell в launcher — убирает EPERM от Касперского:**

- `inspectWindowsShortcut`: инлайн `-Command` вместо temp `.ps1`.
- `rewriteWindowsShortcut`: инлайн `-Command` вместо temp `.ps1`.
- Убрана неиспользуемая `psSingleQuote()` из launcher.
- Убран `-ExecutionPolicy Bypass` во всех вызовах PowerShell.

## v0.22.3 (2026-07-16)

**Исправление false-positive AV (Trojan.Win32.Generic) при создании ярлыков:**

- `createShortcut` больше не пишет временный `.ps1` файл в `%TEMP%` — PowerShell команда передаётся инлайн через `-Command`.
- Убран `-ExecutionPolicy Bypass` — не нужен для инлайн-команд.
- Удалена неиспользуемая `psSingleQuote()`.

## v0.22.2 (2026-07-16)

**Критическое исправление launcher/lifecycle после сбоя с белым экраном:**

- `version.json` теперь читается обратно совместимо (`version` и `hermesRuVersion`) и записывается с обоими ключами.
- Устаревший `pending-build.json` (старше 24 часов или после 3 попыток) автоматически удаляется; бесконечный цикл сборки прекращён.
- При отсутствии `node_modules` или `electron.exe` pending удаляется, а рабочее состояние не перезаписывается.
- После ошибки `npm run build` предыдущий `app.asar.unpacked/dist` восстанавливается из временной резервной копии.
- Hermes не запускается после неудачной сборки локализации; пользователь получает безопасное сообщение вместо белого экрана.
- Исправлен scope настройки языка: launcher изменяет только `display.language` и не затрагивает `voice.language: ru-RU`.
- Исправлен `setConfigLanguage` в patcher и добавлен второй ключ версии в persistent storage.

## v0.22.1 (2026-07-16)

**Лингвистическая правка (13 исправлений из аудита суб-агента):**

- Грамматика: «Новый рабочий дерево» → «Новое рабочее дерево» (род)
- Грамматика: «Редактирование ход из очереди» → «Редактирование сообщения из очереди» (управление)
- Кальки: «Принуждение к инструментам» → «Обязательное использование инструментов»
- Кальки: «Может быть позже» → «Напомнить позже»
- Кальки: «Коммит и Push» → «Зафиксировать и отправить»
- Смысл: fallbackProviders «резервная копия» → «резервная модель» (не бэкап)
- Смысл: boundaryDesc «в безопасности» → «не затронуты»
- Смысл: testRemote «Тест удалённого» → «Проверить удалённый шлюз»
- Смысл: toolViewDesc «payloads» → «необработанные данные вызовов»
- UI: pagination «пагинация/Пред/След» → «Навигация по страницам/Назад/Далее»
- UI: modelMenu.medium «Сред» → «Средний»
- UI: appearance.toggleMode + существительное «режим»
- UI: onboarding.local.description — переписана литературно

## v0.22.0 (2026-07-15)

**100% покрытие перевода — самый полный русский перевод Hermes Agent:**

- Добавлены 94 отсутствующих ключа (покрытие 97% → **100%**)
- Новые секции: `zones` (38 ключей — управление макетом), `settings.plugins` (12 — плагины десктопа), `shell.approvalMode` (8 — режим подтверждения)
- Добавлены ключи: boot.failure (4), cron (3), keybinds (3), sidebar.row (5), sidebar.projects (3), settings.appearance (2), settings.model (3), titlebar (2), commandCenter (1), assistant.clarify (1), shell.modelOptions (2)
- **Качество:** исправлены скобочные плюрализации (`воркер(ов)` → `ruPlural`) — 8 функций
- **Качество:** англицизм «Возможности» → «Навыки и инструменты»
- **Качество:** «Загрузка возможностей...» → «Загрузка…»
- ruPlural: 28 → **40** использований
- Непереведённых английских строк: **0**
- Файл: 2732 → 2833 строки

## v0.21.0 (2026-07-15)

- Launcher проверяет `npm view` и выполняет `npm install -g` для автоматического обновления
- `ru.ts` и launcher копируются в persistent storage
- Полная автономность: пакет обновляет сам себя
- **Статус изменён с Alpha на Beta-тестирование**

## v0.20.5 (2026-07-15)

- Launcher автоматически устанавливает `language: ru` в `config.yaml` после build
- Пользователю больше не нужно вручную выбирать язык

## v0.20.4 (2026-07-15)

- Добавлена preflight-проверка `electron.exe`: 213 МБ бинарник не скачивается при `npm install`
- Launcher автоматически скачивает Electron через `electron/install.js`
- Устранена главная причина белого экрана

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

## v0.20.0–v0.20.1 (2026-07-15)

**Полное исправление белого экрана:**
- `install` и `repair` больше НЕ патчат TypeScript исходники напрямую
- Launcher делает патч + build + dist copy когда Hermes закрыт
- `uninstall`: launcher пропускает ru patch (pending.version=uninstall)
- needsPatch: проверяет catalog registration
- Launcher: --help handling
- Auto-update: version write после успешного build

## v0.19.7–0.19.10 (2026-07-15)

Раунды 3–6 аудита (15 багов):
- Self-heal CRLF regex + marker only when build not needed
- setConfigLanguage: [\w-]+ для zh-hant + quoted values
- Catalog partial-patch recovery (раздельные import/TRANSLATIONS)
- Pending-build dist copy return false
- Auto-update: no pending without ru.ts
- needsRu scope fix (let вместо const)
- needsPatch: проверка catalog registration
- Auto-update: version write after successful build
- Preflight: не удаляет pending при отсутствии node_modules

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
