# dsh-desktop-electron

English | [中文](README.zh.md)

An Electron desktop shell for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) Web GUI: it spawns `dsh web`, waits for the server's readiness line, and hosts the GUI in a standalone window with tray residency.

The shell targets the public [`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh) package. It relies only on the maintained `dsh web --host <host> --port <port> --no-open` arguments and the `dsh web: <URL>` readiness line.

> This repository is an independently maintained DSH desktop-shell project. It carries **no harness source code**; the backend is provided by a `dsh` installation on the host.

## Why a shell

The Web GUI is the harness's richest surface but normally lives in a browser tab: no taskbar presence, no tray, and every launch means opening a terminal and keeping the tab alive. This shell makes it a real desktop window.

It is a **shell only**. It bundles no Node runtime and no harness closure — it runs whatever `dsh web` your machine already provides, so it stays correct across harness upgrades instead of pinning a snapshot.

## Features

### Startup splash

An animated splash appears the moment the app boots — a breathing logo and a typing wordmark:

- The whale, centered on a flat monochrome surface, breathing on a 2.8s cycle (scale 1 → 1.05, opacity 0.7 → 1). Beneath it, the wordmark `DEEPSEEK HARNESS` types in character by character as the progress readout — a constant, never-stalling rhythm (fake progress by design); once fully revealed, a DeepSeek-blue block cursor keeps blinking so the load always reads as ongoing. No progress-bar widgets, no status line, no spinner, no rings, no gradients, no glow.
- The palette follows the system and the main program's (dsh GUI) theme, read from its `settings.yaml`: near-white paper with a black glyph in light mode, near-black graphite with a white glyph in dark. The blinking cursor is the page's only accent, in the harness brand blue.
- The GUI loads hidden behind the splash, and the animation ends exactly when the main interface is rendered — dsh's own loading spinner is never visible.
- A standalone, offline browser preview lives at [preview/splash-preview.html](preview/splash-preview.html): open it directly (no app launch, no assets needed) to watch the breathing logo and the hand-off to the main window.

### Inverted title bar

Codex-style with the layering flipped: the window has **no native title bar** — the shell draws a real title-bar strip across the top, and the GUI's own elements are what intrude into it, never the other way around.

- On Windows (Linux follows the same scheme) the strip spans the whole top edge: a draggable band, hairline-ruled with the GUI's own border token, holding the Window Controls Overlay. The page proper — conversation header, composer, right panel — starts *below* the strip, so the close button never floats over page content and no surface needs a clearance carved out of it.
- The **left sidebar covers the strip**: it stays a full-height column whose brand row remains draggable chrome, so the program reads as one continuous surface with the sidebar piercing the title bar.
- On macOS the traffic lights sit inset over the sidebar's top-left (its brand row keeps a leading clearance) and the conversation header remains the drag chrome.
- The controls' palette follows the GUI's live theme — dark surfaces get white glyphs, light ones black — synced from the theme color the GUI's own theme presenter publishes, with no preload and no IPC channel.

### Window and renderer security

- Sandboxed renderer (`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, no preload) — the GUI is a normal web application.
- Anything that opens a new window or navigates off the server origin goes to the system browser, restricted to `http(s)`; unparsable targets are dropped.
- The server always listens on `127.0.0.1` with an OS-assigned port (`--port 0`), so it can never collide with an existing `dsh web`.
- The server is spawned with `--no-open`, so `dsh web` never launches its own browser tab — the shell's window is the only GUI, and a browser instance can still run side by side.

### Tray residency

