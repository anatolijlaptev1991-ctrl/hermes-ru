# История изменений hermes-ru

## v1.0.1 (2026-07-25)

**Багфиксы, найденные при подготовке upstream PR (прогон upstream-проверок `tsc`+ESLint на свежем main):**

- **patch-engine:** дубликат ключа `русский` в `LOCALE_ALIASES` (TS1117 при typecheck; vite его молча терпел — поэтому всплыло только сейчас). Оставлена одна quoted-форма.
- **patch-engine:** `import { ru }` в catalog.ts теперь вставляется в алфавитную позицию (правило perfectionist/sort-imports; учитываются и `import type` строки).
- **Контрактный экстрактор + генератор:** quoted-ключи с точкой (`'keybinds.openPanel'`, 58 шт. в en.ts) больше не разрываются во вложенность — точка кодируется сентинелом на этапе токенизации. Раньше эти ключи эмитились вложенными объектами → несовпадение с типом `Translations` (string) и английский fallback для всех 58 подписей горячих клавиш.
- **ru.ts:** регенерирован (quoted dot-keys на своих местах); пролог `ruPlural` приведён к upstream-стилю (curly + padding).
- Контракт: en 2658 = ru 2658, stale 0, missing 0; тесты 13/13; typecheck/ESLint/i18n-тесты на upstream main — зелёные.

## v1.0.0 (2026-07-25)

**Архитектурный перелом: «штатный цикл» вместо launcher-инфраструктуры.**

Главное: больше **нет отдельного ярлыка «Hermes RU» и self-healing launcher'а**. Патч живёт как обычные uncommitted-правки git-дерева Hermes — штатный апдейтер (`updates.non_interactive_local_changes: stash`) сам переносит их при обновлениях, штатный content-hash build stamp сам триггерит пересборку. Запуск Hermes — любым обычным способом.

**Корень белых экранов устранён (RC-1…RC-6):**

- **patch-engine со структурными якорями** вместо регексов, зашитых под список локалей 0.18 (вышла 0.19.0 с локалью `ar` → регексы молча не совпадали → полупропатч → белый экран). Теперь патч работает на любой комбинации локалей upstream.
- **Ноль тихих no-op:** якорь не найден → `PatchAnchorError` → ничего не пишется. Верификация после записи — во всех путях.
- **Транзакции:** снапшот (байты + SHA256 manifest) → патч в памяти → verify → запись → verify на диске → любой сбой = автооткат.
- **Version gate:** версия не из compat.json — только при 100% совпадении якорей (dry-run в `hermes-ru doctor`), иначе честный отказ (остаётся английский).
- **config.yaml только через `hermes config set`** (убрана ручная правка — hard invariant Hermes).
- **HERMES_HOME-aware пути** (больше никакого хардкода `~/.hermes`); миграция legacy-состояния v0.22.x при install.

**Перевод синхронизирован с en.ts 0.19.0:**

- 2658 ключей, **100% покрытие** (было: 1 мёртвый ключ + 365 недостающих — ломало tsc).
- `ru.ts` теперь **генерируется** по en.ts (`scripts/generate-ru-ts.js`) — порядок секций совпадает с upstream, будущие рассинхроны ловятся мгновенно.
- Контрактный тест (точный токенизер TS: строки/шаблоны/тернарники/const-референсы/`@/`-импорты/defineFieldCopy): ru ⊆ en жёстко, en ⊄ ru — метрика покрытия.

**CLI v2:** `install / uninstall / status / repair / build / doctor / log-on / log-off`.
`build` — официальный `hermes desktop --build-only` (только при закрытом app: запущенный Hermes сборка убивает — зафиксировано в коде hermes_cli). `status` одной строкой говорит, что делать дальше.

**Тесты:** fixture-матрица F1–F10 (v0.18-стиль / v0.19 с `ar` / будущие локали / идемпотентность / битый якорь→откат / byte-identical restore CRLF / partial-детект / orphan ru.ts / реальный Hermes dry-run / юниты) + контракт перевода. 13/13.

**Удалено:** `launcher/`, `scripts/auto-update.js`, `scripts/publish.js`, pending-build очередь, создание ярлыков, само-обновление пакета (обновление: `npm i -g …@latest`).

## v0.22.5 (2026-07-16)

**Тотальное логирование с лёгким вкл/выкл:**

- Лог-файл: `~/.hermes/russian-loc/hermes-ru.log`
- Включение: `hermes-ru log-on` или `HERMES_RU_LOG=1`
- Отключение: `hermes-ru log-off` или `HERMES_RU_LOG=0`
- Уровни: INFO, WARN, ERROR, DEBUG (debug — только в файл)
- Все `log('⚠ ...')` → `warn('...')`, `log('✗ ...')` → `error('...')`
- Debug-логи в ключевых точках (старт, pending, build, launch)

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
