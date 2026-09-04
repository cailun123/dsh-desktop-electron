/**
 * Startup splash: the animated boot stage of the Desktop window, played on a
 * `WebContentsView` layered *above* the window's own webContents. The window
 * opens instantly with the animation filling it; the real GUI loads behind
 * the splash, hidden, and the splash hands off only once the GUI's main
 * interface has actually rendered (`main.ts` polls for `#root`/boot-card
 * readiness) and the minimum play time has elapsed — so the user never sees
 * dsh's own boot spinner and the animation ends exactly at the main UI.
 *
 * The visual is a Codex-style breathing logo: the centered whale logo rides
 * a gentle scale/opacity swell on a 2.8s cycle over a flat monochrome surface.
 * No glow, no lettering, no progress bar, no spinner — the breath is the design.
 *
 * All animation is `transform` and `opacity` only (compositor-thread work),
 * so the loop stays cheap under background throttling. The page is a
 * self-contained `data:` document — no preload, no IPC, matching the shell's
 * sandboxed posture (`sandbox: true`, `contextIsolation: true`). The main
 * process switches the palette (`updateSplashTheme`) and ends the splash
 * with a gentle fade (`exitSplash`) through `executeJavaScript` (main-side
 * injection, immune to renderer sandbox) once the view is attached via
 * `attachSplash`: the whole layer — surface and logo together — fades out,
 * and the GUI that has rendered behind the splash appears to fade in. The
 * whale logo is embedded as a base64 data URL (the black glyph is recolored
 * to white/black via CSS filters per theme), so the markup needs no
 * `file://` access and works identically in dev and inside `app.asar`.
 *
 * The palette follows the system color scheme via `prefers-color-scheme`
 * (Chromium mirrors the OS through `nativeTheme`): near-white paper with a
 * black glyph in light mode, near-black graphite with a white glyph in dark
 * mode.
 *
 * Brand assets are derived from the DeepSeek Harness web frontend; the
 * DeepSeek name and whale logo are trademarks of their respective owner.
 */

import type { WebContents } from './electron-api.ts'

/**
 * Exit fade duration in ms. The window opens the exit transition with
 * `__exit()` — which keeps the breath playing untouched and fades the whole
 * splash layer out on a gentle sine ease — and waits this long before
 * removing the splash view, so the main process's timer and the page's
 * transition stay in lockstep and the GUI appears to fade in. The breathing
 * logo is never frozen mid-pose: the fade itself is the last breath.
 */
export const SPLASH_EXIT_MS = 700

/** Breathing pulse period (ms) for the logo. */
export const SPLASH_BREATHE_MS = 2800

/**
 * Minimum time the splash plays before the hand-off to the GUI, so the intro
 * is always seen in full even when the server and the GUI frontend become
 * ready faster. When the GUI is slower, the breathing loop simply keeps
 * playing until it is actually ready. Lives here rather than in `main.ts` so
 * the app, the offline preview and the tests share one timeline.
 */
export const SPLASH_MIN_MS = 3800

/**
 * Brief beat before the exit transition starts, so the breathing logo is seen
 * for a moment more right as the hand-off begins.
 */
export const SPLASH_FINALE_MS = 400

/**
 * Splash surface color in dark mode. The same value is used for the window
 * background pre-paint in `main.ts` so the splash→GUI hand-off never flashes
 * a different color in the region the GUI has not yet painted.
 */
export const SPLASH_BG_DARK = '#0d0d0f'

/** Splash surface color in light mode — see {@link SPLASH_BG_DARK}. */
export const SPLASH_BG_LIGHT = '#fbfbfa'

/** The black whale glyph (256px, transparent background) from the template. */
const WHALE_PNG_DATA_URL = 'data:image/png;base64,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S6URcJSDMmCI9bZwPgVwXxo6P5BGsg1pOHsmr48zJY2gK56rGaH8NYA/0BtzlXoBADn5rxlsaW+T7aHej2EzARoZQ3s5QO8IBdZpYHkxplp2ZKVkixOKLuo/LErLscTqm23L8JDkroxMtDCUeNAlyrkCGdhn5I+K+cmMe0jLnDQWrkZ8ctSeXCyutHnGYA5tAC5dAH8q3YUs1Zv1AsB3ALypXxhjXu4Ufln+XZD2hFEFSBHPADyWBs1/HWrYfK5/sE1yLQAGFmUMvo/uLCrvGYBXAPxAv1BRT8YpzAyN33eN4/9ETuzBSf+4QG8FZaojI93YNhA3d0acnESNmJMpvfoPlfGbHSlwWfUik5aNdkHlkFgLqxLV0pWrFAsCP3kii50QJaUrPQUxu55ySl8aWbmyDiVtSmbCsSAolr6suOtzrUSixk3JAyZSncseOjzxqRU6AI5KoxanHH+2xj5PfGqdWaketPGugE/ZIRIdmWy0Ig8N0SdLLlmXAo9X+xbIfShwSAcB/JZUFRb1iwl5DuA9AP8M4F3OhW8XFgB+zMrDOL8q8w4sr1C0LUuYvwfgHTnhWz0hps1YAIQxLXcFCwC+MjSjLebw2E9lEszHQ7Pf7ss2IoAFQFQdKQRmpYCYBfAzcrcwIw1tRe8cHss02w050QcPJBnMfNuQmXBERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERCT+F69oXC1Xb2FwAAAAAElFTkSuQmCC'

