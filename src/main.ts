/**
 * dsh-desktop Electron main: single-instance lock, spawn `dsh web` via the
 * launcher, wait for readiness, host the GUI in a standalone window, and keep
 * the server alive in the tray after the window closes. Closing the window
 * hides it (tray residency); quitting via the tray menu terminates the server
 * child and exits.
 *
 * The tray menu is Codex-style: beyond Open Window and Quit it lists the
 * topics whose agent is currently running and the most recent ones (polled
 * from the server's own session-list RPC, see `sessions.ts`), plus a New
 * Topic shortcut — each jumping straight into that conversation.
 *
 * The window itself is Codex-style too (`titlebar.ts`): no native title bar —
 * the GUI's own top strip (sidebar brand row, conversation header) becomes
 * the draggable chrome via injected CSS, and the OS window controls are
 * drawn as an overlay whose palette follows the GUI's live theme.
 *
 * Startup is two-layered in one window (`splash.ts`): the window appears
 * immediately with the animated splash on a `WebContentsView` layered above
 * the window's own webContents. The real GUI then loads behind the splash,
 * hidden; once the GUI's main interface has actually rendered (boot card gone)
 * and the splash's minimum play time has elapsed, the splash fades out and
 * the view is removed — so the user never sees dsh's own loading spinner and
 * the animation ends exactly at the main UI, one continuous window from
 * launch to use.
 */

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { killProcessTree } from './process-tree.ts'
import { app, BrowserWindow, dialog, Menu, nativeImage, nativeTheme, session, shell, Tray, WebContentsView } from './electron-api.ts'
import type { MenuItemConstructorOptions } from 'electron'
import { authCookieRemovals } from './auth-cookies.ts'
import { resolveWebLaunch, spawnWebLaunch, waitForHttpOk, waitForReadyLine, childExited } from './launcher.ts'
import { attachSplash, exitSplash, splashPageUrl, SPLASH_BG_DARK, SPLASH_BG_LIGHT, SPLASH_FINALE_MS, SPLASH_MIN_MS, updateSplashTheme } from './splash.ts'
import { SessionFeed } from './sessions.ts'
import type { SessionSummary } from './sessions.ts'
import { resolveTrayLanguage, trayMenuTemplate, trayTooltip } from './tray-menu.ts'
import { queryWindowsSystemUsesLightTheme, traySurfaceIsDark } from './system-theme.ts'
import { TITLEBAR_GESTURE_PROBE_DELAYS_MS, TITLEBAR_STATE_PROBE, compositedSurfaceColor, overlayPaletteForSurface, titlebarFusionCss, windowChromeOptions } from './titlebar.ts'
import type { TrayLang } from './tray-menu.ts'
const APP_ID = 'ai.deepseek.dsh-desktop'
const WINDOW_TITLE = 'DeepSeek Harness'
const STDERR_TAIL_LIMIT = 4_000
/**
 * Hard cap on the graceful teardown before the app quits anyway. taskkill and
 * the reaper stop are normally sub-second; a wedged dispatch must not leave the
 * user stuck at a tray Quit that never lands. On timeout the reaper is
 * deliberately left running (its stop never ran): the main dies, and a dead
 * main is exactly the condition the reaper tree-kills the server on — so
 * quitting after the timeout still guarantees cleanup, just via the backup.
 */
const QUIT_TEARDOWN_TIMEOUT_MS = 10_000
/** Hard cap on waiting for the GUI's main interface before revealing it anyway. */
const GUI_READY_PROBE_MS = 20_000
/** Poll cadence for the GUI readiness probe. */
const GUI_READY_POLL_MS = 150
/** Poll cadence for the tray's session (topic) feed. */
const SESSION_POLL_MS = 10_000
/** Poll cadence for the title bar overlay's surface sync (theme + modal scrim). */
const TITLEBAR_SYNC_POLL_MS = 1_500
/** dsh's UI theme preference: 'dark' | 'light' | 'system'. */
type ThemePreference = 'dark' | 'light' | 'system'
/**
 * Read dsh's UI theme preference from its settings.yaml (`ui-theme.preference`),
 * so the splash can match the main program's appearance from the very first
 * frame — not just the OS theme. Best-effort: an unreadable/missing setting or
 * an unexpected value returns undefined and the splash follows the system
 * scheme instead (which is exactly what `preference: system` means).
 */
function resolveThemePreference(): ThemePreference | undefined {
  const text = dshSettingsText()
  if (text === undefined) return undefined
  const marker = text.indexOf('ui-theme:')
  if (marker === -1) return undefined
  const block = text.slice(marker).split(/\n(?=\S)/)[0] ?? ''
  const match = /preference\s*:\s*"?([a-z]+)"?/i.exec(block)
  const value = match?.[1]?.toLowerCase()
  if (value === 'dark' || value === 'light' || value === 'system') return value
  return undefined
}
/** Cached once at startup; dsh's theme preference (undefined = follow system). */
const THEME_PREFERENCE = resolveThemePreference()

/**
 * The raw text of dsh's settings.yaml (the same document the splash theme and
 * the tray language read), or undefined when it cannot be read — the tray
 * language then falls back to the system locale.
 */
