import { describe, expect, it } from 'vitest'
import { SPLASH_ACCENT, SPLASH_ACCENT_LIGHT, SPLASH_BG_DARK, SPLASH_BG_LIGHT, SPLASH_BREATHE_MS, SPLASH_EXIT_MS, SPLASH_TYPE_START_S, SPLASH_TYPE_STEP_S, SPLASH_TYPE_TEXT, splashPageUrl } from '../src/splash.ts'

const DATA_URL_PREFIX = 'data:text/html;charset=utf-8,'

/** Decode the self-contained splash document for content assertions. */
function splashHtml(): string {
  const url = splashPageUrl()
  expect(url.startsWith(DATA_URL_PREFIX)).toBe(true)
  return decodeURIComponent(url.slice(DATA_URL_PREFIX.length))
}

describe('splash page', () => {
  it('is a self-contained data: URL', () => {
    expect(splashPageUrl()).toMatch(/^data:text\/html;charset=utf-8,/u)
  })

  it('contains only the breathing logo, its type-in progress bar and nothing else', () => {
    const html = splashHtml()
    expect(html).toContain('splash-logo')
    expect(html).toContain('splash-type')
    // The glow/halo and the wash layers are gone for good — guard against
    // them sneaking back in.
    expect(html).not.toContain('splash-glow')
    expect(html).not.toContain('splash-wash')
    expect(html).not.toContain('--glow')
    expect(html).not.toContain('--halo')
    expect(html).not.toContain('--wash')
    // The whale is the only content image; no SVG lettering.
    const imgCount = (html.match(/<img/gu) ?? []).length
    expect(imgCount).toBe(1)
    expect(html).not.toContain('<svg')
    // No extra widgets beyond the type-in bar.
    expect(html).not.toContain('splash-footer')
    expect(html).not.toContain('splash-track')
    expect(html).not.toContain('splash-fill')
    expect(html).not.toContain('shimmer')
    expect(html).not.toContain('class="sp"')
    expect(html).not.toMatch(/@keyframes sp-[abc]/u)
  })

  it('types the wordmark in as a constant, never-stalling progress bar', () => {
    const html = splashHtml()
    // One span per character, staggered by a constant delay (via the --t
    // custom property): fake progress by design, but the rhythm never pauses.
    expect(SPLASH_TYPE_TEXT).toBe('DEEPSEEK HARNESS')
    const charCount = (html.match(/class="type-ch"/gu) ?? []).length
    expect(charCount).toBe(SPLASH_TYPE_TEXT.length)
    // First character at the configured start, constant step afterwards.
    expect(html).toContain(`style="--t:${SPLASH_TYPE_START_S.toFixed(2)}s"`)
    const secondDelay = (SPLASH_TYPE_START_S + SPLASH_TYPE_STEP_S).toFixed(2)
    expect(html).toContain(`--t:${secondDelay}s`)
    // The cursor travels with the typing position: every character carries a
    // trailing cursor segment that lives exactly one step (its ::after), so
    // the blue block sits beside the newest character and hops right as the
    // text grows.
    expect(html).toContain('.type-ch::after')
    expect(html).toContain('left: calc(100% + 0.14em);')
    expect(html).toContain(`animation: ch-cursor ${SPLASH_TYPE_STEP_S}s linear forwards;`)
    expect(html).toContain('animation-delay: var(--t);')
    // Once the last segment expires, the end-of-line cursor takes over and
    // blinks forever — the load always reads as ongoing, never stalled. Dark
    // and light surfaces use the site's per-theme brand variants.
    const cursorDelay = (SPLASH_TYPE_START_S + SPLASH_TYPE_TEXT.length * SPLASH_TYPE_STEP_S).toFixed(2)
    expect(html).toContain(`animation: cursor-blink 1.1s linear ${cursorDelay}s infinite`)
    expect(html).toContain(`--cursor: ${SPLASH_ACCENT}`)
    expect(html).toContain(`--cursor: ${SPLASH_ACCENT_LIGHT}`)
  })

  it('sets the wordmark in Host Grotesk, the Harness site display face', () => {
    const html = splashHtml()
    // The font ships embedded (latin subset) so the self-contained page works
    // offline and inside app.asar; the CSP must therefore allow data: fonts.
    expect(html).toContain('@font-face')
    expect(html).toContain('font-family: "Host Grotesk"')
    expect(html).toContain('font-src data:')
    expect(html).toContain('data:font/woff2;base64,')
    // Site display stack, at the site's section-title tier (24px) so the
    // wordmark locks against the 64px mark like the site header lockup.
    expect(html).toContain('font-family: "Host Grotesk", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif')
    expect(html).toContain('font-size: 24px;')
  })

  it('keeps the logo refined (64px)', () => {
    const html = splashHtml()
    expect(html).toContain('width: 64px; height: 64px;')
  })

  it('breathes on the 2.8s Codex-style cycle', () => {
    const html = splashHtml()
    expect(SPLASH_BREATHE_MS).toBe(2800)
    // The entrance is the official Harness hero animation (ds-hero-enter,
    // deepseek.com/harness) at the site's primary-block parameters; the
    // recolor filter is folded into the animated filter chain (--enter-filter)
    // so the whale never flashes its original colors mid-entrance, and the
    // endpoint (--enter-to) is the breathe valley for a seamless handoff.
    expect(html).toContain('--enter-y: 24px;')
    expect(html).toContain('--enter-blur: 10px;')
    expect(html).toContain('--enter-filter: var(--logo-filter);')
    expect(html).toContain('--enter-to: 0.7;')
    expect(html).toContain('ds-hero-enter 0.9s ease-out backwards,')
    expect(html).toContain('logo-breathe 2.8s cubic-bezier(0.37, 0, 0.63, 1) 0.9s infinite')
    expect(html).toContain('0%, 100% { transform: translateZ(0) scale(1);    opacity: 0.7; }')
    expect(html).toContain('50%      { transform: translateZ(0) scale(1.05); opacity: 1; }')
  })

  it('enters the wordmark with the official secondary-block rise before typing starts', () => {
    const html = splashHtml()
    // Site secondary-block parameters: 16px rise, 0.7s, 0.15s delay — the
    // block lands (0.85s) before the first character appears (0.9s). Endpoint
    // opacity defaults to full: the bar never dims.
    expect(html).toContain('animation: ds-hero-enter 0.7s ease-out 0.15s backwards;')
    expect(html).toContain('font-size: 24px;')
  })

  it('hands the logo off from the official entrance to breathing without a jump', () => {
    const html = splashHtml()
    // ds-hero-enter lands on the breathe 0%/100% pose: opacity = --enter-to
    // (0.7 for the logo), identity transform, blur resolved to zero.
    expect(html).toContain('opacity: var(--enter-to, 1);')
    expect(html).toContain('transform: translateY(0) translateZ(0);')
    expect(html).toContain('filter: var(--enter-filter, opacity(1)) blur(0);')
  })

  it('uses no gradients at all — the surface is flat, the logo is an image', () => {
    const html = splashHtml()
    expect(html).not.toContain('gradient')
    expect(html).not.toContain('drop-shadow')
    // The only blur() is the official ds-hero-enter de-blur — no other
    // filter/blur machinery anywhere.
    expect((html.match(/blur\(/gu) ?? []).length).toBe(2)
  })

  it('carries no progress, status or spinner machinery at all', () => {
    const html = splashHtml()
    expect(html).not.toContain('__setStatus')
    expect(html).not.toContain('setProgress')
    expect(html).not.toContain('requestAnimationFrame')
    expect(html).not.toContain('PROGRESS_MAX_STEP')
    expect(html).not.toContain('stroke-dashoffset')
    expect(html).not.toContain('@keyframes spin')
  })

  it('exposes only the theme switch and the exit bridge', () => {
    const html = splashHtml()
    expect(html).toContain('__setTheme')
    expect(html).toContain('__exit')
  })

  it('supports a forced theme baked into the page and a live __setTheme switch', () => {
    const decode = (u: string): string => decodeURIComponent(u.slice(DATA_URL_PREFIX.length))
    // Default: no force class (follows the system scheme).
    expect(decode(splashPageUrl())).not.toMatch(/<html[^>]*class="/u)
    // Forced dark / light bake the class onto <html> before first paint.
    expect(decode(splashPageUrl('dark'))).toContain('<html lang="zh-CN" class="force-dark">')
    expect(decode(splashPageUrl('light'))).toContain('<html lang="zh-CN" class="force-light">')
    // CSS override blocks + live switch exist.
    expect(decode(splashPageUrl())).toContain('html.force-dark')
    expect(decode(splashPageUrl())).toContain('html.force-light')
    expect(decode(splashPageUrl())).toContain("classList.remove('force-dark', 'force-light')")
  })

  it('keeps the palette to the Harness site surface, text and brand tokens', () => {
    const html = splashHtml()
    // Light: near-white paper, black glyph, site description ink (rgba(0,0,0,.65)).
    expect(html).toContain(`--bg: ${SPLASH_BG_LIGHT}`)
    expect(html).toContain('--logo-filter: brightness(0)')
    expect(html).toContain('--type: rgba(0, 0, 0, 0.65)')
    // Dark: near-black graphite, glyph inverted to white, site description
    // ink (white at 60%).
    expect(html).toContain(`--bg: ${SPLASH_BG_DARK}`)
    expect(html).toContain('--logo-filter: brightness(0) invert(1)')
    expect(html).toContain('--type: hsla(0, 0%, 100%, 0.6)')
    // No halo/wash machinery.
    expect(html).not.toContain('--wash')
    expect(html).not.toContain('--halo')
  })

  it('exports the surface colors as a single source of truth for the window pre-paint', () => {
    // The main process pre-paints the window with these values so the splash
    // fade and the GUI's first paint never reveal a mismatched color. If
    // anyone ever drifts the page from these constants, the test catches it
    // and the handoff fix reverts.
    expect(SPLASH_BG_DARK).toBe('#0d0d0f')
    expect(SPLASH_BG_LIGHT).toBe('#fbfbfa')
    const html = splashHtml()
    expect(html).toContain(SPLASH_BG_DARK)
    expect(html).toContain(SPLASH_BG_LIGHT)
  })

  it('keeps the exit fade duration in sync with the page transition', () => {
    const html = splashHtml()
    // The main process waits this long after __exit before removing the
    // splash view, so the page must finish its fade by then: the whole layer
    // (surface + breathing logo) fades in one gentle sine leg and the GUI
    // appears to fade in.
    expect(SPLASH_EXIT_MS).toBe(700)
    // The card fade is JS-driven: the enter animation's forwards fill
    // suppresses class-driven transitions (the layer used to vanish
    // instantly the moment .exit was applied).
    expect(html).toContain("card.style.transition = 'opacity 700ms cubic-bezier(0.45, 0, 0.55, 1)'")
    expect(html).toContain("card.style.opacity = '0'")
  })

  it('drives the exit fade from __exit: keep the breath playing, fade the whole layer, flip the exit marker', () => {
    const html = splashHtml()
    // Greedy across the whole function body so the captured string contains
    // the inner `if (...) { ... }` blocks, not just up to the first `}`.
    const exitFn = (html.match(/window\.__exit = function[\s\S]*add\('exit'\);\s*\n\s*\};/u) ?? [''])[0]
    expect(exitFn).not.toBe('')
    // 1) only the surface layer's enter animation is detached (getComputedStyle
    //    → inline). The breathing logo and its glow are never touched.
    expect(exitFn).toContain("querySelector('.card')")
    expect(exitFn).toContain('getComputedStyle')
    expect(exitFn).toContain("card.style.animation = 'none'")
    expect(exitFn).not.toContain("querySelector('.splash-logo')")
    expect(exitFn).not.toContain("querySelector('.splash-glow')")
    expect(exitFn).not.toContain('logo.style')
    expect(exitFn).not.toContain('glow.style')
    // 2) one fade leg: the whole layer (surface + breathing logo) fades on a
    //    sine ease — the fade itself is the last breath.
    expect(exitFn).toContain("card.style.transition = 'opacity 700ms cubic-bezier(0.45, 0, 0.55, 1)'")
    expect(exitFn).toContain("card.style.opacity = '0'")
    // 3) no wash machinery left behind
    expect(exitFn).not.toContain('splash-wash')
    // 4) body class still flips as the exit marker
    expect(exitFn).toContain("document.body.classList.add('exit')")
  })

  it('animates only compositor-friendly properties', () => {
    const html = splashHtml()
    expect(html).toContain('will-change: opacity')
    expect(html).toContain('will-change: transform, opacity')
    // The breathing keyframes carry translateZ so the loop stays a 3D
    // compositor layer — no main-thread repaints mid-breath. (The official
    // entrance is a one-shot that also animates filter/translateY by design.)
    expect((html.match(/translateZ\(0\) scale\(/gu) ?? []).length).toBe(2)
    expect(html).toContain('translateY(var(--enter-y, 20px)) translateZ(0);')
    expect(html).not.toContain('splash-glow')
  })

  it('respects the system reduced-motion preference by showing a static logo', () => {
    const html = splashHtml()
    expect(html).toContain('@media (prefers-reduced-motion: reduce)')
    // Only the idle breathing stops; the exit itself is functional (a fade),
    // so it keeps working instead of snapping instantly.
    expect(html).toContain('.splash-logo { animation: none !important; opacity: 1 !important; }')
    // The wordmark and cursor render fully static — info stays, motion stops.
    expect(html).toContain('.type-ch { animation: none !important; opacity: 1 !important; }')
    expect(html).toContain('.type-cursor { animation: none !important; opacity: 1 !important; }')
    expect(html).toContain('.card { opacity: 1 !important; }')
    expect(html).not.toContain('transition-duration: 0.01s')
  })
})