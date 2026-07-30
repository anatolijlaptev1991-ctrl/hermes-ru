<div align="center">

# 🇷🇺 Hermes Agent — Russian Localization

**Full Russian translation for Hermes Agent Desktop (by Nous Research). Works within Hermes' native update cycle — no launchers, no separate shortcuts.**

[![License](https://img.shields.io/github/license/anatolijlaptev1991-ctrl/hermes-ru?style=flat-square)](LICENSE)
[![Stars](https://img.shields.io/github/stars/anatolijlaptev1991-ctrl/hermes-ru?style=flat-square)](https://github.com/anatolijlaptev1991-ctrl/hermes-ru/stargazers)
[![npm](https://img.shields.io/npm/v/@anatolijlaptev1991/hermes-ru?style=flat-square&label=npm)](https://www.npmjs.com/package/@anatolijlaptev1991/hermes-ru)
[![Hermes](https://img.shields.io/badge/Hermes%20Agent-v0.19.0-6366f1?style=flat-square)](https://github.com/nousresearch/hermes-agent)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078d4?style=flat-square)](https://github.com/anatolijlaptev1991-ctrl/hermes-ru)

**[Русская версия](README.ru.md)** · **English**

</div>

---

## Overview

Complete Russian localization of **[Hermes Agent](https://github.com/nousresearch/hermes-agent)** Desktop app by Nous Research: menus, settings, chat, notifications, tools — **2,755 keys, 100% coverage** (verified by contract test and TypeScript compiler on every build).

### Co-authors

This translation merges two independent community contributions:

| Co-author | Contribution |
|-----------|-------------|
| **[DrMaks22](https://github.com/DrMaks22)** ([PR #72250](https://github.com/NousResearch/hermes-agent/pull/72250)) | Native-reviewed catalog — translation base |
| **[anatolijlaptev1991-ctrl](https://github.com/anatolijlaptev1991-ctrl)** ([PR #71573](https://github.com/NousResearch/hermes-agent/pull/71573)) | Additional keys, ё-fidelity, i18n-wiring, hermes-ru package |

Both authors are native Russian speakers. The merge takes the best variant from each source.

## Quick Start

```bash
npm install -g @anatolijlaptev1991/hermes-ru
hermes-ru install
```

Launch Hermes **as usual** — your regular shortcut, `hermes desktop`, anything. No separate "Hermes RU" shortcuts needed.

- **If Hermes is closed** — `install` triggers the official rebuild automatically, and the next launch will be Russian.
- **If Hermes is running** — the patch and language apply immediately, but **rebuild won't happen automatically**. Close Hermes completely (via the X button), open a terminal (cmd/PowerShell), and run:

  ```bash
  hermes desktop --force-build
  ```

  This rebuilds the app (2–10 min) and launches it.

> ⚠️ **Important:** simply restarting the app (close → reopen `.exe`) **does NOT trigger a rebuild**. The content-hash stamp is only checked when launching via `hermes desktop` in a terminal. Launching `.exe` directly always loads the last build.

## How It Works (Native Update Cycle Architecture, v1.0+)

Hermes has no runtime API for adding core languages: the locale catalog is static and baked at build time, and the desktop plugin i18n only covers plugin UI ("never edit core en.ts"). So the locale is added via a source patch — but **integrated into Hermes' own mechanisms**, not via parallel infrastructure:

1. **Patch as ordinary edits.** `patch-engine` registers the `ru` locale across 4 i18n files using structural anchors (work on any combination of upstream locales, not hardcoded). These are standard uncommitted changes in the git tree.
2. **Hermes updates carry the patch natively.** The updater (`updates.non_interactive_local_changes: stash` — default) stashes local changes on `hermes update`, pulls, and auto-restores them. On conflict → graceful English fallback (never a blank screen); `hermes-ru repair` re-patches in one command.
3. **Rebuild by Hermes itself.** Hermes hashes all of `apps/desktop`; our patch changes the hash → native rebuild on `hermes desktop` / `hermes update`.
4. **Language via the official path.** `display.language: ru` is set via `hermes config set`, no manual `config.yaml` editing.

## Safety & Rollback

- **Zero silent no-ops:** if an anchor doesn't match (unknown future Hermes version), the patch **aborts entirely** — the app never ends up half-patched.
- **Transactional:** snapshot (bytes + SHA256 manifest) → patch in memory → verify → write → verify on disk. Any failure = automatic rollback.
- **One-command rollback:** `hermes-ru uninstall`.

## Commands

| Command | Description |
|---------|-------------|
| `hermes-ru install` | Install locale (patch + language + rebuild if Hermes is closed) |
| `hermes-ru install --no-build` | Patch + language only (rebuild later) |
| `hermes-ru build` | Rebuild app (only when Hermes is closed) |
| `hermes-ru status` | Status + what to do next in one line |
| `hermes-ru repair` | Re-patch (after Hermes update / failure) |
| `hermes-ru uninstall` | Restore English interface |
| `hermes-ru doctor` | Diagnostics: paths, toolchain, anchors (dry-run) |
| `hermes-ru log-on` / `log-off` | Logging to `<HERMES_HOME>/russian-loc/hermes-ru.log` |

## Upstream Path

The `ru` locale is heading into the main Hermes repository via two PRs:
- **[#74691](https://github.com/NousResearch/hermes-agent/pull/74691)** — i18n-wiring for hardcoded surfaces (MoA, Billing, Custom Endpoints). Locale-neutral, no competitors.
- **[#72250](https://github.com/NousResearch/hermes-agent/pull/72250)** — consolidated Russian catalog (DrMaks22).

When the PRs merge — this package becomes unnecessary. That's the goal.

## Requirements

- **Windows 10 / 11**
- **[Node.js](https://nodejs.org)** 18+ and npm
- **Hermes Agent Desktop**, installed from **source** (`git clone` installer, not a prebuilt `.exe`)

## Compatibility

| Hermes | hermes-ru |
|--------|-----------|
| 0.19.0 | **1.2.1** (structural anchors + merged translation) |
| 0.19.0 | 1.0.0–1.1.5 (structural anchors) |
| 0.17.0 – 0.18.2 | 0.22.x (legacy, launcher architecture) |

## License

MIT — do whatever you want, a link to the author is appreciated.

---

⭐ If this package helped — star it on GitHub, it helps others find the Russian localization!

## Support

If `hermes-ru` saved you time — you can buy me a coffee:

| Bank | Card number |
|------|-------------|
| SBER | 2202 2069 5314 1814 |
| T-Bank | 2200 7001 6638 4775 |