function dshSettingsText(): string | undefined {
  try {
    const dshHome = process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== ''
      ? process.env.DSH_HOME
      : join(homedir(), '.dsh')
    return readFileSync(join(dshHome, 'settings.yaml'), 'utf8')
  } catch {
    return undefined
  }
}
/**
 * Probe the GUI document for the main interface, mirroring the readiness test
 * the dsh frontend itself uses in its own `splash.html`: the `#root` element
 * must exist, the boot card (`[class*="_boot_"]`, the white card with the
 * spinner) must be gone, and either a failed state or real content is shown.
 * Also reports the body background (so the window can pre-paint the exact
 * surface behind the fading splash) and the effective theme, derived from
 * the body background luminance with a `prefers-color-scheme` fallback —
 * so the splash can match the GUI's actual light/dark rendering regardless
 * of dsh's internal theme mechanism. Returns `{ ready, bg?, theme? }`.
 */
const GUI_READY_PROBE = `(() => {
  const root = document.getElementById('root');
  if (!root) return { ready: false };
  if (root.querySelector('[class*="_boot_"]')) return { ready: false };
  const failed = root.querySelector('[class*="_failed_"]');
  if (failed || root.childElementCount > 0) {
    const bg = getComputedStyle(document.body).backgroundColor;
    const m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(bg);
    let theme;
    if (m) {
      const lum = 0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3];
      theme = lum >= 128 ? 'light' : 'dark';
    } else {
      theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return { ready: true, bg, theme };
  }
  return { ready: false };
})()`
/**
 * The repository root in dev, the asar root when packaged. Resolved from
 * `app.getAppPath()` rather than derived from `import.meta.url`: the built
 * entry lives at `lib/main.js`, so a dirname walk would land on `lib` —
 * breaking the packaged icon paths and the dev runDir. `getAppPath()` is the
 * app root Electron itself resolves (`electron .` in dev; the asar root when
 * packaged) and is safe to call at module scope.
 */
const PACKAGE_DIR = app.getAppPath()

let mainWindow: BrowserWindow | undefined
/** The splash `WebContentsView` layered above the window while booting. */
let splashView: WebContentsView | undefined
/** Timestamp of splash creation, for the minimum play time. */
let splashStartedAt = 0
let tray: Tray | undefined
let server: ChildProcess | undefined
let reaper: ChildProcess | undefined
let serverUrl: URL | undefined
let quitting = false
// Set by the first fatal() so one root cause cannot show duplicate modal
// dialogs or dispatch process-tree teardown twice.
let failing = false
// A focus request (second launch, tray click) that arrived while the server
// was still booting and no window existed yet; honored once boot completes.
let pendingFocus = false
/** Session feed for the tray menu, alive once the server is ready. */
let sessionFeed: SessionFeed | undefined
/** Last known session summaries; kept across poll failures so a blip never empties the menu. */
let sessionSummaries: SessionSummary[] = []
/** The poll timer; cleared on quit. */
let sessionPollTimer: NodeJS.Timeout | undefined
/** Last reported feed state, so poll errors log once per transition, not every cadence. */
let sessionFeedError: string | undefined
/** Tray menu language, resolved once at boot (dsh preference, else system). */
let trayLang: TrayLang = 'en'
/** Poll timer keeping the title bar overlay palette in sync with the GUI theme. */
let titlebarSyncTimer: NodeJS.Timeout | undefined
/** Last effective surface color applied to the overlay (scrim-composited when a modal is open). */
let titlebarSurface: string | undefined

function iconPath(): string {
  return join(PACKAGE_DIR, 'build', 'icon.png')
}

function trayIconPath(): string {
  return join(PACKAGE_DIR, 'build', 'tray-icon.png')
}

/**
 * The tray glyph is always the opposite color of the surface it sits on — a
 * light glyph on the dark taskbar/menu bar, a dark one on a light surface —
 * for readability. Which surface that is differs per platform (see
 * `system-theme.ts`): the Windows taskbar follows the *system* mode, not the
 * app mode `nativeTheme.shouldUseDarkColors` reports, so the surface reading
 * is refreshed from the registry and applied once resolved.
 */
let traySurfaceDark: boolean | undefined

function trayIconImage(): Electron.NativeImage {
  const darkSurface = traySurfaceDark ?? nativeTheme.shouldUseDarkColors
  const preferred = nativeImage.createFromPath(darkSurface ? trayIconPath() : iconPath())
  if (!preferred.isEmpty()) return preferred.resize({ width: 16, height: 16 })
  // The preferred variant is missing (partial asset set): the opposite fill
  // beats an empty tray icon.
  const fallback = nativeImage.createFromPath(darkSurface ? iconPath() : trayIconPath())
  return fallback.isEmpty() ? nativeImage.createEmpty() : fallback.resize({ width: 16, height: 16 })
}

/**
 * Re-read the tray surface theme and swap the glyph when it changed. On
 * Windows this is an async registry read (the taskbar's system mode); on
 * macOS/Linux it is the synchronous app-mode reading.
 */
function refreshTraySurface(): void {
  if (process.platform !== 'win32') {
    applyTraySurface(nativeTheme.shouldUseDarkColors)
    return
  }
  void queryWindowsSystemUsesLightTheme().then((systemUsesLightTheme) => {
    if (systemUsesLightTheme === undefined) return
    applyTraySurface(traySurfaceIsDark(systemUsesLightTheme, nativeTheme.shouldUseDarkColors))
  }).catch(() => {})
}

function applyTraySurface(dark: boolean): void {
  if (traySurfaceDark === dark) return
  traySurfaceDark = dark
  if (tray === undefined || quitting) return
  try { tray.setImage(trayIconImage()) } catch { /* the tray may be gone mid-flip */ }
}

