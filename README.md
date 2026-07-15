<div align="center">

# 🇷🇺 Hermes Agent — Русская локализация

**Полный перевод интерфейса Hermes Agent Desktop на русский. Ставится одной командой, не слетает при обновлениях.**

[![License](https://img.shields.io/github/license/anatolijlaptev1991-ctrl/hermes-ru?style=flat-square)](LICENSE)
[![Stars](https://img.shields.io/github/stars/anatolijlaptev1991-ctrl/hermes-ru?style=flat-square)](https://github.com/anatolijlaptev1991-ctrl/hermes-ru/stargazers)
[![Last Commit](https://img.shields.io/github/last-commit/anatolijlaptev1991-ctrl/hermes-ru?style=flat-square)](https://github.com/anatolijlaptev1991-ctrl/hermes-ru/commits)
[![Hermes](https://img.shields.io/badge/Hermes%20Agent-v0.18.2+-6366f1?style=flat-square)](https://github.com/nousresearch/hermes-agent)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078d4?style=flat-square)](https://github.com/anatolijlaptev1991-ctrl/hermes-ru)
[![Status](https://img.shields.io/badge/status-beta%20testing-blue?style=flat-square)](https://github.com/anatolijlaptev1991-ctrl/hermes-ru)
[![npm](https://img.shields.io/npm/v/@anatolijlaptev1991/hermes-ru?style=flat-square&label=npm)](https://www.npmjs.com/package/@anatolijlaptev1991/hermes-ru)

</div>

---

## Описание

Полная русская локализация десктопного приложения **[Hermes Agent](https://github.com/nousresearch/hermes-agent)** от Nous Research. Весь интерфейс — меню, настройки, чат, уведомления, инструменты — переведён на русский язык.

Главное отличие от других решений: **перевод не слетает при обновлении Hermes**. Установил один раз — и после каждого `hermes update` интерфейс снова на русском, без ручных действий.

## Сравнение с альтернативами

| | Другие локализации | **hermes-ru (этот пакет)** |
|---|---|---|
| Установка | Скачать архив → распаковать → `install.ps1` → `npm run build` вручную | `npm i -g @anatolijlaptev1991/hermes-ru` → `hermes-ru install` |
| После обновления Hermes | Нужно **заново** запускать установщик и пересобирать | **Автоматически** восстанавливается: launcher проверяет и применяет перевод при каждом запуске |
| Требования | Node.js, npm, git, исходники Hermes (для пересборки) | Node.js 18+, npm, исходники Hermes |
| Откат | Ручное редактирование исходников | `hermes-ru uninstall` |
| Обновление перевода | Скачать новый архив, запустить установщик заново | **Автоматически**: launcher сам скачивает новую версию с GitHub |
| Метод | Зависит от реализации | **defineLocale** — нативная система i18n Hermes |

## Возможности

- ✅ **Полный перевод интерфейса** — все ключи UI на русском
- ✅ **Self-healing launcher** — не слетает при обновлениях Hermes
- ✅ **Авто-обновление** — launcher проверяет npm и обновляет себя сам
- ✅ **Алиасы языка** — `ru`, `ru-ru`, `ru_ru` — любой вариант работает
- ✅ **Один пакет** — `npm install -g @anatolijlaptev1991/hermes-ru`, без клонирования репо
- ✅ **Исходники включены** — `src/i18n/ru.ts` для доработки перевода
- ✅ **Лёгкий откат** — `hermes-ru uninstall` возвращает английский

## Быстрый старт

### Через npm (рекомендуется)

```bash
npm install -g @anatolijlaptev1991/hermes-ru
hermes-ru install
```

Затем запускайте Hermes через ярлык **«Hermes RU»** в меню Пуск.

### Без npm (из релиза)

1. Скачайте `hermes-ru-dist-v0.21.0.zip` на странице [Releases](../../releases)
2. Распакуйте в папку
3. Откройте терминал в папке и выполните:

```bash
npm install
node bin/cli.js install
```

## Команды

| Команда | Описание |
|---------|----------|
| `hermes-ru install` | Установить русскую локализацию |
| `hermes-ru status` | Показать статус (установлено / слетело после обновления) |
| `hermes-ru repair` | Принудительно перепатчить (если что-то пошло не так) |
| `hermes-ru uninstall` | Вернуть оригинальный английский интерфейс |

## Как это работает

1. `hermes-ru install` копирует `ru.ts` в `src/i18n/` и патчит `types.ts`, `catalog.ts`, `languages.ts` (регистрирует локаль `ru` в нативной системе i18n Hermes). Запуск `npm run build` и установка языка выполняются **launcher**'ом, когда Hermes закрыт.
2. Перевод копируется в `~/.hermes/russian-loc/` — переживает обновления Hermes.
3. В меню Пуск создаётся ярлык **«Hermes RU»**.
4. При каждом запуске через ярлык **launcher**:
   - проверяет целостность перевода и восстанавливает, если Hermes обновился;
   - сравнивает локальную версию с `npm view` и автоматически обновляется при необходимости;
   - автоматически устанавливает язык `ru` в config.yaml;
   - затем запускает Hermes.

> 💡 **Важно:** запускайте Hermes через ярлык «Hermes RU», а не через обычный ярлык. Обычный запуск тоже покажет русский интерфейс, но после обновления Hermes перевод придётся восстановить вручную (`hermes-ru repair` или через ярлык).

## Требования

- **Windows 10 / 11**
- **[Node.js](https://nodejs.org)** 18+ и npm (для сборки)
- **Hermes Agent Desktop** установлен из **исходников** (`git clone` + `npm install`, а НЕ `.exe` установщик)

## Решение проблем

### Hermes не запускается после установки

Перевод использует `defineLocale` + `npm run build` — это нативная система i18n Hermes, поэтому файлы не повреждаются. Но если сборка упала:

```bash
hermes-ru uninstall   # обратный патч исходников + пересборка
```

Если и после этого не работает — переустановите Hermes из исходников.

### Перевод слетел после обновления Hermes

Откройте Hermes через ярлык **«Hermes RU»** — launcher сам восстановит перевод. Или выполните `hermes-ru repair`.

### Команда `hermes-ru` не найдена

Убедитесь, что npm global bin в PATH:

```bash
npm bin -g   # покажет путь
# добавьте его в PATH или используйте:
npx hermes-ru status
```

## Обновление перевода

Новые версии Hermes выходят регулярно. Когда выйдет совместимая версия `hermes-ru` — просто переустановите пакет:

```bash
npm install -g @anatolijlaptev1991/hermes-ru
hermes-ru install
```

Исходники перевода (`src/i18n/ru.ts`) открыты для доработки. Pull requests приветствуются!

## Структура репозитория

```
hermes-ru/
├── src/i18n/          # Исходный код локализации (ru.ts + патчи)
├── bin/               # CLI и patcher
├── launcher/          # Self-healing launcher
└── compat.json        # Карта совместимости версий
```

## Совместимость

| Hermes | hermes-ru |
|--------|-----------|
| 0.17.0 – 0.18.2+ | 0.21.0 |

## Лицензия

MIT — делайте что хотите, ссылка на автора приветствуется.

---

## История разработки

`hermes-ru` начался не с красивого релиза, а с серии белых экранов. Каждый из них показал, где подход был неверным.

1. **v0.17.0:** замена `app.asar.unpacked/dist/` целиком ломала Hermes после обновлений из-за несовместимого `electron-main.mjs`.
2. **v0.17.5:** regex-правка минифицированного бандла нарушила JS-синтаксис. Вместо интерфейса появился белый экран.
3. **v0.18.0:** переход на `defineLocale + npm run build` сделал локализацию нативной, но сборка во время работы Hermes роняла Vite watcher.
4. **v0.19.x:** каталог, автообновление и очистка прошли повторные аудиты; размер пакета упал с 38 МБ до 271 КБ.
5. **v0.20.0:** переломный момент. `install/repair/uninstall` готовят только `pending-build.json`, а launcher патчит и собирает перевод, когда Hermes закрыт.
6. **v0.20.4–v0.21.0:** preflight для `electron.exe` устранил скрытую причину белого экрана; launcher сам загружает Electron, включает `language: ru` и обновляет себя.
7. **7 раундов аудита:** 28+ аудиторов нашли 65 дефектов; 54 уже исправлены.

**Итог:** E2E подтверждён — Hermes запускается по-русски, а перевод автоматически восстанавливается после обновлений.

---

## Поддержать проект

Если `hermes-ru` сэкономил вам время — можно отблагодарить переводом на карту. Это не обязательно, но приятно 💙

| Банк | Номер карты |
|------|-------------|
| СБЕР | 2202 2069 5314 1814 |
| Т-Банк | 2200 7001 6638 4775 |

---

⭐ Если пакет помог — поставьте звезду на GitHub, это помогает другим найти русскую локализацию!
