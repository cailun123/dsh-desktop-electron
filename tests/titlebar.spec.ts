import { describe, expect, it, vi } from 'vitest'
import {
  CAPTION_LEADING_CLEARANCE_MACOS_PX,
  TITLEBAR_CHANGE_SIGNAL,
  TITLEBAR_BOUNDARY_COLOR,
  TITLEBAR_BOUNDARY_WIDTH_PX,
  TITLEBAR_CHROME_FILL,
  TITLEBAR_CHROME_READER,
  TITLEBAR_CONTENT_RADIUS_PX,
  TITLEBAR_GESTURE_PROBE_DELAYS_MS,
  TITLEBAR_SCRIM_SELECTOR,
  TITLEBAR_SIDEBAR_SELECTOR,
  TITLEBAR_STATE_PROBE,
  TITLEBAR_STRIP_FALLBACK_PX,
  TITLEBAR_WATCH_GUARD_MS,
  TITLEBAR_WATCH_TIMEOUT_MS,
  compositedSurfaceColor,
  initialOverlayPalette,
  overlayPaletteForSurface,
  titlebarBaseColor,
  titlebarFusionCss,
  windowChromeOptions,
} from '../src/titlebar.ts'
import { SPLASH_BG_DARK, SPLASH_BG_LIGHT } from '../src/splash.ts'

describe('window chrome options', () => {
  it('hides the title bar and enables the overlay on Windows', () => {
    const options = windowChromeOptions('win32', 'dark', false)
    expect(options.titleBarStyle).toBe('hidden')
    // The pre-GUI palette must match the splash surface so the strip, the
    // splash and the first GUI paint share one palette.
    expect(options.titleBarOverlay).toEqual({ color: SPLASH_BG_DARK, symbolColor: '#ffffff' })
  })

  it('enables the overlay on Linux too, with the same palette rules', () => {
    const options = windowChromeOptions('linux', undefined, true)
    expect(options.titleBarStyle).toBe('hidden')
    expect(options.titleBarOverlay).toEqual({ color: SPLASH_BG_DARK, symbolColor: '#ffffff' })
    expect(windowChromeOptions('linux', 'light', true).titleBarOverlay).toEqual({ color: SPLASH_BG_LIGHT, symbolColor: '#000000' })
  })

  it('falls back to the system scheme when dsh has no preference', () => {
    expect(windowChromeOptions('win32', undefined, false).titleBarOverlay?.color).toBe(SPLASH_BG_LIGHT)
    expect(windowChromeOptions('win32', undefined, true).titleBarOverlay?.color).toBe(SPLASH_BG_DARK)
  })

  it('uses inset traffic lights on macOS with no overlay options', () => {
    const options = windowChromeOptions('darwin', 'dark', true)
    expect(options.titleBarStyle).toBe('hiddenInset')
    expect(options.titleBarOverlay).toBeUndefined()
  })
})

describe('overlay palette from a GUI surface', () => {
  it('picks white glyphs on dark surfaces and black on light ones', () => {
    expect(overlayPaletteForSurface('rgb(13, 13, 15)')).toEqual({ color: 'rgb(13, 13, 15)', symbolColor: '#ffffff' })
    expect(overlayPaletteForSurface('#fbfbfa')).toEqual({ color: 'rgb(251, 251, 250)', symbolColor: '#000000' })
  })

  it('normalizes to opaque rgb() — the overlay backdrop must be opaque', () => {
    const palette = overlayPaletteForSurface('rgba(250, 250, 250, 0.5)')
    expect(palette?.color).toBe('rgb(250, 250, 250)')
  })

  it('treats transparent and unparsable values as no color', () => {
    expect(overlayPaletteForSurface('rgba(0, 0, 0, 0)')).toBeUndefined()
    expect(overlayPaletteForSurface('transparent')).toBeUndefined()
    expect(overlayPaletteForSurface('#00000000')).toBeUndefined()
    expect(overlayPaletteForSurface('')).toBeUndefined()
    expect(overlayPaletteForSurface('not-a-color')).toBeUndefined()
  })

  it('accepts the modern space-separated syntax and percentages', () => {
    expect(overlayPaletteForSurface('rgb(13 13 15)')?.symbolColor).toBe('#ffffff')
    expect(overlayPaletteForSurface('rgb(0%, 0%, 100%)')?.color).toBe('rgb(0, 0, 255)')
  })

  it('splits at the same 128 luminance the readiness probe uses', () => {
    // The probe in main.ts computes 0.299r + 0.587g + 0.114b and splits at
    // 128; stay on the safe side of its floating-point boundary.
    expect(overlayPaletteForSurface('rgb(127, 127, 128)')?.symbolColor).toBe('#ffffff')
    expect(overlayPaletteForSurface('rgb(129, 128, 128)')?.symbolColor).toBe('#000000')
  })
})