/**
 * Terminate the server child and its tree. The platform-specific logic lives
 * in `process-tree.ts` — Windows: taskkill /T, because
 * `child.kill()` is `TerminateProcess` of the direct child only; POSIX:
 * SIGTERM against the server's detached process group (a negated pid reaches
 * the whole tree), escalated to SIGKILL after a five-second grace. This
 * wrapper only owns the desktop log prefix, preserving the historical message
 * format.
 * @param pid - the process to terminate.
 */
function killTree(pid: number): Promise<void> {
  return killProcessTree(pid, {
    logger: (message) => { console.error(`[dsh-desktop] killTree ${message}`) },
  })
}

function showWindow(): void {
  if (mainWindow !== undefined) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    return
  }
  // The window is created at boot together with the splash; this branch only
  // guards a focus request arriving before boot reached createWindow().
  if (serverUrl !== undefined) createWindow()
  else pendingFocus = true
}

/**
 * Open a URL in the system browser — but only http(s) links: the GUI must
 * not be able to launch arbitrary programs via `file://` or a custom
 * protocol, and a navigation target that is not a parseable URL is dropped
 * too. `shell.openExternal` is fire-and-forget; its rejection must not
 * become an unhandled rejection in the Electron main process.
 * @param raw - the raw URL from the web contents.
 */
function openExternal(raw: string): void {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    // new URL(string) throws only SyntaxError for unparsable input; ignore.
    console.warn(`[dsh-desktop] ignoring unparsable external URL: ${raw}`)
    return
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    console.warn(`[dsh-desktop] ignoring non-http(s) external URL: ${raw}`)
    return
  }
  void shell.openExternal(raw).catch((error: unknown) => {
    console.error(`[dsh-desktop] failed to open ${raw}: ${error instanceof Error ? error.message : String(error)}`)
  })
}

/**
 * Create the single Desktop window. The window's own webContents stays blank
 * (it becomes the GUI once the server is ready); the animated splash page
 * plays on a `WebContentsView` layered on top of it, so the window shows the
 * animation from the very first frame and the GUI — including dsh's own boot
 * spinner — loads fully hidden behind it. The window background pre-paints
 * the splash's theme color, so no transition ever flashes white or black.
 */
function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 560,
    title: WINDOW_TITLE,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: splashBackgroundColor(),
    icon: iconPath(),
    // Codex-style title bar fusion (see titlebar.ts): no native title bar —
    // the GUI's own top strip becomes the draggable chrome and the OS window
    // controls are drawn as an overlay on top of the web surface. The initial
    // overlay palette comes from dsh's theme preference so even the controls
    // match before the GUI has rendered; the live palette follows the GUI
    // once ready (installTitlebarFusion).
    ...windowChromeOptions(process.platform, THEME_PREFERENCE, nativeTheme.shouldUseDarkColors),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow = window

  // Splash layer: a WebContentsView above the window's own webContents.
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Keep the animation at full frame rate even under transient occlusion
      // while the window is booting.
      backgroundThrottling: false,
    },
  })
  splashView = view
  splashStartedAt = Date.now()
  // Opaque theme-color view background during boot: nothing white can flash
  // through before the splash page paints. At hand-off the background is
  // switched to transparent (see useReadyServer), so the exit fade reveals
  // the GUI below — a true cross-fade instead of a hard cut.
  view.setBackgroundColor(splashBackgroundColor())
  window.contentView.addChildView(view)
  const syncBounds = (): void => {
    if (window.isDestroyed()) return
    // View bounds are relative to the parent view (the content area origin),
    // while getContentBounds() returns screen coordinates (x/y = window
    // position on screen) — using those would push the splash down-right and
    // leave the top-left blank. Take only the content size and anchor at 0,0.
    const [width = 0, height = 0] = window.getContentSize()
    view.setBounds({ x: 0, y: 0, width, height })
  }
  syncBounds()
  // Keep the splash layer matched to the content area through window state
  // changes (each event is registered explicitly to keep the typed overloads).
  window.on('resize', syncBounds)
  window.on('maximize', syncBounds)
  window.on('unmaximize', syncBounds)
  window.on('enter-full-screen', syncBounds)
  window.on('leave-full-screen', syncBounds)
  attachSplash(view.webContents)
  let shown = false
  const showOnce = (): void => {
    if (shown || window.isDestroyed()) return
    shown = true
    window.show()
  }
  window.once('ready-to-show', showOnce)
  view.webContents.once('did-finish-load', showOnce)
  void view.webContents.loadURL(splashPageUrl(THEME_PREFERENCE === 'dark' ? 'dark' : THEME_PREFERENCE === 'light' ? 'light' : undefined)).catch((error: unknown) => {
    console.error(`[dsh-desktop] splash failed to load: ${error instanceof Error ? error.message : String(error)}`)
  })

  window.on('close', (event) => {
    // Tray residency: closing hides the window and keeps the server running.
    if (quitting) return
    event.preventDefault()
    window.hide()
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
    if (splashView === view) splashView = undefined
  })
  // The GUI is a single-page app; anything that opens a new window or
  // navigates away from the server origin belongs in the system browser.
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    openExternal(target)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, target) => {
    // Before the server is known the page never navigates; once it is, only
    // same-origin targets stay in the window.
    if (serverUrl === undefined) return
    try {
      if (new URL(target).origin === serverUrl.origin) return
    } catch {
      // new URL(string) throws only SyntaxError for unparsable input; such a
      // target is not ours and is rejected below.
    }
    event.preventDefault()
    openExternal(target)
  })
  return window
}