- Closing the window only hides it; the server keeps running. Only **Quit** terminates the server.
- The tray menu is Codex-style: **New Topic**, the topics whose agent is currently **running**, and the most recent **topics** — each entry jumps straight into that conversation (via the server's own session-list RPC; sidebar row clicks are best-effort). Archived topics are dropped: the feed also reads the workspace's archived set (the baseline of the server's `workspace/follow` stream), and if that fetch fails the last known set stays in force, so a blip never resurrects archived topics.
- Menu and tooltip follow dsh's `locale.preference` setting (zh/en, system language otherwise).
- The tray icon always contrasts its surface — light glyph on a dark taskbar/menu bar, dark on a light one. On Windows it reads the taskbar's *system* mode (`SystemUsesLightTheme`), not the apps mode `nativeTheme` reports, so the common "dark taskbar + light apps" setup still gets a readable glyph.

### Lifecycle

- **Single instance** — a second launch focuses the existing window instead of starting a second server.
- **No orphans** — quit tree-kills the server; a reaper child also tree-kills it if the main process is ever hard-killed.
- **Platforms** — Windows, macOS, Linux; pure Node/npm toolchain, no Rust/Go/Swift.

## Requirements

A working `dsh web`, resolved in this order:

1. **`DSH_BIN`** — an explicit path to a `dsh` executable;
2. **`DSH_HOME`** — a harness checkout root (`~/.dsh/source/current` for an `install.sh` install). Its built `apps/cli/lib/bin.js` is preferred; otherwise the tsx source launch is used, exactly as the checkout's own `pnpm run dsh` does;
3. **`dsh` on `PATH`**.

On Windows, the spawn boundary automatically resolves npm command shims reached through either `DSH_BIN` or `PATH`, including `.cmd` files. Arguments remain a separate vector: the shell does not enable a general command shell and does not require users to locate the package's JavaScript entry point.

## Getting started

### Run from source

```sh
npm install
DSH_HOME=~/.dsh/source/current npm run dev
```

### Package

```sh
npm run dist        # installers under release/
npm run dist:dir    # unpacked dir only, for a quick smoke
```

Installers are unsigned, so Windows SmartScreen and macOS Gatekeeper will warn on first run. The packaged app still needs a `dsh` on the host — see [Requirements](#requirements).

## Behavior notes

- **Windows permission mode.** Windows has no harness confinement backend, so the CLI's default `workspace-write` mode cannot boot there. When `DSH_PERMISSION_MODE` is unset the shell falls back to `danger-full-access` (approval prompts disabled) and logs a warning. Set `DSH_PERMISSION_MODE` explicitly to override.
- **Tree termination.** On Windows the kill is `taskkill /T /F`, because `child.kill()` is `TerminateProcess` of the direct child only. On POSIX the server is spawned detached and the whole process group is signalled, SIGTERM then SIGKILL after a grace period. The server does not run a graceful-dispose path; session data is written per event to JSONL, so a killed server loses nothing already logged.
- **Workspace semantics** are the CLI's: the invoking directory is the default project root. Launching from a desktop shortcut starts in the shell's cwd, so prefer opening the app from a project directory or picking the Workspace in the GUI.
- **Logs.** The server's stdout is forwarded with a `[dsh web]` prefix; run the app from a terminal to see both streams.

## Tests

```sh
npm test                        # 127 keyless cases: command resolution/spawn, readiness parsing, HTTP polling, process-tree termination, splash timeline, session feed, title bar fusion
npm run test:electron:windows   # built Electron lifecycle through a Windows npm .cmd shim
npm run typecheck
npm run dist:dir                # unpacked app plus packaged production-closure verification
```

## Credits

The shell, the launcher, and the process-tree primitive were developed in a harness fork and contributed upstream; this repository is the standalone extraction. Related standalone shells: [dsh-desktop](https://github.com/dsh-external/dsh-desktop) (Go/Wails, Windows), [dsh-desktop-mac](https://github.com/dsh-external/dsh-desktop-mac) (Swift/WKWebView), [deepseek-harness-desktop](https://github.com/omdsh-dev/deepseek-harness-desktop) (Wails + Node SEA).

The startup animation's breathing-logo idiom is inspired by [OpenAI Codex](https://github.com/openai/codex)'s CLI presentation (Apache-2.0); the splash view plumbing began from the [dsh-splash-launcher](https://github.com/Isilsolme/dsh-splash-launcher) template (MIT). The whale glyph (`whale.png`) derives from the DeepSeek Harness web frontend assets (MIT, © 2026 DeepSeek); the DeepSeek name and whale logo are trademarks of their respective owner.

## License

[MIT](LICENSE), matching the harness.