describe('fusion CSS', () => {
  it('carves every interactive element out of the drag regions', () => {
    const css = titlebarFusionCss('win32')
    expect(css).toContain('-webkit-app-region: no-drag;')
    expect(css).toContain('[role="textbox"]')
    expect(css).toContain('[contenteditable="true"]')
  })

  it('keeps the sidebar brand row draggable on every platform', () => {
    for (const platform of ['win32', 'linux', 'darwin'] as const) {
      expect(titlebarFusionCss(platform)).toContain('[class*="logoRow"] { -webkit-app-region: drag; }')
    }
  })

  it('turns the page into a card under one chrome band on Windows', () => {
    const css = titlebarFusionCss('win32')
    // The strip is a pure fixed drag band at z-index 0: the sidebar paints
    // above it by tree order, not by an index of its own (see below), and it
    // paints nothing — the chrome behind it is the app frame's.
    const strip = /#root::before \{[^}]+\}/.exec(css)?.[0] ?? ''
    expect(strip).not.toBe('')
    expect(strip).toContain(`height: env(titlebar-area-height, ${TITLEBAR_STRIP_FALLBACK_PX}px);`)
    expect(strip).toContain('z-index: 0;')
    expect(strip).toContain('-webkit-app-region: drag;')
    expect(strip).not.toContain('border-bottom')
    expect(strip).not.toContain('background')
    // The frame paints the window chrome, so the caption band and the notch
    // behind the card's rounded corner are one surface with the sidebar. It is
    // reached through the column it holds — the frame's own class is a
    // per-build hash shared with other packages' `…_frame` classes — and the
    // fill is the sidebar's own token, not a copy of its value, so both follow
    // a theme flip together.
    expect(css).toContain(`#root *:has(> ${TITLEBAR_SIDEBAR_SELECTOR}) { background: ${TITLEBAR_CHROME_FILL}; }`)
    expect(TITLEBAR_CHROME_FILL).toContain('--dsw-specific-sidebar-fill')
    // One selector addresses the sidebar in the CSS and in the probe, so the
    // band's paint and the controls' palette can never come from two elements.
    expect(css).toContain(TITLEBAR_SIDEBAR_SELECTOR)
    // The sidebar column keeps the window's full height — it is the chrome
    // surface that reaches the top edge — while staying free of a `z-index`:
    // an indexed column becomes a stacking context and traps the GUI's
    // full-viewport overlays (the settings dialog lives inside it) beneath
    // dsh's right panel (z-index 10), which then covers the dialog.
    const sidebarRule = /\[class\*="sidebarCol"\] \{[^}]+\}/.exec(css)?.[0] ?? ''
    expect(sidebarRule).toContain('position: relative;')
    expect(sidebarRule).toContain('height: 100%;')
    // The GUI's own `border-right` is replaced by a line of the shell's: the
    // border would run straight past the card's corner and stub out across the
    // notch the radius opens.
    expect(sidebarRule).toContain('border-right: none;')
    expect(sidebarRule).not.toContain('z-index')
    // The sidebar carries no line of its own: the junction's boundary belongs
    // to the card's border, so all three of its segments are one stroke.
    expect(css).not.toContain('sidebarCol"]::after')
    // The page is the card: a margin — not a padding — starts the column's own
    // box below the band, so its background stops there (the frame's chrome
    // shows above it), the GUI's `overflow: hidden` clips the GUI's content
    // with the radius, and the band's bottom edge is still where the
    // conversation header starts.
    const cardRule = /\[class\*="centerCol"\] \{[^}]+\}/.exec(css)?.[0] ?? ''
    expect(cardRule).not.toBe('')
    expect(cardRule).toContain(`margin-top: env(titlebar-area-height, ${TITLEBAR_STRIP_FALLBACK_PX}px);`)
    expect(cardRule).toContain('var(--dsw-alias-bg-base, transparent);')
    expect(cardRule).toContain(`border-top-left-radius: ${TITLEBAR_CONTENT_RADIUS_PX}px;`)
    expect(cardRule).toContain('corner-shape: round;')
    expect(cardRule).not.toContain('padding-top')
    // One border draws the whole boundary — the band's bottom edge, the arc
    // around the card's corner, and the line that separates the card from the
    // sidebar — so the three segments carry the same weight and join
    // tangentially. A hand-assembled junction (a separator on the sidebar, a
    // border on the card, and a gradient ring over the arc) swelled to three
    // pixels at the turn and then stepped down to a line a shade lighter and a
    // pixel to the left of the arc it continued.
    expect(cardRule).toContain(`border-top: ${TITLEBAR_BOUNDARY_WIDTH_PX}px solid ${TITLEBAR_BOUNDARY_COLOR};`)
    expect(cardRule).toContain(`border-left: ${TITLEBAR_BOUNDARY_WIDTH_PX}px solid ${TITLEBAR_BOUNDARY_COLOR};`)
    expect(css).not.toContain('radial-gradient')
    // The card's corner is the roundest turn in the junction: it takes the
    // Codex desktop's card radius rather than the window's own 8 px corner.
    expect(TITLEBAR_CONTENT_RADIUS_PX).toBeGreaterThan(8)
    expect(TITLEBAR_BOUNDARY_COLOR).toContain('--dsw-alias-border-l4')
    expect(TITLEBAR_BOUNDARY_WIDTH_PX).toBeGreaterThan(0.5)
    expect(css).not.toContain('border-bottom')
    // The right panel is pushed below the band the same way and paints the page
    // surface itself; it carries the same boundary line across its own span.
    const panelRule = /#root \[data-sidebar-right-panel\] \{[^}]+\}/.exec(css)?.[0] ?? ''
    expect(panelRule).toContain(`top: env(titlebar-area-height, ${TITLEBAR_STRIP_FALLBACK_PX}px);`)
    expect(panelRule).toContain(`border-top: ${TITLEBAR_BOUNDARY_WIDTH_PX}px solid ${TITLEBAR_BOUNDARY_COLOR};`)
    // The page elements are no longer chrome: no header drag, no clearance
    // carved out of the page.
    expect(css).not.toContain('#root header')
    expect(css).not.toContain('tabStrip')
    expect(css).not.toContain('padding-right')
  })

  it('keeps the macOS fusion: traffic lights over the sidebar, header as drag chrome', () => {
    const css = titlebarFusionCss('darwin')
    expect(css).toContain(`[class*="logoRow"] { padding-left: ${CAPTION_LEADING_CLEARANCE_MACOS_PX}px; }`)
    expect(css).toContain('#root header { -webkit-app-region: drag; }')
    expect(css).toContain('[class*="root"][data-phase="hero"] [class*="scrollBody"]::before')
    // No shell strip exists on macOS (hiddenInset has no overlay).
    expect(css).not.toContain('#root::before')
    expect(css).not.toContain('centerCol')
    expect(css).not.toContain('padding-right')
  })

  it('never disables pointer events on the drag regions (that kills dragging)', () => {
    expect(titlebarFusionCss('win32')).not.toContain('pointer-events')
    expect(titlebarFusionCss('darwin')).not.toContain('pointer-events')
  })
})