/**
 * The splash window background color matching the current theme, so the
 * splash→GUI navigation gap shows the same surface instead of flashing white
 * or black. Honors dsh's forced UI theme before falling back to the OS theme.
 * The values come from `splash.ts` so the window pre-paint and the splash
 * page itself share one palette — the GUI's first paint never reveals a
 * mismatched color through an unpainted region (an earlier blue-tinted value
 * showed as a uniform dark-blue block in the lower half during the GUI's
 * first paint).
 */
function splashBackgroundColor(): string {
  if (THEME_PREFERENCE === 'dark') return SPLASH_BG_DARK
  if (THEME_PREFERENCE === 'light') return SPLASH_BG_LIGHT
  return nativeTheme.shouldUseDarkColors ? SPLASH_BG_DARK : SPLASH_BG_LIGHT
}

/**
 * Whether a CSS color value resolves to fully transparent. Browsers report
 * the computed `background-color` of an unset body as `rgba(0, 0, 0, 0)`;
 * `transparent` shows up as itself. Treating either as "no color" keeps the
 * splash surface in place until the GUI paints something real.
 */
function isTransparentColor(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'transparent') return true
  const match = /rgba?\(\s*[^,)]+\s*,\s*[^,)]+\s*,\s*[^,)\s]+(?:\s*,\s*([^)]+))?\s*\)/.exec(normalized)
  if (match === null) return false
  const alpha = match[1]?.trim()
  return alpha !== undefined && alpha !== '' && Number.parseFloat(alpha) === 0
}

/**
 * Turn the GUI's top strip into the window chrome (the CSS in `titlebar.ts`)
 * and keep the overlay window controls' palette in sync with the GUI's live
 * theme. The poll re-reads the surface state the GUI publishes (theme-color
 * meta, plus any open modal's dim mask — see TITLEBAR_STATE_PROBE) — the
 * shell stays preload-free, so polling is the change signal. Failures are
 * best-effort: a missed poll just leaves the previous palette in place.
 * @param window - the window hosting the GUI.
 * @param guiSurface - the GUI body background reported by the readiness
 *   probe, applied immediately when available (the poll covers later changes).
 */
function installTitlebarFusion(window: BrowserWindow, guiSurface?: string): void {
  if (guiSurface !== undefined) applyTitlebarSurface(window, guiSurface)
  void window.webContents.insertCSS(titlebarFusionCss(process.platform)).catch((error: unknown) => {
    console.error(`[dsh-desktop] failed to inject title bar CSS: ${error instanceof Error ? error.message : String(error)}`)
  })
  if (titlebarSyncTimer !== undefined) clearInterval(titlebarSyncTimer)
  titlebarSyncTimer = setInterval(() => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
      stopTitlebarSync()
      return
    }
    void pollTitlebarState(window)
  }, TITLEBAR_SYNC_POLL_MS)
  titlebarSyncTimer.unref()
  // Modal open/close are user gestures, and the controls must follow them
  // without waiting for the next poll (a stale-bright or stale-dim strip is
  // exactly the jarring artifact the fusion exists to avoid). Every click and
  // key press schedules two quick probes — the DOM settles a beat after the
  // event — while the slow poll remains the fallback for transitions no
  // gesture produced (e.g. a theme change driven by the system clock).
  window.webContents.on('input-event', (_event, input) => {
    if (input.type !== 'mouseDown' && input.type !== 'keyDown' && input.type !== 'rawKeyDown') return
    for (const delay of TITLEBAR_GESTURE_PROBE_DELAYS_MS) {
      const timer = setTimeout(() => {
        if (!window.isDestroyed() && !window.webContents.isDestroyed()) void pollTitlebarState(window)
      }, delay)
      timer.unref()
    }
  })
}

/**
 * One surface-state probe: read the GUI's published state (theme-color meta,
 * modal dim mask) and re-skin the overlay when the effective color changed.
 */
async function pollTitlebarState(window: BrowserWindow): Promise<void> {
  try {
    const state = await window.webContents.executeJavaScript(TITLEBAR_STATE_PROBE)
    if (state === null || typeof state !== 'object') return
    const { surface, scrim } = state as { surface?: unknown; scrim?: unknown }
    if (typeof surface !== 'string') return
    // While a modal's dim mask is open the controls must read as part of the
    // dimmed page, not as a bright strip floating above it: composite the
    // mask color over the surface before re-skinning the overlay.
    const effective = typeof scrim === 'string' ? compositedSurfaceColor(surface, scrim) ?? surface : surface
    if (effective === titlebarSurface) return
    applyTitlebarSurface(window, effective)
  } catch {
    // Mid-navigation or not yet ready; the next poll re-reads the meta.
  }
}

function stopTitlebarSync(): void {
  if (titlebarSyncTimer !== undefined) {
    clearInterval(titlebarSyncTimer)
    titlebarSyncTimer = undefined
  }
}

/**
 * Apply one GUI surface color to the overlay window controls. Feature-detected
 * and guarded: `setTitleBarOverlay` is Windows/Linux only and can reject on
 * OS builds without the overlay, in which case the default glyphs stay.
 * @param window - the window whose overlay should follow the GUI.
 * @param surface - a CSS color from the theme-color meta or the readiness probe.
 */
