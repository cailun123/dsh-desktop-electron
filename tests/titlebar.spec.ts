import { describe, expect, it } from 'vitest'
import {
  CAPTION_LEADING_CLEARANCE_MACOS_PX,
  TITLEBAR_GESTURE_PROBE_DELAYS_MS,
  TITLEBAR_STATE_PROBE,
  TITLEBAR_STRIP_FALLBACK_PX,
  compositedSurfaceColor,
  initialOverlayPalette,
  overlayPaletteForSurface,
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

  it('draws a shell title-bar strip on Windows and pushes the page below it', () => {
    const css = titlebarFusionCss('win32')
    // The strip is a fixed drag region under the sidebar (10), dsh's column
    // handles (11) and the shell overlay (20).
    const strip = /#root::before \{[^}]+\}/.exec(css)?.[0] ?? ''
    expect(strip).not.toBe('')
    expect(strip).toContain(`height: env(titlebar-area-height, ${TITLEBAR_STRIP_FALLBACK_PX}px);`)
    expect(strip).toContain('z-index: 5;')
    // The hairline must render just BELOW the band (content-box): inside the
    // band's height it lands under the OS caption buttons' opaque backdrop
    // and shows a gap under the controls.
    expect(strip).toContain('box-sizing: content-box;')
    expect(css).toContain('border-bottom: 0.5px solid var(--dsw-alias-border-l3, transparent);')
    expect(css).toContain('[class*="sidebarCol"]')
    expect(css).toContain('z-index: 10;')
    // The center column and the right panel start below the strip, so the
    // caption buttons never overlay page content. The panel paints at
    // z-index 10 — above the strip — so it must redraw the hairline itself
    // along its span.
    expect(css).toContain(`[class*="centerCol"] { padding-top: env(titlebar-area-height, ${TITLEBAR_STRIP_FALLBACK_PX}px); }`)
    const panelRule = /#root \[data-sidebar-right-panel\] \{[^}]+\}/.exec(css)?.[0] ?? ''
    expect(panelRule).toContain(`top: env(titlebar-area-height, ${TITLEBAR_STRIP_FALLBACK_PX}px);`)
    expect(panelRule).toContain('border-top: 0.5px solid var(--dsw-alias-border-l3, transparent);')
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
    // style stems match too.
    expect(TITLEBAR_STATE_PROBE).toContain('[class*="mask" i]')
    expect(TITLEBAR_STATE_PROBE).toContain('[class*="overlay" i]')
    // Only translucent full-viewport layers count as a dim mask.
    expect(TITLEBAR_STATE_PROBE).toContain('alpha > 0 && alpha < 1')
    expect(TITLEBAR_STATE_PROBE).toContain('rect.right < vw - 1')
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

describe('scrim compositing', () => {
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