describe('surface probe', () => {
  it('reads the theme-color meta and hunts for a full-viewport scrim', () => {
    expect(TITLEBAR_STATE_PROBE).toContain('meta[name="theme-color"]')
    // Scrim candidates by class stem, case-insensitive so `_onboardingMask`
    // style stems match too, and shared with the change signal so the reader
    // and the signal can never disagree about what a candidate is.
    expect(TITLEBAR_STATE_PROBE).toContain(JSON.stringify(TITLEBAR_SCRIM_SELECTOR))
    expect(TITLEBAR_SCRIM_SELECTOR).toContain('[class*=')
    // Only translucent full-viewport layers count as a dim mask.
    expect(TITLEBAR_STATE_PROBE).toContain('alpha > 0 && alpha < 1')
    expect(TITLEBAR_STATE_PROBE).toContain('rect.right < vw - 1')
  })

  it('never mistakes an SVG mask for a scrim', () => {
    // Icons built from SVG masks leave many `<g class="…-mask-…">` nodes in
    // the DOM; they can never dim the page and must be skipped before any
    // computed-style work.
    expect(TITLEBAR_STATE_PROBE).toContain('instanceof HTMLElement')
  })

  it('reads the window chrome the strip is painted with', () => {
    // The controls sit inside the strip, so their color comes from the element
    // the strip's fill does — the sidebar column — read through the same
    // reader the readiness probe uses, so the first palette after the splash
    // and every later one agree on what the chrome is.
    expect(TITLEBAR_STATE_PROBE).toContain(TITLEBAR_CHROME_READER)
    expect(TITLEBAR_CHROME_READER).toContain(JSON.stringify(TITLEBAR_SIDEBAR_SELECTOR))
    expect(TITLEBAR_CHROME_READER).toContain('getComputedStyle')
    expect(TITLEBAR_STATE_PROBE).toContain('return { surface, chrome, scrim }')
  })

  it('schedules gesture probes fast enough to outrun the eye', () => {
    // The first beat must be immediate: dsh commits a click-opened modal
    // synchronously, so an immediate probe already sees the mask; anything
    // later shows the controls lagging the modal. A settle beat stays for
    // transitions that land late.
    expect(TITLEBAR_GESTURE_PROBE_DELAYS_MS[0]).toBe(0)
    expect(TITLEBAR_GESTURE_PROBE_DELAYS_MS.some((delay) => delay >= 300)).toBe(true)
  })
})

