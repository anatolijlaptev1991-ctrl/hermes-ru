<div align="center">

# 🇷🇺 Hermes Agent — Русская локализация

**Полный перевод интерфейса Hermes Agent Desktop на русский. Ставится одной командой, не слетает при обновлениях.**

[![License](https://img.shields.io/github/license/anatolijlaptev1991-ctrl/hermes-ru?style=flat-square)](LICENSE)
[![Stars](https://img.shields.io/github/stars/anatolijlaptev1991-ctrl/hermes-ru?style=flat-square)](https://github.com/anatolijlaptev1991-ctrl/hermes-ru/stargazers)
[![Last Commit](https://img.shields.io/github/last-commit/anatolijlaptev1991-ctrl/hermes-ru?style=flat-square)](https://github.com/anatolijlaptev1991-ctrl/hermes-ru/commits)
[![Hermes](https://img.shields.io/badge/Hermes%20Agent-v0.17.0-6366f1?style=flat-square)](https://github.com/nousresearch/hermes-agent)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078d4?style=flat-square)](https://github.com/anatolijlaptev1991-ctrl/hermes-ru)
[![npm](https://img.shields.io/badge/npm-hermes--ru-cb3837?style=flat-square)](https://www.npmjs.com/package/hermes-ru)

</div>

---

## Описание

Полная русская локализация десктопного приложения **[Hermes Agent](https://github.com/nousresearch/hermes-agent)** от Nous Research. Весь интерфейс — меню, настройки, чат, уведомления, инструменты — переведён на русский язык.

Главное отличие от других решений: **перевод не слетает при обновлении Hermes**. Установил один раз — и после каждого `hermes update` интерфейс снова на русском, без ручных действий.

## Почему это лучше, чем «просто скопировать ru.ts»

| | Другие локализации | **hermes-ru (этот пакет)** |
|---|---|---|
| Установка | `git clone` + `install.ps1` + `npm run build` (10+ мин, нужен Node dev-окружение) | `npm i -g hermes-ru && hermes-ru install` (1 команда) |
| После обновления Hermes | Нужно **заново** запускать установщик | **Автоматически** восстанавливается через launcher |
| Требования | Node.js, npm, исходники Hermes | Только Node.js 18+ |
| Откат | Ручное редактирование исходников | `hermes-ru uninstall` в один клик |

## Возможности

- ✅ **Полный перевод интерфейса** — все ключи UI на русском
- ✅ **Self-healing launcher** — не слетает при обновлениях Hermes
- ✅ **Алиасы языка** — `ru`, `ru-ru`, `ru_ru` — любой вариант работает
- ✅ **Один пакет** — `npm install -g hermes-ru`, без клонирования репо
- ✅ **Исходники включены** — `src/i18n/ru.ts` для доработки перевода
- ✅ **Лёгкий откат** — `hermes-ru uninstall` возвращает английский

## Быстрый старт

### Через npm (рекомендуется)

```bash
npm install -g hermes-ru
hermes-ru install
```

Затем запускайте Hermes через ярлык **«Hermes (Русский)»** в меню Пуск.

### Без npm (из релиза)

1. Скачайте `hermes-ru-dist-v0.17.0.zip` на странице [Releases](../../releases)
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

1. `hermes-ru install` находит `Hermes.exe`, распаковывает `app.asar`, заменяет `dist/` на версию с русским переводом и запаковывает обратно.
2. Перевод копируется в `~/.hermes/russian-loc/` — переживает обновления Hermes.
3. В меню Пуск создаётся ярлык **«Hermes (Русский)»**.
4. При каждом запуске через ярлык **launcher проверяет целостность перевода**. Если Hermes обновился и перезаписал `app.asar` — launcher автоматически перепатчивает его и только потом запускает Hermes.

> 💡 **Важно:** запускайте Hermes через ярлык «Hermes (Русский)», а не через обычный ярлык. Обычный запуск тоже покажет русский интерфейс, но после обновления Hermes перевод придётся восстановить вручную (`hermes-ru repair` или через ярлык).

## Требования

- **Windows 10 / 11**
- **[Node.js](https://nodejs.org)** 18+ (для запуска launcher и asar-патча)
- **Hermes Agent Desktop** (любая версия, совместимая с v0.17.0)

## Решение проблем

### Hermes не запускается после установки

Крайне маловероятно (мы не трогаем исходники, только `dist/`), но если что-то пошло не так:

```bash
hermes-ru uninstall   # вернуть оригинал
hermes-ru install     # попробовать снова
```

Если и после этого не работает — переустановите Hermes поверх текущей установки (данные сохранятся: конфиги, сессии, навыки, память).

### Перевод слетел после обновления Hermes

Откройте Hermes через ярлык **«Hermes (Русский)»** — launcher сам восстановит перевод. Или выполните `hermes-ru repair`.

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
npm install -g hermes-ru
hermes-ru install
```

Исходники перевода (`src/i18n/ru.ts`) открыты для доработки. Pull requests приветствуются!

## Структура репозитория

```
hermes-ru/
├── dist/              # Предсобранный перевод (готовый к установке)
├── src/i18n/          # Исходный код локализации (ru.ts + патчи)
├── bin/               # CLI и patcher
├── launcher/          # Self-healing launcher
└── compat.json        # Карта совместимости версий
```

## Совместимость

| Hermes | hermes-ru |
|--------|-----------|
| 0.17.0 | 0.17.0    |

## Лицензия

MIT — делайте что хотите, ссылка на автора приветствуется.

---

⭐ Если пакет помог — поставьте звезду на GitHub, это помогает другим найти русскую локализацию!
