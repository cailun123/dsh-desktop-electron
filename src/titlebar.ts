/**
 * Title bar (Codex-style, layering inverted): the Desktop window drops its
 * native title bar and the shell draws a real title-bar strip across the top
 * of the page, with the OS window controls living inside that strip (Windows:
 * Window Controls Overlay; macOS: inset traffic lights). The layering is the
 * opposite of a classic fusion — the GUI's elements intrude into the title
 * bar, never the title bar into the GUI: the left sidebar is a full-height
 * column that covers the strip's left end (its brand row stays draggable
 * chrome), while the page proper — conversation header, composer, right
 * panel — begins *below* the strip. Nothing interactive can land under the
 * caption buttons, and no page surface needs a clearance carved out of it.
 *
 * This module holds the pure, testable part: the per-platform window-chrome
 * options, the overlay palette derived from the GUI's surface color, and the
 * CSS injected into the GUI that lays out that strip and its drag regions
 * while keeping every control clickable. The Electron wiring lives in
 * `main.ts`.
 *
 * The CSS matches the GUI by stable class-name suffixes (`logoRow`, …) and
 * by structure (`#root header`) for the same reason the tray probes do: the
 * CSS-module hashes in dsh's class names change per build, the suffixes do
 * not. The GUI's theme presenter keeps `<meta name="theme-color">` equal to
 * the live computed body background, which gives the overlay a theme-change
 * signal without any preload/IPC channel (the shell stays fully sandboxed).
 */

import { SPLASH_BG_DARK, SPLASH_BG_LIGHT } from './splash.ts'

/**
 * Opaque surface + window-control glyph colors for the overlay. `color`
 * paints the backdrop behind the caption buttons; `symbolColor` picks the
 * glyph variant so the controls stay readable on any theme.
 */
export interface TitlebarOverlayPalette {
  color: string
  symbolColor: string
}

/**
 * Window-chrome options for one platform. `titleBarOverlay` is only set
 * where the Window Controls Overlay is supported and wanted; macOS gets
 * `hiddenInset` (the traffic lights are system-drawn at a fixed top-left
 * position and cannot be recolored).
 */
export interface WindowChromeOptions {
  titleBarStyle: 'hidden' | 'hiddenInset'
  titleBarOverlay?: TitlebarOverlayPalette
}

/** Resolved theme preference; `system` and `undefined` both follow the OS. */
export type ThemePreferenceHint = 'dark' | 'light' | 'system' | undefined

/**
 * Left padding (px) added to the sidebar brand row on macOS, where the
 * traffic lights sit over the top-left of the content area (~72px wide plus
 * margin). On Windows/Linux the strip below needs no such clearance: the
 * caption buttons live inside the title-bar strip itself.
 */
export const CAPTION_LEADING_CLEARANCE_MACOS_PX = 78

/**
 * Delays (ms) after a user gesture (mouse down / key down) at which the shell
 * re-probes the GUI surface state, so a modal's dim mask registers with the
 * overlay controls near-instantly instead of at the next poll tick. The first
 * beat is immediate: dsh commits a click-opened modal synchronously (React
 * discrete event), so by the time the probe's script evaluates the mask is
 * already in the DOM. The later beats catch the slower cases — a commit that
 * landed a frame or two late, entrance/exit transitions, and the final settle.
 */
export const TITLEBAR_GESTURE_PROBE_DELAYS_MS: readonly number[] = [0, 60, 250, 600]

/**
 * Fallback height (px) of the injected title-bar strip, and of the macOS hero
 * drag strip, when `env(titlebar-area-height)` is unavailable (platforms
 * without the overlay, e.g. macOS hiddenInset).
 */
export const TITLEBAR_STRIP_FALLBACK_PX = 40

/**
 * The overlay palette matching a GUI surface color. Dark surfaces get white
 * glyphs, light ones black — the same luminance split the readiness probe in
 * `main.ts` uses, so both stay in agreement about what "dark" means. The
 * color is normalized to an opaque `rgb()` because the overlay backdrop must
 * be opaque to be useful.
 * @param surface - a CSS color as reported by computed styles or the
 *   theme-color meta (hex, `rgb()` or `rgba()`).
 * @returns the palette, or undefined when the value is transparent or
 *   unparsable (then the previously applied palette simply stays).
 */