/** webContents hosting the splash page (the Desktop window while booting). */
let host: WebContents | undefined

/**
 * Attach the webContents that hosts the splash page (the Desktop window's
 * own webContents while booting). The theme switch and the exit fade are
 * sent to this webContents.
 */
export function attachSplash(contents: WebContents): void {
  host = contents
}

/**
 * Switch the splash page's theme live (dark / light / system). Adds or removes
 * the `force-dark` / `force-light` class on the page's `<html>`; `system`
 * clears both so `prefers-color-scheme` takes over again. Best-effort: no-op
 * while the page is still navigating.
 */
export function updateSplashTheme(theme: 'dark' | 'light' | 'system'): void {
  const wc = host
  if (wc === undefined || wc.isDestroyed()) return
  void wc.executeJavaScript(`window.__setTheme(${JSON.stringify(theme)})`).catch(() => {
    // Page failure is fine — the baked-in initial theme already applies.
  })
}

/**
 * Fade the splash page out (the page freezes its breath pose and fades the
 * whole layer via an inline-style transition), then resolve so the caller can
 * remove the splash view and reveal the GUI that has been loading behind it.
 * Resolves immediately when nothing is attached.
 */
export function exitSplash(): Promise<void> {
  const wc = host
  if (wc === undefined || wc.isDestroyed()) return Promise.resolve()
  void wc.executeJavaScript('window.__exit && window.__exit()').catch(() => {
    // Page failure still lets the timer below complete the hand-off.
  })
  return new Promise((resolve) => { setTimeout(resolve, SPLASH_EXIT_MS) })
}

/**
 * The splash page as a self-contained `data:` document, ready to be loaded
 * into the Desktop window's webContents.
 * @param initialTheme - optional forced theme ('dark' | 'light') baked into the
 *   page so it matches the dsh GUI from the very first frame; omit to follow
 *   the system scheme (live via `prefers-color-scheme`).
 */
export function splashPageUrl(initialTheme?: 'dark' | 'light'): string {
  return splashDataUrl(initialTheme)
}

/**
 * Build the splash page: a flat monochrome surface with the whale logo
 * breathing at its center, and nothing else. When `initialTheme` is given the
 * matching `force-*` class is baked onto `<html>` so the palette is correct
 * before first paint; `window.__setTheme` switches it live afterwards.
 *
 * The page background color is interpolated from {@link SPLASH_BG_DARK} and
 * {@link SPLASH_BG_LIGHT} so the rendered surface and the main process's
 * window pre-paint share a single source of truth — the GUI's first paint
 * never reveals a mismatched color through an unpainted region.
 */