function applyTitlebarSurface(window: BrowserWindow, surface: string): void {
  const palette = overlayPaletteForSurface(surface)
  if (palette === undefined) return
  titlebarSurface = surface
  try {
    window.setTitleBarOverlay(palette)
  } catch (error) {
    console.error(`[dsh-desktop] failed to update title bar overlay: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function createTray(): void {
  tray = new Tray(trayIconImage())
  tray.setToolTip(WINDOW_TITLE)
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenu()))
  tray.on('click', showWindow)
  // The initial icon guesses from the app-mode reading; the tray surface
  // reading (Windows: the taskbar's system mode) corrects it once resolved.
  refreshTraySurface()
  // A mid-session theme flip (system day/night switch) re-skins the icon; the
  // native context menu re-labels itself, so only the image needs replacing.
  nativeTheme.on('updated', () => {
    refreshTraySurface()
  })
}

/**
 * Rebuild the tray context menu from the last known session summaries. Called
 * after every successful poll; a failing poll keeps the previous menu, so a
 * server blip never blanks the user's shortcuts.
 */
function rebuildTrayMenu(): void {
  if (tray === undefined || quitting) return
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenu()))
}

/**
 * The tray menu from the last known session summaries; grouping and labeling
 * live in the pure `tray-menu.ts` (tested there), here it is only wired to
 * the Electron actions.
 */
function buildTrayMenu(): MenuItemConstructorOptions[] {
  return trayMenuTemplate(sessionSummaries, {
    openWindow: showWindow,
    newTopic,
    focusSession,
    quit: () => { app.quit() },
  }, Date.now(), trayLang) as MenuItemConstructorOptions[]
}

/**
 * Focus a topic from the tray: show the window, then best-effort click the
 * matching sidebar row in the GUI. The web GUI has no deep-link URL for a
 * session — selection is client state — so the row click is the only way in;
 * when it cannot find the row (sidebar collapsed, title not derived yet) the
 * window still opens and the user picks the topic there.
 */
function focusSession(session: SessionSummary): void {
  showWindow()
  if (session.title === undefined) return
  executeInGui(SELECT_TOPIC_PROBE(session.title), 'select topic')
}

/**
 * New Topic from the tray: show the window and best-effort press the GUI's
 * own "New session" button, so session creation stays owned by the GUI (and
 * the new conversation is selected there). A missed button (localized label,
 * collapsed sidebar) degrades to just opening the window.
 */
function newTopic(): void {
  showWindow()
  executeInGui(NEW_TOPIC_PROBE, 'new topic')
}

/**
 * Run one probe script in the GUI page. Splash/graphical state is not gated:
 * the probes are pure DOM queries that find nothing (and return false) until
 * the GUI has rendered, which is exactly the graceful degradation wanted.
 */
function executeInGui(script: string, what: string): void {
  const contents = mainWindow?.webContents
  if (contents === undefined || contents.isDestroyed()) return
  void contents.executeJavaScript(script).catch((error: unknown) => {
    console.error(`[dsh-desktop] failed to ${what} in the GUI: ${error instanceof Error ? error.message : String(error)}`)
  })
}

/**
 * Click the sidebar session row whose title matches. The GUI's CSS-module
 * class names carry opaque hashes (`YDXeBa_sessionRow`), so the probes match
 * on the stable class-name suffix instead of exact selectors.
 */
function SELECT_TOPIC_PROBE(title: string): string {
  return `(() => {
  const needle = ${JSON.stringify(title)};
  for (const row of document.querySelectorAll('[class*="sessionRow"]')) {
    const label = row.querySelector('[class*="title"]');
    if ((label?.textContent ?? '').trim() === needle) { row.click(); return true; }
  }
  return false;
})()`
}

/** Press the sidebar's "New session" button (aria-label, then class suffix). */
const NEW_TOPIC_PROBE = `(() => {
  const button = document.querySelector('[aria-label="New session"], [aria-label="New Session"]')
    ?? document.querySelector('[class*="newSession"]');
  if (button === null) return false;
  button.click();
  return true;
})()`

/**
 * Start polling the server's session list for the tray menu. The first fetch
 * runs immediately (the menu should be useful the moment the tray appears)
 * and every poll rebuilds the menu only when the server answers; failures log
 * once per error change and leave the previous menu in place.
 */
function startSessionFeed(url: URL): void {
  sessionFeed = new SessionFeed(url)
  void refreshSessions()
  sessionPollTimer = setInterval(() => { void refreshSessions() }, SESSION_POLL_MS)
  sessionPollTimer.unref()
}

function stopSessionFeed(): void {
  if (sessionPollTimer !== undefined) {
    clearInterval(sessionPollTimer)
    sessionPollTimer = undefined
  }
  sessionFeed = undefined
}

async function refreshSessions(): Promise<void> {
  const feed = sessionFeed
  if (feed === undefined) return
  try {
    const summaries = await feed.list()
    sessionSummaries = summaries
    if (sessionFeedError !== undefined) {
      sessionFeedError = undefined
      console.log('[dsh-desktop] session feed recovered')
    }
    rebuildTrayMenu()
    tray?.setToolTip(trayTooltip(WINDOW_TITLE, summaries.filter((session) => session.running).length, trayLang))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (sessionFeedError !== message) {
      sessionFeedError = message
      console.error(`[dsh-desktop] session feed unavailable: ${message}`)
    }
  }
}

/**
 * Expose the minimum file-based control used by the built Electron lifecycle
 * smoke. Server resolution, spawn, readiness, window creation, and teardown
 * remain the shipping path; the test hook only reports readiness and requests
 * the same `app.quit()` action as the tray menu.
 */
async function exposeLifecycleTestControl(): Promise<void> {
  if (process.env.DSH_DESKTOP_TEST !== '1') return
  const serverPid = server?.pid
  if (serverPid === undefined) {
    throw new Error('dsh-desktop: lifecycle test control requires a live server pid')
  }
  const quitFile = process.env.DSH_DESKTOP_TEST_QUIT_FILE
  if (quitFile !== undefined) {
    const { statSync } = await import('node:fs')
    const timer = setInterval(() => {
      let current
      try {
        current = statSync(quitFile)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        clearInterval(timer)
        fatal(new Error(`dsh-desktop: lifecycle quit probe failed: ${error instanceof Error ? error.message : String(error)}`))
        return
      }
      if (!current.isFile() || current.size === 0) return
      clearInterval(timer)
      app.quit()
    }, 100)
  }
  // Emit readiness only after the optional quit poller is registered, so a
  // harness reacting immediately cannot create the signal before observation.
  process.stdout.write(`DSH_DESKTOP_READY ${String(serverPid)}\n`)
}

/**
 * Resume Electron's normal quit after the server tree reaches quiescence.
 * The first `before-quit` event is cancelled while teardown runs; clearing the
 * server makes the second event pass through without starting or blocking a
 * second cleanup.
 * @param code - process exit code.
 */
function resumeApplicationQuit(code: number): void {
  server = undefined
  process.exitCode = code
  app.quit()
}

/**
 * Stop the orphan reaper after graceful server teardown has completed. A hard
 * kill never reaches this boundary, so the detached reaper remains available
 * for the failure mode it owns; a graceful quit no longer leaves an otherwise
 * idle descendant blocking Electron's native shutdown.
 */
function stopReaper(): Promise<void> {
  const child = reaper
  reaper = undefined
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      resolve()
    }
    child.once('close', finish)
    child.once('error', finish)
    try {
      if (!child.kill()) finish()
    } catch {
      // A concurrent natural exit means the reaper is already quiescent.
      finish()
    }
  })
}

/**
 * Complete graceful or fatal process cleanup before resuming Electron quit.
 * The whole teardown is bounded so a tray Quit can never hang: on timeout the
 * app quits anyway, the reaper stays alive as the hard-kill backup, and its
 * poll notices the dead main and performs the same tree kill.
 * @param code - final process exit code.
 * @param serverPid - optional server process-tree root to terminate first.
 */
async function finishApplicationQuit(code: number, serverPid?: number): Promise<void> {
  const teardown = (async () => {
    if (serverPid !== undefined) await killTree(serverPid)
    await stopReaper()
  })()
  // The loser of the race is never awaited, so a slow teardown cannot reject
  // unhandledly: killTree reports its own failures and stopReaper always
  // settles. A timed-out teardown keeps running in the background and, once
  // it completes, stops the reaper that a timeout left as the backup.
  await Promise.race([
    teardown,
    new Promise((resolve) => { setTimeout(resolve, QUIT_TEARDOWN_TIMEOUT_MS) }),
  ])
  resumeApplicationQuit(code)
}

function fatal(error: Error): void {
  console.error(`[dsh-desktop] ${error.message}`)
  if (failing) return
  failing = true
  // A teardown already underway (tray Quit while booting, server dying during
  // an intentional quit) owns the cleanup: a modal error box would block the
  // quit that is already happening, and a second kill would race the first.
  if (quitting) return
  // The splash lives inside the window itself; the modal error box simply
  // covers it, and the window closes with the app during teardown.
  dialog.showErrorBox(WINDOW_TITLE, error.message)
  // Kill the server tree and wait for the dispatch to land so a boot failure
  // cannot leave an orphaned `dsh web` (the reaper only guards hard kills).
  quitting = true
  void finishApplicationQuit(1, server?.pid)
}

/**
 * Directory holding this package's runnable payload. In dev that is the
 * package itself; packaged, the reaper is spawned under Electron-as-Node,
 * which cannot read inside `app.asar`, so it must live in the unpacked tree.
 */
function runDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked') : PACKAGE_DIR
}

/**
 * Start the detached orphan reaper. Its process handle is unreferenced so it can
 * outlive a hard-killed main, while the retained child reference lets the
 * graceful teardown path stop it after the server tree is already gone.
 * @param serverPid - server process-tree root watched by the reaper.
 */
function startReaper(serverPid: number): void {
  reaper = nodeSpawn(process.execPath, [join(runDir(), 'lib', 'reaper.js'), String(process.pid), String(serverPid)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'ignore',
    windowsHide: true,
    detached: true,
  })
  reaper
    // The reaper is best-effort: if it cannot start, the graceful quit path
    // still tree-kills the server; only hard-kill cleanup is lost.
    .on('error', () => {})
    // Unref after the error handler, which returns the child itself.
    .unref()
}

/**
 * Purge the harness auth cookies left in the persistent profile by previous
 * launches (see `auth-cookies.ts` for why they accumulate): a pile of them
 * pushes every request's Cookie header past the server's HTTP header limit
 * and the GUI boots into "Failed to load plugins". Best-effort — a purge
 * failure costs nothing the fresh token URL cannot recover from, except the
 * growth that brought the pile past the limit, so a persistent failure is
 * logged and left to surface in the GUI.
 */
async function purgeStaleAuthCookies(): Promise<void> {
  try {
    const cookieStore = session.defaultSession.cookies
    // Electron's Cookie leaves domain/path/secure optional; the removal scope
    // needs all three, so normalize with the defaults Electron stores them under.
    const removals = authCookieRemovals((await cookieStore.get({})).map((cookie) => ({
      name: cookie.name,
      domain: cookie.domain ?? '',
      path: cookie.path || '/',
      secure: cookie.secure === true,
    })))
    if (removals.length === 0) return
    console.log(`[dsh-desktop] purging ${removals.length} stale dsh auth cookie(s)`)
    for (const { url, name } of removals) {
      await cookieStore.remove(url, name)
    }
  } catch (error) {
    console.warn(`[dsh-desktop] stale auth-cookie purge failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function boot(): Promise<void> {
  // The purge must complete before the GUI loads (the load's 303 exchange
  // re-issues the fresh cookie); nothing between here and that load depends
  // on the profile's cookies.
  await purgeStaleAuthCookies()
  // The tray menu speaks the language the user configured for dsh; the shell
  // falls back to the system locale when dsh's locale preference is unset.
  // Resolved here (not at module scope) because getLocale() needs app ready.
  trayLang = resolveTrayLanguage(dshSettingsText(), app.getLocale())
  // One window from the start: the Desktop window opens immediately with the
  // animated splash as its content, then hands off to the GUI in place.
  Menu.setApplicationMenu(null)
  createWindow()
  const launch = resolveWebLaunch({ env: process.env })
  if (launch.env.DSH_PERMISSION_MODE !== undefined && (process.env.DSH_PERMISSION_MODE === undefined || process.env.DSH_PERMISSION_MODE === '')) {
    console.warn(`[dsh-desktop] Windows has no harness confinement backend; using ${launch.env.DSH_PERMISSION_MODE} permission mode (approval prompts are disabled). Set DSH_PERMISSION_MODE to override.`)
  }
  console.log(`[dsh-desktop] launching dsh web (${launch.source}): ${launch.command} ${launch.args.join(' ')}`)
  const child = spawnWebLaunch(launch, { env: process.env })
  server = child
  let ready = false
  let stderrTail = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_LIMIT)
  })
  child.on('error', (error) => {
    // Spawn failure (command not found etc.): no child exists to clean up.
    fatal(new Error(`dsh-desktop: failed to spawn dsh web via ${launch.source}: ${error.message}`))
  })
  child.on('exit', (code, signal) => {
    // Attached immediately so a crash during readiness cannot go unreported;
    // before readiness the readiness wait itself fails (the stream ends), so
    // the boot error path owns the message.
    if (quitting || !ready) return
    void dialog.showMessageBox({
      type: 'error',
      title: WINDOW_TITLE,
      message: 'dsh web exited unexpectedly',
      detail: `code ${String(code)} signal ${String(signal)}\n${stderrTail}`,
    }).finally(() => { app.quit() })
  })
  // No OS delivers a parent-death notification, so the reaper polls this
  // process and tree-kills the server if the main is ever hard-killed (Task
  // Manager, taskkill, a crash), so `dsh web` cannot outlive its window on any
  // platform. Windows kills via taskkill /T; POSIX signals the server's
  // process group (the server is detached, so a negated PID reaches the whole
  // tree). During graceful quit it stays alive until the main's own tree-kill
  // reaches completion, so an interruption still has a cleanup owner; it is
  // then stopped before Electron resumes native shutdown. Like the server, it
  // must live outside Electron's process group: a terminal Ctrl+C signals the
  // group, and taking the reaper with it would kill the hard-kill cleanup
  // exactly when it is needed (detached + unref below).
  if (child.pid !== undefined) startReaper(child.pid)
  // Readable stream: yield strings, and a multibyte character split across
  // chunks is reassembled by the decoder instead of mojibaked.
  child.stdout.setEncoding('utf8')
  let url: URL | undefined
  try {
    url = await waitForReadyLine(child.stdout, {
      onChunk: (chunk) => { process.stdout.write(`[dsh web] ${chunk}`) },
    })
    await waitForHttpOk(url)
    // A 200 on the readiness port is not necessarily ours: if the child
    // exited while the poll ran, some other local server may have answered.
    // Hosting a stranger's process would be a mistake, so fail the boot
    // instead (the catch below owns the fatal dialog).
    if (childExited(child)) {
      throw new Error(`dsh-desktop: dsh web exited (code ${String(child.exitCode)} signal ${String(child.signalCode)}) while its port was verified; not adopting the server`)
    }
    ready = true
    serverUrl = url
  } catch (error) {
    fatal(error instanceof Error ? new Error(`${error.message}\n${stderrTail}`) : new Error(String(error)))
  }
  // `url` survives a later failure in the same try (HTTP readiness failure or
  // child exit after binding). Only hand over to the GUI after the complete
  // readiness boundary succeeds, while fatal() tears the failed server down.
  if (!ready || url === undefined) return
  await useReadyServer(url)
  await exposeLifecycleTestControl()
}