export function overlayPaletteForSurface(surface: string): TitlebarOverlayPalette | undefined {
  const rgb = parseOpaqueRgb(surface)
  if (rgb === undefined) return undefined
  const [r, g, b] = rgb
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b
  return {
    color: `rgb(${r}, ${g}, ${b})`,
    symbolColor: luminance >= 128 ? '#000000' : '#ffffff',
  }
}

/**
 * The overlay palette before the GUI has rendered, when the only signal is
 * dsh's theme preference (or the system scheme). Uses the splash surfaces so
 * the pre-GUI strip, the splash and the first GUI paint share one palette.
 * @param preference - dsh's `ui-theme.preference`, `undefined` = system.
 * @param systemDark - the current system color scheme.
 */
export function initialOverlayPalette(preference: ThemePreferenceHint, systemDark: boolean): TitlebarOverlayPalette {
  const dark = preference === 'dark' || ((preference === undefined || preference === 'system') && systemDark)
  return dark
    ? { color: SPLASH_BG_DARK, symbolColor: '#ffffff' }
    : { color: SPLASH_BG_LIGHT, symbolColor: '#000000' }
}

/**
 * Window-chrome options for one platform: a hidden title bar everywhere,
 * plus the Window Controls Overlay where it is supported.
 * @param platform - the running platform.
 * @param preference - dsh's theme preference for the initial palette.
 * @param systemDark - the current system color scheme.
 */
export function windowChromeOptions(platform: NodeJS.Platform, preference: ThemePreferenceHint, systemDark: boolean): WindowChromeOptions {
  if (platform === 'darwin') {
    return { titleBarStyle: 'hiddenInset' }
  }
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: initialOverlayPalette(preference, systemDark),
  }
}

/**
 * The CSS injected into the GUI once its main interface has rendered. It lays
 * out the shell's title-bar strip and the page's relationship to it:
 *
 * - every interactive element is carved out of drag regions;
 * - the sidebar brand row (`logoRow`) stays draggable — the sidebar is the
 *   full-height surface that covers the strip's left end;
 * - Windows/Linux (where the Window Controls Overlay exists): a fixed strip
 *   across the whole top becomes the drag chrome at `z-index: 5` — under the
 *   sidebar column (`10`, raised here), dsh's column drag handles (`11`) and
 *   its shell overlay layer (`20`), and above all in-flow page content. The
 *   center column and the right panel (absolutely positioned against the
 *   frame) are pushed below the strip, so the OS caption buttons drawn inside
 *   the strip never float over page content;
 * - macOS (hiddenInset, no overlay strip): the traffic lights sit over the
 *   sidebar's cleared brand row and the conversation header remains the drag
 *   chrome; the hero phase keeps a thin drag strip of its own.
 */
export function titlebarFusionCss(platform: NodeJS.Platform): string {
  const interactive = 'button, a, input, select, textarea, [role="button"], [role="tab"], [role="textbox"], [contenteditable="true"], [contenteditable=""]'
  const stripHeight = `env(titlebar-area-height, ${TITLEBAR_STRIP_FALLBACK_PX}px)`
  const rules = [
    // Interactive elements must never be swallowed by drag regions:
    `:is(${interactive}) { -webkit-app-region: no-drag; }`,
    // Left sidebar brand row (logo + sidebar toggle): window chrome — the
    // sidebar covers the title-bar strip's left end, so its top row drags.
    '[class*="logoRow"] { -webkit-app-region: drag; }',
  ]
  if (platform === 'win32' || platform === 'linux') {
    rules.push(
      // The sidebar column is raised above the strip (dsh's own handles sit
      // at 11 and the shell overlay at 20), so it reads as piercing the
      // title bar while the strip's drag region stays out of its way.
      `[class*="sidebarCol"] {
  position: relative;
  z-index: 10;
  height: 100%;
}`,
      // The shell's title-bar strip: a transparent band across the whole top,
      // hairline-ruled with the GUI's own border token so it reads as chrome.
      // The rule stays content-box so the hairline renders just BELOW the
      // band: a border inside the band's height would sit under the OS caption
      // buttons' opaque backdrop and the line would show a gap under them.
      // The right panel (z-index 10, above this strip) hides the line along
      // its own span and redraws it as its border-top — see below.
      `#root::before {
  box-sizing: content-box;
  content: '';
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: ${stripHeight};
  border-bottom: 0.5px solid var(--dsw-alias-border-l3, transparent);
  z-index: 5;
  -webkit-app-region: drag;
}`,
      // The page yields its top band to the strip: the center column's
      // in-flow content (conversation header, composer) starts below it.
      `[class*="centerCol"] { padding-top: env(titlebar-area-height, ${TITLEBAR_STRIP_FALLBACK_PX}px); }`,
      // The right panel is positioned against the frame's right edge
      // (`top: 0`, absolute — and fixed under its fullscreen mode, which the
      // id-qualified selector outranks), so it is offset below the strip
      // directly. It paints at z-index 10, above the strip, so it would hide
      // the strip's own hairline along its span — it carries the matching
      // top border itself instead, which continues the strip's line at the
      // panel's left edge.
      `#root [data-sidebar-right-panel] {
  top: ${stripHeight};
  border-top: 0.5px solid var(--dsw-alias-border-l3, transparent);
}`,
    )
  } else {
    // macOS hiddenInset: the traffic lights sit over the sidebar's top-left
    // (cleared by the padding below) and no overlay strip exists, so the
    // conversation header (breadcrumb, tabs, actions) stays the drag chrome.
    rules.push(
      `[class*="logoRow"] { padding-left: ${CAPTION_LEADING_CLEARANCE_MACOS_PX}px; }`,
      '#root header { -webkit-app-region: drag; }',
      // Hero phase: no header exists yet, so a thin strip over the empty top
      // of the centered composer carries the drag region instead.
      `[class*="root"][data-phase="hero"] [class*="scrollBody"]::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: ${stripHeight};
  -webkit-app-region: drag;
}`,
    )
  }
  return rules.join('\n')
}

