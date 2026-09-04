import { describe, expect, it } from 'vitest'
import { SPLASH_BG_DARK, SPLASH_BG_LIGHT, SPLASH_BREATHE_MS, SPLASH_EXIT_MS, splashPageUrl } from '../src/splash.ts'

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

  it('contains only the breathing logo and nothing else', () => {
    const html = splashHtml()
    expect(html).toContain('splash-logo')
    // The glow/halo and the wash layers are gone for good — guard against
    // them sneaking back in.
    expect(html).not.toContain('splash-glow')
    expect(html).not.toContain('splash-wash')
    expect(html).not.toContain('--glow')
    expect(html).not.toContain('--halo')
    expect(html).not.toContain('--wash')
    // The whale is the only content image.
    const imgCount = (html.match(/<img/gu) ?? []).length
    expect(imgCount).toBe(1)
    // No SVG, no text nodes to render, no extra widgets, no motes.
    expect(html).not.toContain('<svg')
    expect(html).not.toContain('splash-deepseek')
    expect(html).not.toContain('HARNESS')
    expect(html).not.toContain('splash-harness')
    expect(html).not.toContain('splash-footer')
    expect(html).not.toContain('splash-track')
    expect(html).not.toContain('splash-fill')
    expect(html).not.toContain('shimmer')
    expect(html).not.toContain('class="sp"')
    expect(html).not.toMatch(/@keyframes sp-[abc]/u)
  })

  it('keeps the logo refined (64px)', () => {
    const html = splashHtml()
    expect(html).toContain('width: 64px; height: 64px;')
  })

  it('breathes on the 2.8s Codex-style cycle', () => {
    const html = splashHtml()
    expect(SPLASH_BREATHE_MS).toBe(2800)
    // The entrance starts at 0s so the compositor's one-time warm-up (layer
    // promotion, shader compile) lands on the first frames while the logo is
    // still at opacity ≈ 0 — no visible hitch; the breath picks up the moment
    // the fade-in lands (0.9s), keeping the handoff seamless.
    expect(html).toContain('logo-in 0.9s cubic-bezier(0.22, 0.61, 0.36, 1) 0s both')
    expect(html).toContain('logo-breathe 2.8s cubic-bezier(0.37, 0, 0.63, 1) 0.9s infinite')
    expect(html).toContain('0%, 100% { transform: translateZ(0) scale(1);    opacity: 0.7; }')
    expect(html).toContain('50%      { transform: translateZ(0) scale(1.05); opacity: 1; }')
  })

  it('hands the logo off from fade-in to breathing without a jump', () => {
    const html = splashHtml()
    // logo-in lands on logo-breathe 0%/100% (opacity 0.7, scale 1).
    expect(html).toContain('to   { opacity: 0.7; transform: translateZ(0) scale(1); }')
  })

  it('uses no gradients at all — the surface is flat, the logo is an image', () => {
    const html = splashHtml()
    expect(html).not.toContain('gradient')
    expect(html).not.toContain('filter: blur')
    expect(html).not.toContain('drop-shadow')
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

  it('keeps the palette to a surface color and the recolored whale', () => {
    const html = splashHtml()
    // Light: near-white paper, black glyph.
    expect(html).toContain(`--bg: ${SPLASH_BG_LIGHT}`)
    expect(html).toContain('--logo-filter: brightness(0)')
    // Dark: near-black graphite, glyph inverted to white.
    expect(html).toContain(`--bg: ${SPLASH_BG_DARK}`)
    expect(html).toContain('--logo-filter: brightness(0) invert(1)')
    // No wash/text tokens survive.
    expect(html).not.toContain('--wash')
    expect(html).not.toContain('--text:')
    expect(html).not.toContain('--muted:')
    expect(html).not.toContain('--accent:')
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
    // Every animated keyframe carries translateZ so the breath stays a 3D
    // compositor layer end to end — no main-thread repaints mid-loop.
    expect((html.match(/translateZ\(0\) scale\(/gu) ?? []).length).toBe(4)
    expect(html).not.toContain('splash-glow')
  })

  it('respects the system reduced-motion preference by showing a static logo', () => {
    const html = splashHtml()
    expect(html).toContain('@media (prefers-reduced-motion: reduce)')
    // Only the idle breathing stops; the exit itself is functional (a fade),
    // so it keeps working instead of snapping instantly.
    expect(html).toContain('.splash-logo { animation: none !important; opacity: 1 !important; }')
    expect(html).toContain('.card { opacity: 1 !important; }')
    expect(html).not.toContain('transition-duration: 0.01s')
  })
})