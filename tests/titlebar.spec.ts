import { describe, expect, it } from 'vitest'
import {
  CAPTION_LEADING_CLEARANCE_MACOS_PX,
  CAPTION_TRAILING_CLEARANCE_PX,
  TITLEBAR_SURFACE_PROBE,
  TITLEBAR_STRIP_FALLBACK_PX,
  captionClearanceForPlatform,
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

describe('caption clearance', () => {
  it('reserves the trailing right edge on Windows for the caption buttons', () => {
    expect(captionClearanceForPlatform('win32')).toEqual({ leading: 0, trailing: CAPTION_TRAILING_CLEARANCE_PX })
  })

  it('reserves the leading left edge on macOS for the traffic lights', () => {
    expect(captionClearanceForPlatform('darwin').leading).toBe(CAPTION_LEADING_CLEARANCE_MACOS_PX)
  })

  it('reserves nothing on unsupported platforms', () => {
    expect(captionClearanceForPlatform('freebsd')).toEqual({ leading: 0, trailing: 0 })
  })
})

describe('fusion CSS', () => {
  it('turns the GUI top strip into the drag region', () => {
    const css = titlebarFusionCss('win32')
    // Sidebar brand row and conversation header are the chrome.
    expect(css).toContain('[class*="logoRow"] { -webkit-app-region: drag; }')
    expect(css).toContain('#root header { -webkit-app-region: drag; }')
    // Every control inside them stays clickable.
    expect(css).toContain('[class*="logoRow"] :is(button, a, input, select, textarea, [role="button"], [role="tab"]) { -webkit-app-region: no-drag; }')
    expect(css).toContain('#root header :is(button, a, input, select, textarea, [role="button"], [role="tab"]) { -webkit-app-region: no-drag; }')
  })

  it('adds trailing clearance to the header on Windows and none on macOS', () => {
    const win32 = titlebarFusionCss('win32')
    expect(win32).toContain(`#root header { padding-right: calc(28px + ${CAPTION_TRAILING_CLEARANCE_PX}px); }`)
    expect(win32).not.toContain('padding-left')
    const darwin = titlebarFusionCss('darwin')
    expect(darwin).toContain(`[class*="logoRow"] { padding-left: ${CAPTION_LEADING_CLEARANCE_MACOS_PX}px; }`)
    expect(darwin).not.toContain('padding-right')
  })

  it('gives the hero phase a drag strip sized by the overlay area', () => {
    const css = titlebarFusionCss('win32')
    expect(css).toContain('[class*="root"][data-phase="hero"] [class*="scrollBody"]::before')
    expect(css).toContain(`height: env(titlebar-area-height, ${TITLEBAR_STRIP_FALLBACK_PX}px);`)
  })

  it('never disables pointer events on the drag regions (that kills dragging)', () => {
    expect(titlebarFusionCss('win32')).not.toContain('pointer-events')
  })
})

describe('surface probe', () => {
  it('reads the theme-color meta the GUI theme presenter maintains', () => {
    expect(TITLEBAR_SURFACE_PROBE).toContain('meta[name="theme-color"]')
  })
})
