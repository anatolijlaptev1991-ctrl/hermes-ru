<div align="center">

# 🇷🇺 Hermes Agent — Русская локализация

**Полный перевод интерфейса Hermes Agent Desktop на русский. Работает в штатном цикле Hermes — без отдельных ярлыков, launcher'ов и танцев после обновлений.**

[![License](https://img.shields.io/github/license/anatolijlaptev1991-ctrl/hermes-ru?style=flat-square)](LICENSE)
[![Stars](https://img.shields.io/github/stars/anatolijlaptev1991-ctrl/hermes-ru?style=flat-square)](https://github.com/anatolijlaptev1991-ctrl/hermes-ru/stargazers)
[![Last Commit](https://img.shields.io/github/last-commit/anatolijlaptev1991-ctrl/hermes-ru?style=flat-square)](https://github.com/anatolijlaptev1991-ctrl/hermes-ru/commits)
[![Hermes](https://img.shields.io/badge/Hermes%20Agent-v0.19.0-6366f1?style=flat-square)](https://github.com/nousresearch/hermes-agent)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078d4?style=flat-square)](https://github.com/anatolijlaptev1991-ctrl/hermes-ru)
[![npm](https://img.shields.io/npm/v/@anatolijlaptev1991/hermes-ru?style=flat-square&label=npm)](https://www.npmjs.com/package/@anatolijlaptev1991/hermes-ru)

</div>

---

## Описание

Полная русская локализация десктопного приложения **[Hermes Agent](https://github.com/nousresearch/hermes-agent)** от Nous Research: меню, настройки, чат, уведомления, инструменты — **2658 ключей, 100% покрытие** (контракт проверяется тестом и компилятором TypeScript при каждой сборке).

## Быстрый старт

```bash
npm install -g @anatolijlaptev1991/hermes-ru
hermes-ru install
```

Запускайте Hermes **как обычно** — обычный ярлык, `hermes desktop`, что угодно. Никаких отдельных ярлыков «Hermes RU» больше нет и не нужно.

- Если Hermes закрыт — `install` сам запустит официальную пересборку, и следующий запуск уже будет русским.
- Если Hermes запущен — патч и язык применятся сразу, но **пересборка не произойдёт автоматически**. Закройте Hermes полностью (крестиком), откройте терминал (cmd/PowerShell) и выполните:

  ```bash
  hermes desktop --force-build
  ```

  Это пересоберёт приложение (2–10 мин) и запустит его.

> ⚠️ **Важно:** обычный перезапуск приложения (закрыть → открыть `.exe`) **НЕ вызывает пересборку**. Content-hash стемп сравнивается только при запуске через `hermes desktop` в терминале. Запуск `.exe` напрямую — всегда грузит последнюю сборку.

## Как это работает (архитектура «штатный цикл», v1.0)

Hermes не имеет runtime-API для добавления языка ядра: каталог переводов статичен и запекается при сборке, а i18n desktop-плагинов покрывает только UI самих плагинов. Поэтому локаль добавляется патчем исходников — но **встроенным в штатные механизмы Hermes**, а не параллельной инфраструктурой:

1. **Патч как обычные правки.** `patch-engine` регистрирует локаль `ru` в четырёх файлах `apps/desktop/src/i18n/` (структурные якоря — работают на любой комбинации локалей upstream, а не на заученной). Это обычные uncommitted-изменения git-дерева.
2. **Обновления Hermes переносят патч штатно.** Апдейтер (`updates.non_interactive_local_changes: stash` — дефолт) при `hermes update` стешит локальные правки, пуллит и авто-восстанавливает их поверх нового кода. При конфликте — грациозный английский (никогда не белый экран), а `hermes-ru repair` перепатчивает одной командой.
3. **Пересборка — самим Hermes.** Hermes хеширует весь `apps/desktop`; наш патч меняет хеш → штатная пересборка при `hermes desktop` / `hermes update` (с её собственными предохранителями: бэкап before-pack и проверка exe на Windows).
4. **Язык — официальным путём.** `display.language: ru` выставляется через `hermes config set`, без ручной правки `config.yaml`.

## Безопасность и откат

- **Ноль тихих no-op:** если якорь не найден (неизвестная будущая версия Hermes), патч **отменяется целиком**, ничего не пишется — приложение никогда не остаётся «полупропатченным».
- **Транзакция:** снапшот (байты + SHA256 manifest) → патч в памяти → верификация → запись → верификация на диске. Любой сбой = автоматический откат.
- **Version gate:** версия не из `compat.json` допускается только при 100% совпадении якорей (dry-run в `hermes-ru doctor`).
- **Откат одной командой:** `hermes-ru uninstall` — снятие патча (snapshot → структурное удаление → `git checkout`), язык `en`, пересборка.

## Команды

| Команда | Описание |
|---------|----------|
| `hermes-ru install` | Установить локаль (патч + язык + сборка при закрытом Hermes) |
| `hermes-ru install --no-build` | Только патч + язык (сборка — позже, автоматически) |
| `hermes-ru build` | Пересобрать app (только когда Hermes закрыт) |
| `hermes-ru status` | Статус + что делать дальше одной строкой |
| `hermes-ru repair` | Перепатчить (после обновления Hermes / сбоя) |
| `hermes-ru uninstall` | Вернуть английский интерфейс |
| `hermes-ru doctor` | Диагностика: пути, тулчейн, якоря (dry-run), настройки updater'а |
| `hermes-ru log-on` / `log-off` | Лог в `<HERMES_HOME>/russian-loc/hermes-ru.log` |

## Что происходит при обновлении Hermes

1. `hermes update` (или кнопка Update в app): апдейтер стешит патч → пуллит → **восстанавливает патч** → пересобирает app с русским. Вмешательство не нужно.
2. Если upstream поменял те же строки (конфликт restore): app открывается по-английски (это безопасный fallback, не поломка) → выполните `hermes-ru repair` — структурные якоря подстроятся под новый upstream → пересборка → снова русский.
3. Если вышла версия Hermes с **незнакомой структурой i18n**: патчер откажется патчить (ничего не сломает) и попросит обновить пакет: `npm i -g @anatolijlaptev1991/hermes-ru@latest`.

> Интерактивный `hermes update` спрашивает, восстанавливать ли локальные правки — отвечайте **да**, это наш патч.

## Почему не desktop-плагин

[Desktop Plugin SDK](https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk) — официальный механизм изолированных модов (hot-reload, песочница), но его i18n **plugin-scoped**: `ctx.i18n.register` переводит только UI самого плагина («never edit core en.ts»). Перевести ядро приложения плагином невозможно — `TRANSLATIONS` статичен на этапе сборки. Поэтому: патч + штатный цикл. Параллельный путь — [upstream PR](#upstream-путь).

## Upstream-путь

Правильный конец истории — локаль `ru` в самом Hermes (по contribution rubric локали — приветствуемая категория «expand reach at the edges»). `src/i18n/ru.ts` этого репозитория готовится в формате, пригодном для PR в [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent). Когда PR примут — пакет станет ненужным, и это будет победа.

## Требования

- **Windows 10 / 11**
- **[Node.js](https://nodejs.org)** 18+ и npm
- **Hermes Agent Desktop**, установленный из **исходников** (`git clone` инсталлятор, а не готовый `.exe`)

## Совместимость

| Hermes | hermes-ru |
|--------|-----------|
| 0.19.0 | **1.0.0** (структурные якоря) |
| 0.17.0 – 0.18.2 | 0.22.x (legacy, launcher-архитектура) |

Версия не из списка — только после успешного dry-run якорей в `hermes-ru doctor`.

## Решение проблем

**После обновления Hermes интерфейс английский.** Норма при конфликте restore: `hermes-ru repair`.

**`hermes-ru status` говорит «ждёт пересборки».** Это значит: патч в исходниках есть, но `.exe` собран из старого кода. Закройте Hermes полностью, откройте терминал и выполните: `hermes desktop --force-build` (2–10 мин). Либо `hermes-ru build` если Hermes уже закрыт.

> Обычный перезапуск `.exe` (закрыть/открыть окно) **не поможет** — нужна именно пересборка через терминал.

**`doctor` пишет «якорь не совпадает».** Вышла несовместимая версия Hermes: `npm i -g @anatolijlaptev1991/hermes-ru@latest`; если уже последняя — откройте issue.

**Нужно вернуть английский.** `hermes-ru uninstall`.

## Для разработчиков

```bash
npm test            # fixture-матрица patch-engine (F1–F10) + контракт перевода
npm run test:contract  # только контракт ru ⊆ en (против живого Hermes)
node scripts/sync-translation.js       # рассинхрон ru↔en (stale/missing/values)
node scripts/generate-ru-ts.js         # пересобрать ru.ts по en.ts + переводам
```

Структура:

```
hermes-ru/
├── src/patch-engine.js     # ядро: структурный патчер, снапшоты, верификация
├── src/i18n/ru.ts          # перевод (2658 ключей, генерируется по en.ts)
├── bin/                    # CLI (тонкие обёртки над patch-engine)
├── tests/                  # fixture-матрица + контрактный тест
├── scripts/                # sync/generate/анализ перевода
└── compat.json             # карта совместимости
```

## Лицензия

MIT — делайте что хотите, ссылка на автора приветствуется.

---

## История разработки

`hermes-ru` начался с серии белых экранов. Каждый показал, где подход был неверен.

1. **v0.17.x:** замена `app.asar.unpacked/dist/` целиком и regex-правка минифицированного бандла — ломалось всё.
2. **v0.18–v0.22:** `defineLocale + npm run build` — правильная идея, но регексы патча были зашиты под конкретный список локалей upstream. Вышел Hermes 0.19.0 с локалью `ar` → регексы молча перестали совпадать → полупропатченные исходники → белые экраны и переустановки.
3. **v1.0.0:** перелом. Структурные якоря (не зависят от набора локалей), транзакции со снапшотами, верификация на каждом шаге, отказ при неизвестной версии. Launcher и отдельный ярлык **упразднены**: патч живёт в штатном цикле обновлений Hermes (autostash + content-hash build stamp). Перевод синхронизирован с en.ts 0.19.0: 2658 ключей, контракт проверяет компилятор.

**Итог:** устанавливается одной командой, переживает обновления штатно, откатывается одной командой, ломать не умеет — при любой неопределённости остаётся английский.

---

## Поддержать проект

Если `hermes-ru` сэкономил вам время — можно отблагодарить переводом на карту. Это не обязательно, но приятно 💙

| Банк | Номер карты |
|------|-------------|
| СБЕР | 2202 2069 5314 1814 |
| Т-Банк | 2200 7001 6638 4775 |

---

⭐ Если пакет помог — поставьте звезду на GitHub, это помогает другим найти русскую локализацию!
