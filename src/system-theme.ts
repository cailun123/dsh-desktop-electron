/**
 * Which fill the tray glyph should wear: the opposite of the surface it sits
 * on (dark surface → light glyph, light surface → dark glyph).
 *
 * Windows needs its own path: the taskbar follows the *system* mode
 * (`SystemUsesLightTheme` in the theme-personalization registry key), while
 * `nativeTheme.shouldUseDarkColors` reports the *apps* mode
 * (`AppsUseLightTheme`). The common "dark taskbar + light apps" setup would
 * therefore put a black glyph on the dark taskbar. macOS menu bars and Linux
 * panels follow the appearance that `shouldUseDarkColors` already reports, so
 * there the app-mode reading is the surface reading.
 */

import { spawn } from 'node:child_process'

/** Registry key holding the Windows theme-personalization switches. */
export const WINDOWS_THEME_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize'

/**
 * Parse `reg query` output for `SystemUsesLightTheme`. Returns true for a
 * light taskbar, false for a dark one, undefined when the value is missing
 * or unreadable (caller falls back to the app-mode reading).
 */
export function systemUsesLightThemeFromRegOutput(text: string): boolean | undefined {
  const match = /SystemUsesLightTheme\s+REG_DWORD\s+0x([0-9a-fA-F]+)/.exec(text)
  if (match === null) return undefined
  return match[1] !== '0'
}

/**
 * Read the Windows system theme once. Resolves undefined when the registry
 * is unavailable — `reg` ships with every Windows install, so this only
 * guards restricted environments.
 */
export function queryWindowsSystemUsesLightTheme(): Promise<boolean | undefined> {
  return new Promise((resolve) => {
    const child = spawn('reg', ['query', WINDOWS_THEME_KEY, '/v', 'SystemUsesLightTheme'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    })
    let stdout = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.on('error', () => { resolve(undefined) })
    child.on('close', (code) => {
      if (code !== 0) {
        resolve(undefined)
        return
      }
      resolve(systemUsesLightThemeFromRegOutput(stdout))
    })
  })
}

/**
 * Whether the tray's surface is dark: the Windows system mode when readable,
 * otherwise the app-mode reading (`shouldUseDarkColors`) that macOS and Linux
 * surfaces follow anyway.
 */
export function traySurfaceIsDark(systemUsesLightTheme: boolean | undefined, shouldUseDarkColors: boolean): boolean {
  if (systemUsesLightTheme === undefined) return shouldUseDarkColors
  return !systemUsesLightTheme
}