function splashDataUrl(initialTheme?: 'dark' | 'light'): string {
  const themeClass = initialTheme === 'dark' ? ' class="force-dark"' : initialTheme === 'light' ? ' class="force-light"' : ''
  const html = `<!DOCTYPE html>
<html lang="zh-CN"${themeClass}>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>DeepSeek Harness</title>
<style>
  /* 主题令牌 —— 底色 + 鲸鱼滤镜。日间纸白配黑鲸，夜间石墨黑配白鲸。 */
  :root {
    color-scheme: light dark;
    --bg: ${SPLASH_BG_LIGHT};
    --logo-filter: brightness(0);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: ${SPLASH_BG_DARK};
      --logo-filter: brightness(0) invert(1);
    }
  }

  /* 强制主题（跟随 dsh GUI 的外观设置）：html.force-dark / html.force-light
     覆盖系统 prefers-color-scheme，优先级高于 :root 与媒体查询 */
  html.force-dark {
    color-scheme: dark;
    --bg: ${SPLASH_BG_DARK};
    --logo-filter: brightness(0) invert(1);
  }
  html.force-light {
    color-scheme: light;
    --bg: ${SPLASH_BG_LIGHT};
    --logo-filter: brightness(0);
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 100%; height: 100%; background: transparent; overflow: hidden;
    -webkit-user-select: none; user-select: none; cursor: default;
  }

  /* 启动舞台铺满整个 Desktop 窗口内容区：无圆角、无边框，与窗口一体。
     退出 = 整层淡出：__exit() 在 JS 里冻结当前姿态并驱动淡出（enter
     动画的 forwards 填充会压住 class 切换的 transition，必须走内联样
     式），底色与 logo 一起淡出，露出后面已渲染好的主界面。 */
  .card {
    position: absolute; inset: 0; overflow: hidden;
    background: var(--bg);
    opacity: 0;
    animation: enter 0.5s ease forwards;
    will-change: opacity;
  }
  @keyframes enter { to { opacity: 1; } }

  /* 正中：鲸鱼 logo，2.8s 一息的呼吸。呼吸只动 transform/opacity，留在
     合成器线程；正弦型缓动 + 关键帧零速起收，循环无速度突变。 */
  .splash {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    transform: translateZ(0);
  }
  .splash-logo {
    position: relative;
    width: 64px; height: 64px;
    filter: var(--logo-filter);
    transform: translateZ(0);
    will-change: transform, opacity;
    /* 入场 0s 即启动：合成器首次提升图层/编译着色器的一次性开销落在
       opacity≈0 的头几帧里，肉眼不可见；0.9s 落点与呼吸 0% 状态无缝
       交接。 */
    animation:
      logo-in 0.9s cubic-bezier(0.22, 0.61, 0.36, 1) 0s both,
      logo-breathe 2.8s cubic-bezier(0.37, 0, 0.63, 1) 0.9s infinite;
  }

  /* 入场：logo 淡入；落点停在呼吸曲线 0% 状态，交接无跳变。transform
     里带 translateZ，保证动画全程是 3D 合成层。 */
  @keyframes logo-in {
    from { opacity: 0; transform: translateZ(0) scale(0.95); }
    to   { opacity: 0.7; transform: translateZ(0) scale(1); }
  }

  /* 呼吸：logo 2.8s 内 scale 1→1.05、opacity 0.7→1，幅度克制、贴近
     Codex 启动的呼吸质感；正弦型缓动 + 关键帧零速起收，循环无速度突
     变。每帧都带 translateZ，呼吸稳定留在合成器线程，不掉帧。 */
  @keyframes logo-breathe {
    0%, 100% { transform: translateZ(0) scale(1);    opacity: 0.7; }
    50%      { transform: translateZ(0) scale(1.05); opacity: 1; }
  }

  /* 尊重系统“减弱动态效果”：只停呼吸动画；退出淡出是功能性过渡，
     保持可用，避免系统开启该选项时退出变成瞬间切换。 */
  @media (prefers-reduced-motion: reduce) {
    .splash-logo { animation: none !important; opacity: 1 !important; }
    .card { opacity: 1 !important; }
  }
</style>
</head>
<body>
  <div class="card">
    <div class="splash">
      <img class="splash-logo" src="${WHALE_PNG_DATA_URL}" alt="DeepSeek" draggable="false">
    </div>
  </div>
  <script>
    (function () {
      // 跟随主程序（dsh GUI）主题：force-dark / force-light / system
      var htmlEl = document.documentElement;
      window.__setTheme = function (theme) {
        htmlEl.classList.remove('force-dark', 'force-light');
        if (theme === 'dark') htmlEl.classList.add('force-dark');
        else if (theme === 'light') htmlEl.classList.add('force-light');
      };
      // 退出“呼吸不停，整层淡出，淡入主界面”：
      // 1) 只摘掉底色层的 enter 动画（forwards 填充会压住后续的内联过渡，
      //    必须先转成内联样式）——logo 与辉光的呼吸不冻结、不打断；
      // 2) 底色层 ${SPLASH_EXIT_MS}ms 正弦缓动淡出，仍在呼吸的 logo 随层
      //    一起消失，主界面从后面透出，淡出本身就是最后一口呼吸；
      // 3) ${SPLASH_EXIT_MS}ms 全部结束，与主进程的 SPLASH_EXIT_MS 对齐。
      window.__exit = function () {
        var card = document.querySelector('.card');
        if (card !== null) {
          card.style.opacity = getComputedStyle(card).opacity;
          card.style.animation = 'none';
        }
        if (card !== null) {
          card.style.transition = 'opacity ${SPLASH_EXIT_MS}ms cubic-bezier(0.45, 0, 0.55, 1)';
          void card.offsetWidth;
          card.style.opacity = '0';
        }
        document.body.classList.add('exit');
      };
    })();
  </script>
</body>
</html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}