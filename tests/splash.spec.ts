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

  it('shows the breathing logo and the official wordmark, and nothing else', () => {
    const html = splashHtml()
    expect(html).toContain('splash-logo')
    expect(html).toContain('splash-type')
    expect(html).not.toContain('splash-loader')
    // The glow/halo and the wash layers are gone for good — guard against
    // them sneaking back in.
    expect(html).not.toContain('splash-glow')
    expect(html).not.toContain('splash-wash')
    expect(html).not.toContain('--glow')
    expect(html).not.toContain('--halo')
    expect(html).not.toContain('--wash')
    // The whale is the only content image; the wordmark is inline SVG.
    const imgCount = (html.match(/<img/gu) ?? []).length
    expect(imgCount).toBe(1)
    // No extra widgets at all.
    expect(html).not.toContain('splash-footer')
    expect(html).not.toContain('splash-track')
    expect(html).not.toContain('splash-fill')
    expect(html).not.toContain('shimmer')
    expect(html).not.toContain('class="sp"')
    expect(html).not.toMatch(/@keyframes sp-[abc]/u)
  })

  it('has no typing machinery — the wordmark renders whole', () => {
    const html = splashHtml()
    // The per-slot/per-character reveal is gone: no --t travel, no type-in
    // keyframes, no cursor machinery anywhere.
    expect(html).not.toContain('type-ch')
    expect(html).not.toContain('--t:')
    expect(html).not.toContain('type-in')
    expect(html).not.toContain('type-cursor')
    expect(html).not.toContain('cursor-run')
    expect(html).not.toContain('cursor-blink')
    expect(html).not.toContain('--cursor')
    // The HARNESS chip keeps its inverted treatment (part of the official
    // wordmark — the removed badge was the hand-off 预览版 chip).
    expect(html).toContain('.type-badge-text { fill: var(--bg); }')
  })

  it('renders the wordmark as the official lockup lettering, not a font', () => {
    const html = splashHtml()
    // The lettering is the actual vector paths from the app header lockup
    // (whale excluded — the breathing PNG plays above), scaled up one step
    // from the official header size.
    expect(html).toContain('<svg class="splash-type" viewBox="25.46 3.4 155.99 18.3"')
    expect(html).toContain('height: 42px;')
    // 9 letter paths (k = stem + arm) + 7 badge letters = official path data
    // inline — each duplicated once for the shine clip copy (32 total).
    expect((html.match(/<path d="/gu) ?? []).length).toBe(32)
    // The embedded Host Grotesk font is gone — no font machinery at all.
    expect(html).not.toContain('@font-face')
    expect(html).not.toContain('Host Grotesk')
    expect(html).not.toContain('font-src')
    expect(html).not.toContain('woff2')
  })

  it('keeps the logo refined (76px)', () => {
    const html = splashHtml()
    expect(html).toContain('width: 76px; height: 76px;')
  })

  it('breathes on the 2.8s cycle after the official entrance', () => {
    const html = splashHtml()
    expect(SPLASH_BREATHE_MS).toBe(2800)
    // The entrance is the official Harness hero animation (ds-hero-enter,
    // deepseek.com/harness) at the site's primary-block parameters; the
    // recolor filter is folded into the animated filter chain (--enter-filter)
    // so the whale never flashes its original colors mid-entrance. The
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

  it('enters the wordmark with the official secondary-block rise', () => {
    const html = splashHtml()
    // Site secondary-block parameters: 16px rise, 0.7s, 0.15s delay. Endpoint
    // opacity defaults to full: the bar never dims.
    expect(html).toContain('animation: ds-hero-enter 0.7s ease-out 0.15s backwards;')
    // The hand-off title enters with the official secondary motion, staggered
    // 0.15s behind the whale.
    expect(html).toContain('animation: ds-hero-enter 0.7s ease-out 0.15s both;')
  })

  it('hands the logo off from the official entrance to breathing without a jump', () => {
    const html = splashHtml()
    // ds-hero-enter lands on the breathe 0%/100% pose: opacity 0.7, identity
    // transform, blur resolved to zero — identical to the resting styles.
    expect(html).toContain('opacity: 0.7;')
    expect(html).toContain('transform: translateY(0) translateZ(0);')
    expect(html).toContain('filter: var(--enter-filter, opacity(1)) blur(0);')
  })

  it('uses no gradients at all — the surface is flat, the logo is an image', () => {
    const html = splashHtml()
    expect(html).not.toContain('gradient')
    expect(html).not.toContain('drop-shadow')
    // The only blur() uses are the official ds-hero-enter de-blur (2) and
    // the hand-off reverse exit blur (1) — no other filter machinery.
    expect((html.match(/blur\(/gu) ?? []).length).toBe(3)
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

  it('keeps the exit hand-off duration in sync with the page sequence', () => {
    const html = splashHtml()
    // The main process waits this long after __exit before removing the
    // splash view. The page fits the whole official hand-off inside that
    // budget: wordmark reverse exit 320ms → whale enter 0.9s + title enter
    // 0.7s (staggered 0.15s) → beat → whole-layer fade 700ms
    // (320 + 900 + 280 + 700 = 2200).
    expect(SPLASH_EXIT_MS).toBe(2200)
    // The card fade is JS-driven: the enter animation's forwards fill
    // suppresses class-driven transitions (the layer used to vanish
    // instantly the moment .exit was applied).
    expect(html).toContain("card.style.transition = 'opacity 700ms cubic-bezier(0.45, 0, 0.55, 1)'")
    expect(html).toContain("card.style.opacity = '0'")
  })

  it('swaps the wordmark for the GUI hero title with the official animation at hand-off', () => {
    const html = splashHtml()
    // The title is the GUI empty-state hero copy (探索未至之境), hidden
    // until the hand-off swap.
    expect(html).toContain('探索未至之境')
    expect(html).not.toContain('预览版')
    expect(html).toContain('.splash-title.is-in {')
    expect(html).toContain('--enter-y: 18px;')
    expect(html).toContain('--enter-blur: 8px;')
    expect(html).toContain('animation: ds-hero-enter 0.7s ease-out 0.15s both;')
    // Official title typography, probed from the running GUI: 26px,
    // weight 500, the system sans stack, normal letter-spacing.
    expect(html).toContain('font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif;')
    expect(html).toContain('font-size: 26px;')
    expect(html).toContain('font-weight: 500;')
    expect(html).toContain('letter-spacing: normal;')
    expect(html).toContain('--title: rgb(15, 17, 21);')
  })

  it('drives the hand-off from __exit: reverse exit, title enter, fade the whole layer, flip the exit marker', () => {
    const html = splashHtml()
    // Greedy across the whole function body so the captured string contains
    // the inner `if (...) { ... }` blocks, not just up to the first `}`.
    const exitFn = (html.match(/window\.__exit = function[\s\S]*add\('exit'\);\s*\n\s*\};/u) ?? [''])[0]
    expect(exitFn).not.toBe('')
    // 1) only the surface layer's enter animation is detached (getComputedStyle
    //    → inline). The logo and wordmark bodies are never frozen.
    expect(exitFn).toContain("querySelector('.card')")
    expect(exitFn).toContain('getComputedStyle')
    expect(exitFn).toContain("card.style.animation = 'none'")
    // The whale IS driven at hand-off: it enters with the official primary
    // animation (or shows statically under reduced motion).
    expect(exitFn).toContain("querySelector('.splash-logo')")
    expect(exitFn).toContain("whale.classList.add('is-in')")
    expect(exitFn).toContain("whale.style.opacity = '1'")
    expect(exitFn).not.toContain("querySelector('.splash-glow')")
    expect(exitFn).not.toContain('glow.style')
    // 2) official reverse exit: the wordmark rises and blurs out (320ms),
    //    then the title enters with ds-hero-enter at 320ms.
    expect(exitFn).toContain("querySelector('.splash-type')")
    expect(exitFn).not.toContain("querySelector('.splash-loader')")
    expect(exitFn).toContain("'opacity 320ms ease-in, transform 320ms ease-in, filter 320ms ease-in'")
    expect(exitFn).toContain("translateY(-10px)")
    expect(exitFn).toContain("blur(4px)")
    expect(exitFn).toContain("title.classList.add('is-in')")
    // reduced-motion: the title shows statically instead of animating.
    expect(exitFn).toContain('(prefers-reduced-motion: reduce)')
    expect(exitFn).toContain("title.style.opacity = '1'")
    // 3) after the beat, the whole layer fades on a sine ease (700ms).
    expect(exitFn).toContain("card.style.transition = 'opacity 700ms cubic-bezier(0.45, 0, 0.55, 1)'")
    expect(exitFn).toContain("card.style.opacity = '0'")
    // 4) no wash machinery left behind
    expect(exitFn).not.toContain('splash-wash')
    // 5) body class still flips as the exit marker
    expect(exitFn).toContain("document.body.classList.add('exit')")
  })

  it('animates only compositor-friendly properties', () => {
    const html = splashHtml()
    expect(html).toContain('will-change: opacity')
    expect(html).toContain('will-change: transform, opacity')
    // The breathing keyframes carry translateZ so the loop stays a 3D
    // compositor layer — no main-thread repaints mid-breath. (The entrance is
    // a one-shot that also animates filter/translateY by design.)
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
    // The wordmark renders fully static — info stays, motion stops.
    expect(html).toContain('.card { opacity: 1 !important; }')
    expect(html).not.toContain('transition-duration: 0.01s')
  })
})