describe('change signal', () => {
  it('watches the page instead of sampling it', () => {
    // The signal is what removes the poll's lag: a dialog's mask mounts in the
    // same commit as its overlay, and the observer wakes the main process
    // within a frame of that mutation.
    expect(TITLEBAR_CHANGE_SIGNAL).toContain('new Promise')
    expect(TITLEBAR_CHANGE_SIGNAL).toContain('new MutationObserver')
    expect(TITLEBAR_CHANGE_SIGNAL).toContain('observer.observe(document.documentElement')
    expect(TITLEBAR_CHANGE_SIGNAL).toContain('subtree: true')
  })

  it('uses the same candidate notion as the probe', () => {
    expect(TITLEBAR_CHANGE_SIGNAL).toContain(JSON.stringify(TITLEBAR_SCRIM_SELECTOR))
    // Same HTML-only rule: an SVG mask node must not wake a probe that could
    // never accept it (icons built from SVG masks churn those nodes).
    expect(TITLEBAR_CHANGE_SIGNAL).toContain('instanceof HTMLElement')
  })

  it('wakes on mask mounts, mask class/style flips and theme republishes', () => {
    expect(TITLEBAR_CHANGE_SIGNAL).toContain('record.addedNodes')
    expect(TITLEBAR_CHANGE_SIGNAL).toContain('record.removedNodes')
    expect(TITLEBAR_CHANGE_SIGNAL).toContain("attributeFilter: ['class', 'style', 'content']")
    expect(TITLEBAR_CHANGE_SIGNAL).toContain("target.getAttribute('name') === 'theme-color'")
    expect(TITLEBAR_CHANGE_SIGNAL).toContain('target === document.body')
  })

  it('always comes back for a fresh authoritative read', () => {
    // A quiet page resolves `false` on its own timeout so the watch loop never
    // parks forever, and the main process guards the promise anyway because a
    // navigated frame can leave it unsettled.
    expect(TITLEBAR_CHANGE_SIGNAL).toContain(String(TITLEBAR_WATCH_TIMEOUT_MS))
    expect(TITLEBAR_WATCH_TIMEOUT_MS).toBeGreaterThan(0)
    expect(TITLEBAR_WATCH_GUARD_MS).toBeGreaterThan(TITLEBAR_WATCH_TIMEOUT_MS)
  })

  describe('relevance filter (fake DOM)', () => {
    /** Minimal element stand-in; `HTMLElement` is handed to the script as this class. */
    class FakeElement {
      matchesResult = false
      nested: FakeElement[] = []
      constructor(
        private readonly tagName = 'DIV',
        private readonly attributes: Record<string, string> = {},
      ) {}
      matches(): boolean { return this.matchesResult }
      querySelectorAll(): FakeElement[] { return this.nested }
      getAttribute(name: string): string | null { return this.attributes[name] ?? null }
    }
    const candidate = (): FakeElement => {
      const element = new FakeElement()
      element.matchesResult = true
      return element
    }
    const container = (...nested: FakeElement[]): FakeElement => {
      const element = new FakeElement()
      element.nested = nested
      return element
    }

    /**
     * Run the injected signal against a fake DOM. The script only touches
     * `document` (root + body), `MutationObserver`, `HTMLElement` and timers,
     * so this is enough to drive the filter that decides when the shell
     * re-reads the overlay state.
     */
    function runSignal(): {
      fire: (records: unknown[]) => void
      options: () => Record<string, unknown> | undefined
      disconnected: () => boolean
      signal: Promise<boolean>
      root: FakeElement
      body: FakeElement
    } {
      let notify: ((records: unknown[]) => void) | undefined
      let options: Record<string, unknown> | undefined
      let disconnected = false
      const root = new FakeElement('HTML')
      const body = new FakeElement('BODY')
      class FakeObserver {
        constructor(callback: (records: unknown[]) => void) { notify = callback }
        observe(_target: unknown, next: Record<string, unknown>): void { options = next }
        disconnect(): void { disconnected = true }
      }
      const source = `return ${TITLEBAR_CHANGE_SIGNAL}`
      const signal = new Function('HTMLElement', 'document', 'MutationObserver', 'setTimeout', 'clearTimeout', source)(
        FakeElement,
        { documentElement: root, body },
        FakeObserver,
        setTimeout,
        clearTimeout,
      ) as Promise<boolean>
      return {
        fire: (records) => { notify?.(records) },
        options: () => options,
        disconnected: () => disconnected,
        signal,
        root,
        body,
      }
    }

    const added = (node: unknown): unknown => ({ type: 'childList', addedNodes: [node], removedNodes: [] })
    const removed = (node: unknown): unknown => ({ type: 'childList', addedNodes: [], removedNodes: [node] })
    const attribute = (target: unknown): unknown => ({ type: 'attributes', target, attributeName: 'class' })

    it('wakes on a mask mounting, nested in a new subtree, and on its removal', async () => {
      const mounts = [added(candidate()), added(container(candidate())), removed(candidate())]
      for (const records of mounts) {
        const harness = runSignal()
        harness.fire([records])
        await expect(harness.signal).resolves.toBe(true)
      }
    })

    it('ignores unrelated mutations and SVG nodes, then times out', async () => {
      vi.useFakeTimers()
      try {
        const harness = runSignal()
        harness.fire([added(new FakeElement())])
        harness.fire([added(container())])
        harness.fire([removed({})])
        harness.fire([attribute(new FakeElement())])
        // Nothing relevant yet: the signal must still be parked on its timer.
        vi.advanceTimersByTime(TITLEBAR_WATCH_TIMEOUT_MS)
        await expect(harness.signal).resolves.toBe(false)
        expect(harness.disconnected()).toBe(true)
        expect(harness.options()).toMatchObject({
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ['class', 'style', 'content'],
        })
      } finally {
        vi.useRealTimers()
      }
    })

    it('wakes on a theme republish and on a root class flip', async () => {
      const meta = runSignal()
      meta.fire([{ type: 'attributes', target: new FakeElement('META', { name: 'theme-color' }), attributeName: 'content' }])
      await expect(meta.signal).resolves.toBe(true)

      for (const target of ['root', 'body'] as const) {
        const harness = runSignal()
        harness.fire([attribute(target === 'root' ? harness.root : harness.body)])
        await expect(harness.signal).resolves.toBe(true)
      }
    })
  })
})

