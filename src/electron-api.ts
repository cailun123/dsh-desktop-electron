/**
 * Electron API re-exports.
 *
 * Direct ESM import from 'electron' works in Electron 43+ when
 * ELECTRON_RUN_AS_NODE is not set in the environment.
 */
export { app, BrowserWindow, dialog, Menu, nativeImage, nativeTheme, session, shell, Tray, WebContentsView } from 'electron'
export type { WebContents } from 'electron'