/**
 * Injected probe: what the overlay controls should blend with right now.
 *
 * - `surface` — the GUI's theme presenter keeps `<meta name="theme-color">`
 *   equal to the computed body background, so re-reading it is a cheap
 *   theme-change signal (no preload, no IPC, no DOM mutation observer wired
 *   across the sandbox).
 * - `scrim` — the background color of the topmost full-viewport translucent
 *   layer (a modal's dim mask), when one is open. The OS draws the caption
 *   buttons *above* every page layer, so a modal's mask cannot dim them;
 *   the main process composites this scrim over the surface and re-skins the
 *   controls to match, which keeps the buttons from glaring against a dimmed
 *   page. Candidates are matched by class stem (`mask`/`overlay`/`scrim`/
 *   `backdrop`, case-insensitive) and must actually cover the viewport and
 *   carry a translucent background — the app frame itself is opaque and
 *   never matches.
 */
export const TITLEBAR_STATE_PROBE = `(() => {
  const meta = document.querySelector('meta[name="theme-color"]');
  const surface = meta === null ? undefined : meta.getAttribute('content');
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const alphaOf = (bg) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(bg);
    if (m === null) return 1;
    const parts = m[1].split(/[\\s,/]+/).filter(Boolean);
    if (parts.length < 4) return 1;
    const alpha = parts[3].endsWith('%') ? Number.parseFloat(parts[3]) / 100 : Number.parseFloat(parts[3]);
    return Number.isFinite(alpha) ? alpha : 1;
  };
  let scrim;
  let scrimZ = -Infinity;
  const candidates = document.querySelectorAll('[class*="mask" i],[class*="overlay" i],[class*="scrim" i],[class*="backdrop" i]');
  for (const el of candidates) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const rect = el.getBoundingClientRect();
    if (rect.left > 1 || rect.top > 1 || rect.right < vw - 1 || rect.bottom < vh - 1) continue;
    const alpha = alphaOf(cs.backgroundColor);
    if (!(alpha > 0 && alpha < 1)) continue;
    const z = Number.parseFloat(cs.zIndex) || 0;
    if (z < scrimZ) continue;
    scrimZ = z;
    scrim = cs.backgroundColor;
  }
  return { surface, scrim };
})()`

/** An 8-bit sRGB channel triplet with alpha in 0..1. */
interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

/**
 * Alpha-composite one color over another and return the opaque result. This
 * is what the caption buttons' backdrop should read while a modal dim mask is
 * open: the GUI's surface color seen through the mask — the same value the
 * user's eye assigns to the dimmed page around the controls.
 * @param surface - the opaque base (the GUI body background).
 * @param scrim - the translucent layer on top of it (the mask background).
 * @returns an opaque `rgb()` string, or undefined when either value is
 *   transparent or unparsable (then the previous palette simply stays).
 */
