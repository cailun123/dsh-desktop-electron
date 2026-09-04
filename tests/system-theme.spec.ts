import { describe, expect, it } from 'vitest'
import { systemUsesLightThemeFromRegOutput, traySurfaceIsDark } from '../src/system-theme.ts'

/** A real `reg query` answer for a dark Windows taskbar (default). */
const REG_DARK = `
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize
    SystemUsesLightTheme    REG_DWORD    0x0
`

const REG_LIGHT = REG_DARK.replace('0x0', '0x1')

describe('systemUsesLightThemeFromRegOutput', () => {
  it('reads the SystemUsesLightTheme switch', () => {
    expect(systemUsesLightThemeFromRegOutput(REG_DARK)).toBe(false)
    expect(systemUsesLightThemeFromRegOutput(REG_LIGHT)).toBe(true)
  })

  it('returns undefined for unreadable output instead of guessing', () => {
    expect(systemUsesLightThemeFromRegOutput('ERROR: The system was unable to find the specified registry key')).toBeUndefined()
    expect(systemUsesLightThemeFromRegOutput('')).toBeUndefined()
    expect(systemUsesLightThemeFromRegOutput('AppsUseLightTheme    REG_DWORD    0x1')).toBeUndefined()
  })
})

describe('traySurfaceIsDark', () => {
  it('inverts the glyph color against the Windows taskbar (system mode)', () => {
    // Dark taskbar + light apps — the common setup where the app-mode reading lies.
    expect(traySurfaceIsDark(false, false)).toBe(true)
    expect(traySurfaceIsDark(true, false)).toBe(false)
    expect(traySurfaceIsDark(false, true)).toBe(true)
  })

  it('falls back to the app-mode reading when the registry is unreadable', () => {
    expect(traySurfaceIsDark(undefined, true)).toBe(true)
    expect(traySurfaceIsDark(undefined, false)).toBe(false)
  })
})