/**
 * Hand the Desktop window over from the splash to the real GUI once the
 * server is ready: load the GUI into the window's own webContents (hidden
 * behind the splash layer), wait for its main interface to actually render,
 * let the splash finish its minimum play time, fade it out, and finally
 * remove the splash view to reveal the GUI. Splash removal is guaranteed by
 * `finally`, so a failed load can never leave the window stuck behind the
 * animation layer.
 */
async function useReadyServer(url: URL): Promise<void> {
  startSessionFeed(url)
  const window = mainWindow
  const startedAt = splashStartedAt
  try {
    if (window === undefined || window.isDestroyed()) return
    await window.loadURL(url.href).catch((error: unknown) => {
      // The server may have died right after readiness; a failed load must
      // not crash the main process, the window just stays on its error page.
      console.error(`[dsh-desktop] failed to load ${url.href}: ${error instanceof Error ? error.message : String(error)}`)
    })
    if (process.env.DSH_DESKTOP_TEST !== '1') {
      // Wait until the GUI's main interface has rendered (boot card gone), so
      // dsh's own spinner is never visible; then pre-paint the window with
      // the GUI's background before the fade so the boundary is seamless.
      // A transparent body (e.g. a frontend with no body background) would
      // unmask the window's own background during the fade — keep the splash
      // surface instead so the color stays in palette.
      const probe = await waitForGuiReady(window)
      if (probe.bg !== undefined && !isTransparentColor(probe.bg)) {
        try { window.setBackgroundColor(probe.bg) } catch { /* best-effort */ }
      }
      // Title bar fusion: the injection lands before the splash fade, so the
      // first frame the user sees is already fused; the initial palette comes
      // straight from the probed surface.
      installTitlebarFusion(window, probe.bg)
      // The logo just keeps breathing until the minimum play time is met —
      // nothing on the page reports stages, so there is nothing to update.
      const elapsed = Date.now() - startedAt
      if (elapsed < SPLASH_MIN_MS) {
        await new Promise((resolve) => { setTimeout(resolve, SPLASH_MIN_MS - elapsed) })
      }
    } else {
      // Lifecycle test mode skips the readiness wait; the fusion still installs
      // (it is part of the shipped window contract being smoked).
      installTitlebarFusion(window)
    }
    // A short finale beat mid-breath before the cross-fade to the GUI.
    await new Promise((resolve) => { setTimeout(resolve, SPLASH_FINALE_MS) })
    // Make the splash layer transparent so the fading page reveals the GUI
    // below it (cross-fade) instead of the view's own background color.
    splashView?.setBackgroundColor('#00000000')
    await exitSplash()
  } finally {
    removeSplashView()
    if (window !== undefined && !window.isDestroyed()) {
      try { window.webContents.focus() } catch { /* best-effort */ }
    }
    // The tray is created only after the splash is gone: registering the
    // native notification icon (icon file read + decode + shell call) runs on
    // the main thread, which also schedules the splash view's frames — doing
    // it mid-breath showed as a one-time hitch in the animation.
    createTray()
  }
  // A focus request cached while the server was booting (second launch, tray
  // click) is honored now that the window holds the GUI; the request would
  // have been silently lost otherwise.
  if (pendingFocus) {
    pendingFocus = false
    showWindow()
  }
}