export function compositedSurfaceColor(surface: string, scrim: string): string | undefined {
  const base = parseColor(surface)
  const top = parseColor(scrim)
  if (base === undefined || top === undefined || base.a === 0) return undefined
  const mix = (channel: 'r' | 'g' | 'b'): number =>
    Math.round(top.a * top[channel] + (1 - top.a) * base[channel])
  return `rgb(${mix('r')}, ${mix('g')}, ${mix('b')})`
}

/**
 * Parse a CSS color into 8-bit sRGB channels with alpha. Handles the forms
 * computed styles and the theme-color meta produce (`rgb()`, `rgba()`, hex)
 * and the occasional space-separated modern syntax.
 * @param value - the raw color string.
 * @returns the channels, or undefined for transparent/unparsable values.
 */
function parseColor(value: string): Rgba | undefined {
  const text = value.trim().toLowerCase()
  if (text === '' || text === 'transparent' || text === 'none') return undefined
  const hex = /^#([0-9a-f]{3,8})$/u.exec(text)
  if (hex !== null) {
    const digits = hex[1] ?? ''
    if (digits.length === 4 || digits.length === 8) {
      const alphaDigits = digits.length === 4 ? digits.slice(3) : digits.slice(6)
      const alpha = Number.parseInt(alphaDigits, 16) / 255
      if (alpha === 0) return undefined
      const expand = (d: string): number => Number.parseInt(d + d, 16)
      if (digits.length === 4) {
        return { r: expand(digits[0] ?? '0'), g: expand(digits[1] ?? '0'), b: expand(digits[2] ?? '0'), a: alpha }
      }
      return {
        r: Number.parseInt(digits.slice(0, 2), 16),
        g: Number.parseInt(digits.slice(2, 4), 16),
        b: Number.parseInt(digits.slice(4, 6), 16),
        a: alpha,
      }
    }
    if (digits.length === 3) {
      const expand = (d: string): number => Number.parseInt(d + d, 16)
      return { r: expand(digits[0] ?? '0'), g: expand(digits[1] ?? '0'), b: expand(digits[2] ?? '0'), a: 1 }
    }
    if (digits.length === 6) {
      return {
        r: Number.parseInt(digits.slice(0, 2), 16),
        g: Number.parseInt(digits.slice(2, 4), 16),
        b: Number.parseInt(digits.slice(4, 6), 16),
        a: 1,
      }
    }
    return undefined
  }
  const fn = /^rgba?\(([^)]+)\)$/u.exec(text)
  if (fn === null) return undefined
  // Comma form: 255, 255, 255[, a]; modern form: 255 255 255 [/ a].
  const body = fn[1] ?? ''
  const parts = body.includes('/') ? body.split('/') : [body]
  let alpha = 1
  if (parts.length === 2) {
    alpha = Number.parseFloat((parts[1] ?? '').trim())
  } else {
    const channels = (parts[0] ?? '').split(/[\s,]+/).filter((part) => part !== '')
    if (channels.length === 4) alpha = Number.parseFloat(channels[3] ?? '')
  }
  if (!Number.isFinite(alpha) || alpha === 0) return undefined
  const channels = (parts[0] ?? '').split(/[\s,]+/).filter((part) => part !== '').slice(0, 3)
  const rgb = channels.map((channel) => {
    if (channel.endsWith('%')) {
      const percent = Number.parseFloat(channel.slice(0, -1))
      return Number.isFinite(percent) ? Math.round(percent * 2.55) : NaN
    }
    return Number.parseFloat(channel)
  })
  if (rgb.length !== 3 || rgb.some((channel) => !Number.isFinite(channel))) return undefined
  return {
    r: Math.min(255, Math.max(0, Math.round(rgb[0] ?? 0))),
    g: Math.min(255, Math.max(0, Math.round(rgb[1] ?? 0))),
    b: Math.min(255, Math.max(0, Math.round(rgb[2] ?? 0))),
    a: Math.min(1, Math.max(0, alpha)),
  }
}

/**
 * Parse a CSS color into opaque 8-bit sRGB channels: an opaque overlay
 * backdrop is the point, so alpha is dropped (fully transparent values are
 * "no color").
 * @param value - the raw color string.
 * @returns `[r, g, b]`, or undefined for transparent/unparsable values.
 */
function parseOpaqueRgb(value: string): [number, number, number] | undefined {
  const color = parseColor(value)
  return color === undefined ? undefined : [color.r, color.g, color.b]
}
