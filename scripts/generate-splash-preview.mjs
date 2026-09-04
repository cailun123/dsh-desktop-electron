/**
 * Capture the splash exit animation as PNG frames for visual review.
 *
 * Usage: npm run build && node scripts/generate-splash-preview.mjs [outDir] [theme]
 * Mirrors the real app structure (a WebContentsView layered over the window,
 * driven through attachSplash/exitSplash) and captures frames across the
 * exit timeline, logging the page's own animation state per frame.
 */
import pkg from 'electron'
const { app, BrowserWindow, WebContentsView } = pkg
import { mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { attachSplash, exitSplash, splashPageUrl, SPLASH_BG_DARK, SPLASH_BG_LIGHT, SPLASH_EXIT_MS } from '../lib/splash.js'

const outDir = process.argv[2] ?? '.tmp/splash-frames'
const theme = process.argv[3] === 'light' ? 'light' : 'dark'
const WIDTH = 960
const HEIGHT = 600
const STAMPS = [200, 400, 600]

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

// Capture posture: writable cache dir; no-sandbox keeps executeJavaScript
// working under restricted environments (matches the app's own posture).
app.commandLine.appendSwitch('no-sandbox')
app.setPath('userData', join(app.getPath('temp'), 'dsh-splash-preview'))

app.whenReady().then(async () => {
  mkdirSync(outDir, { recursive: true })
  const bg = theme === 'dark' ? SPLASH_BG_DARK : SPLASH_BG_LIGHT
  const win = new BrowserWindow({
    // A visible window is required: offscreen windows never hit the screen,
    // and capturePage on them returns garbage when GPU readback is broken.
    width: WIDTH, height: HEIGHT, show: true, backgroundColor: bg,
    webPreferences: { contextIsolation: true },
  })
  // Same layering as main.ts: the splash is a WebContentsView above the
  // window's own (here empty) webContents, driven via attachSplash.
  const view = new WebContentsView({
    webPreferences: { contextIsolation: true, backgroundThrottling: false },
  })
  view.setBackgroundColor(bg)
  win.contentView.addChildView(view)
  view.setBounds({ x: 0, y: 0, width: WIDTH, height: HEIGHT })
  attachSplash(view.webContents)
  await view.webContents.loadURL(splashPageUrl(theme))

  const state = () => view.webContents.executeJavaScript(`(() => {
    const c = getComputedStyle(document.querySelector('.card'))
    const l = getComputedStyle(document.querySelector('.splash-logo'))
    return JSON.stringify({ card: c.opacity, logo: l.opacity })
  })()`)
  const snap = async (label) => {
    const image = await view.webContents.capturePage()
    const size = image.getSize()
    const rel = [[0.5, 0.5], [0.25, 0.5], [0.73, 0.5], [0.5, 0.2], [0.98, 0.03]]
    const px = image.toBitmap()
    const stride = size.width * 4
    const colors = rel.map(([fx, fy]) => {
      const i = Math.round(fy * (size.height - 1)) * stride + Math.round(fx * (size.width - 1)) * 4
      return [px[i + 2], px[i + 1], px[i]]
    })
    console.log(label, await state(), JSON.stringify(colors))
    await writeFile(join(outDir, label.replace(/\s+/g, '-') + `-${theme}.png`), image.toPNG())
  }

  // Two-phase breathing capture: the swell starts 0.9s after load and peaks
  // 1.4s later, so sample the valley and the crest to show the amplitude.
  await sleep(1050)
  await snap('00-breath-low')
  await sleep(1350)
  await snap('01-breath-high')
  // Mirror main.ts: make the view transparent, then exitSplash() (which
  // fires __exit and resolves after SPLASH_EXIT_MS).
  view.setBackgroundColor('#00000000')
  const exiting = exitSplash()
  let prev = 0
  for (const stamp of STAMPS) {
    await sleep(stamp - prev)
    prev = stamp
    await snap(`exit-${String(stamp).padStart(4, '0')}ms`)
  }
  await exiting
  console.log(`captured ${STAMPS.length + 1} frames (${theme}); exit timeline = ${SPLASH_EXIT_MS}ms`)
  win.destroy()
  app.quit()
}).catch((error) => {
  console.error(error)
  app.quit()
})