/**
 * Poll the GUI document until the main interface is rendered (see
 * GUI_READY_PROBE). Returns the GUI's body background color when available.
 * Times out after {@link GUI_READY_PROBE_MS} and reports not-ready so the
 * hand-off can still proceed (fallback for non-standard frontends).
 */
async function waitForGuiReady(window: BrowserWindow): Promise<{ bg?: string }> {
  const deadline = Date.now() + GUI_READY_PROBE_MS
  let themePushed = false
  while (Date.now() < deadline) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return {}
    try {
      const result = await window.webContents.executeJavaScript(GUI_READY_PROBE)
      if (result !== null && typeof result === 'object' && (result as { ready?: unknown }).ready === true) {
        const probe: { bg?: string } = {}
        const { bg, theme } = result as { bg?: unknown; theme?: unknown }
        if (typeof bg === 'string') probe.bg = bg
        // Keep the splash's palette in sync with the GUI's actual rendering
        // (covers dsh settings changed at runtime or a config read that missed).
        if (!themePushed && (theme === 'dark' || theme === 'light')) {
          themePushed = true
          updateSplashTheme(theme)
        }
        return probe
      }
    } catch {
      // The frame is still navigating or not ready yet — keep polling.
    }
    await new Promise((resolve) => { setTimeout(resolve, GUI_READY_POLL_MS) })
  }
  return {}
}
/**
 * Remove the splash layer and free its webContents, revealing the GUI. Safe
 * to call repeatedly and when the view was never created or already gone.
 */