describe('scrim compositing', () => {
  it('skins the controls to the chrome band they sit in, not the page behind it', () => {
    // The strip carries the sidebar's fill while the body stays the content
    // color; reading only the body would leave the caption buttons floating on
    // a lighter band than the strip they are drawn inside.
    expect(titlebarBaseColor('rgb(255, 255, 255)', 'rgb(249, 250, 251)')).toBe('rgb(249, 250, 251)')
  })

  it('falls back to the published surface when no chrome is painted', () => {
    // No sidebar column, or a frontend that publishes no fill token: the strip
    // stays transparent, so the surface is what the buttons really sit on.
    expect(titlebarBaseColor('rgb(255, 255, 255)')).toBe('rgb(255, 255, 255)')
    expect(titlebarBaseColor('rgb(255, 255, 255)', 'rgba(0, 0, 0, 0)')).toBe('rgb(255, 255, 255)')
    expect(titlebarBaseColor('rgb(255, 255, 255)', 'not-a-color')).toBe('rgb(255, 255, 255)')
  })

  it('dims the chrome, not the surface, while a modal is open', () => {
    const base = titlebarBaseColor('rgb(255, 255, 255)', 'rgb(249, 250, 251)')
    expect(compositedSurfaceColor(base, 'rgba(0, 0, 0, 0.239)')).toBe('rgb(189, 190, 191)')
  })

  it('dims the surface by the modal mask while it is open', () => {
    // dsh's light mask is #0000003d → white becomes the dimmed grey the eye
    // sees on the masked page.
    expect(compositedSurfaceColor('rgb(255, 255, 255)', 'rgba(0, 0, 0, 0.239)')).toBe('rgb(194, 194, 194)')
    // dsh's dark mask is #00000080 → near-black sinks further.
    expect(compositedSurfaceColor('#0d0d0f', 'rgba(0, 0, 0, 0.5)')).toBe('rgb(7, 7, 8)')
  })

  it('composites non-black scrims too', () => {
    expect(compositedSurfaceColor('rgb(255, 255, 255)', 'rgba(77, 107, 254, 0.5)')).toBe('rgb(166, 181, 255)')
  })

  it('rejects unparsable or fully transparent inputs', () => {
    expect(compositedSurfaceColor('not-a-color', 'rgba(0, 0, 0, 0.5)')).toBeUndefined()
    expect(compositedSurfaceColor('rgb(255, 255, 255)', 'transparent')).toBeUndefined()
    expect(compositedSurfaceColor('rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0.5)')).toBeUndefined()
  })

  it('still feeds the overlay palette split after compositing', () => {
    const dimmed = compositedSurfaceColor('rgb(255, 255, 255)', 'rgba(0, 0, 0, 0.239)')
    expect(dimmed !== undefined && overlayPaletteForSurface(dimmed)?.symbolColor).toBe('#000000')
  })
})