function removeSplashView(): void {
  const view = splashView
  splashView = undefined
  if (view === undefined) return
  const parent = mainWindow?.contentView
  try {
    if (parent !== undefined) parent.removeChildView(view)
  } catch (error) {
    console.error(`[dsh-desktop] failed to remove splash view: ${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    if (!view.webContents.isDestroyed()) view.webContents.close()
  } catch {
    // The webContents may already be gone together with the window.
  }
}

// Tray residency means the app outlives its window; a second launch must focus
// the existing window instead of starting a second server.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (process.env.DSH_DESKTOP_TEST === '1') {
      process.stdout.write('DSH_DESKTOP_SECOND_INSTANCE\n')
    }
    showWindow()
  })
  app.setAppUserModelId(APP_ID)
  app.whenReady().then(boot).catch(fatal)
  app.on('before-quit', (event) => {
    // The session poll has no teardown stake in quitting; stopping it first
    // keeps the final menu rebuild from firing mid-teardown.
    stopSessionFeed()
    stopTitlebarSync()
    // More than one path can request quit. Keep the first tree-kill as the
    // single teardown owner and prevent later before-quit events from exiting
    // Electron while that asynchronous kill is still in flight.
    if (quitting) {
      if (server?.pid !== undefined) event.preventDefault()
      return
    }
    quitting = true
    if (server?.pid !== undefined) {
      // Prevent immediate exit and await the process-tree completion boundary
      // so the server child and its descendants are gone before Electron exits.
      // The reaper is the hard-kill backup: if this path is interrupted
      // (crash, forced exit), the reaper performs the same tree kill.
      event.preventDefault()
      void finishApplicationQuit(0, server.pid)
    }
  })
  // Tray residency: the app outlives its window by design, so a destroyed
  // window must not trigger Electron's default quit.
  app.on('window-all-closed', () => {})
}
