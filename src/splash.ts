/**
 * Startup splash: the animated boot stage of the Desktop window, played on a
 * `WebContentsView` layered *above* the window's own webContents. The window
 * opens instantly with the animation filling it; the real GUI loads behind
 * the splash, hidden, and the splash hands off only once the GUI's main
 * interface has actually rendered (`main.ts` polls for `#root`/boot-card
 * readiness) and the minimum play time has elapsed — so the user never sees
 * dsh's own boot spinner and the animation ends exactly at the main UI.
 *
 * The visual is the official DeepSeek Harness identity over a flat
 * monochrome surface: the centered whale enters with the official Harness
 * hero animation (`ds-hero-enter`: rise + de-blur, deepseek.com/harness) and
 * then breathes (a gentle scale/opacity swell on a 2.8s cycle); beneath it
 * the official wordmark lockup ("deepseek" + the HARNESS chip, vector paths
 * lifted from the app header) holds the identity while the boot runs — the
 * load always reads as ongoing. No progress bar widgets, no spinner — the
 * breath and the official wordmark are the design.
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
 * Exit hand-off duration in ms. The window opens the exit sequence with
 * `__exit()` and waits this long before removing the splash view, so the
 * main process's timer and the page stay in lockstep. The page runs the
 * official hand-off inside that budget: the wordmark exits with a
 * reverse rise + blur (320ms), the GUI hero title 探索未至之境 enters with
 * ds-hero-enter (0.7s), and after a short beat the whole layer fades out on
 * a gentle sine ease (700ms) — the GUI appears to fade in. Nothing is frozen
 * mid-pose: the fade itself is the last beat of the sequence.
 */
export const SPLASH_EXIT_MS = 2200

/** Breathing pulse period (ms) for the logo. */
export const SPLASH_BREATHE_MS = 2800

/**
 * Minimum time the splash plays before the hand-off to the GUI, so the intro
 * is always seen in full even when the server and the GUI frontend become
 * ready faster. When the GUI is slower, the breathing simply keeps going
 * until it is actually ready. Lives here rather than in `main.ts` so
 * the app, the offline preview and the tests share one timeline.
 */
export const SPLASH_MIN_MS = 3800

/**
 * Brief beat before the exit transition starts, so the lockup is seen a
 * moment more right as the hand-off begins.
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


/**
 * 官方字标矢量数据：DeepSeek Harness 应用头部 lockup（GUI 前端资源）中的
 * "deepseek" 字母与 HARNESS 徽章路径，原样提取。8 个揭示槽位（k 字母由
 * 两条子路径组成，占一个槽位）+ 徽章整体，构成打字进度条的 9 个进度单元。
 */
const WORDMARK_SLOTS: string[][] = [
  ['M31.9551 8.03497H33.3204V10.1525H31.9551C31.1087 10.1525 30.2545 10.3633 29.7035 10.9493C29.1525 11.5353 28.945 12.4342 28.945 13.3326C28.945 14.231 29.1447 15.1294 29.7035 15.7154C30.2623 16.3014 31.1087 16.5122 31.9551 16.5122C32.8015 16.5122 33.6562 16.3014 34.2072 15.7154C34.7582 15.1294 34.9657 14.231 34.9657 13.3326V4.62842H37.3611V18.6219H34.9657V17.7313H34.5264C34.4783 17.7857 34.4307 17.8329 34.3826 17.8795C33.7835 18.4261 32.8652 18.6219 31.9629 18.6219C30.5494 18.6219 29.136 18.2707 28.2099 17.294C27.2838 16.3174 26.9563 14.817 26.9563 13.3248C26.9563 11.8327 27.2916 10.34 28.2099 9.35561C29.136 8.37898 30.5494 8.03497 31.9551 8.03497Z'],
  ['M49.3786 13.1431V13.9948H42.9984V12.2996H47.2305C47.1348 11.6825 46.9113 11.1043 46.5119 10.682C45.9371 10.0727 45.0503 9.85409 44.1723 9.85409C43.2943 9.85409 42.4076 10.0727 41.8328 10.682C41.258 11.2913 41.05 12.2213 41.05 13.1435C41.05 14.0658 41.2575 15.003 41.8328 15.6046C42.4076 16.2061 43.2939 16.433 44.1723 16.433C45.0508 16.433 45.9371 16.2143 46.5119 15.6046C46.5916 15.5186 46.6635 15.4248 46.7354 15.331H49.0992C48.8918 16.0657 48.5643 16.7299 48.0691 17.2454C47.111 18.2531 45.6339 18.6205 44.1723 18.6205C42.7108 18.6205 41.2337 18.2609 40.2755 17.2454C39.3174 16.2299 38.9661 14.6828 38.9661 13.1435C38.9661 11.6043 39.3096 10.0494 40.2755 9.04168C41.242 8.03396 42.7108 7.66663 44.1723 7.66663C45.6339 7.66663 47.111 8.02618 48.0691 9.04168C49.0351 10.0572 49.3786 11.6043 49.3786 13.1435V13.1431Z'],
  ['M61.4045 13.1431V13.9948H55.0243V12.2996H59.2564C59.1602 11.6825 58.9372 11.1043 58.5378 10.682C57.963 10.0727 57.0762 9.85409 56.1982 9.85409C55.3202 9.85409 54.4335 10.0727 53.8587 10.682C53.2839 11.2913 53.0759 12.2213 53.0759 13.1435C53.0759 14.0658 53.2834 15.003 53.8587 15.6046C54.4335 16.2061 55.3202 16.433 56.1982 16.433C57.0762 16.433 57.963 16.2143 58.5378 15.6046C58.6179 15.5186 58.6894 15.4248 58.7608 15.331H61.1251C60.9171 16.0657 60.5897 16.7299 60.0945 17.2454C59.1364 18.2531 57.6593 18.6205 56.1982 18.6205C54.7372 18.6205 53.2596 18.2609 52.3014 17.2454C51.3432 16.2299 50.9919 14.6828 50.9919 13.1435C50.9919 11.6043 51.3355 10.0494 52.3014 9.04168C53.2678 8.03396 54.7367 7.66663 56.1982 7.66663C57.6598 7.66663 59.1364 8.02618 60.0945 9.04168C61.061 10.0572 61.4045 11.6043 61.4045 13.1435V13.1431Z'],
  ['M68.416 18.2447H67.0501V16.1272H68.416C69.2619 16.1272 70.1166 15.9163 70.6671 15.3304C71.2181 14.7444 71.426 13.8455 71.426 12.9471C71.426 12.0487 71.2268 11.1498 70.6671 10.5643C70.1083 9.97831 69.2619 9.76744 68.416 9.76744C67.5701 9.76744 66.7154 9.97831 66.1639 10.5643C65.6129 11.1503 65.4049 12.0487 65.4049 12.9471V21.6435H63.009V7.6582H65.4049V8.54883H65.8442C65.8918 8.49393 65.9394 8.44728 65.9875 8.40064C66.5871 7.85353 67.5049 7.6582 68.4072 7.6582C69.8212 7.6582 71.2341 8.00998 72.1607 8.98662C73.0868 9.96325 73.4143 11.4632 73.4143 12.9558C73.4143 14.4485 73.0785 15.9406 72.1607 16.925C71.2424 17.9094 69.8212 18.2457 68.416 18.2457V18.2447Z'],
  ['M80.242 18.6214C81.7035 18.6214 83.1801 18.4105 84.1383 17.809C85.0965 17.2075 85.4482 16.2931 85.4482 15.3869C85.4482 14.4807 85.1042 13.5585 84.1383 12.9647C83.1801 12.371 81.703 12.1518 80.242 12.1518C79.6186 12.1518 79.0438 12.0658 78.6366 11.8394C78.2294 11.6047 78.0778 11.2534 78.0778 10.9017C78.0778 10.5499 78.2216 10.1908 78.6366 9.9639C79.0438 9.72921 79.6749 9.65147 80.2973 9.65147C80.9198 9.65147 81.5509 9.73747 81.9591 9.9639C82.3663 10.1986 82.5179 10.5499 82.5179 10.9017H84.9531C84.9531 9.99499 84.6421 9.07327 83.7719 8.47951C82.9017 7.88576 81.5679 7.66663 80.2424 7.66663C78.9169 7.66663 77.5837 7.8775 76.713 8.47951C75.8427 9.08104 75.5308 9.99499 75.5308 10.9017C75.5308 11.8083 75.8423 12.73 76.713 13.3238C77.5832 13.9176 78.9165 14.1367 80.2424 14.1367C80.929 14.1367 81.688 14.2227 82.1428 14.4491C82.5985 14.676 82.7579 15.0351 82.7579 15.3869C82.7579 15.7387 82.5985 16.0977 82.1428 16.3246C81.688 16.5511 80.9931 16.6371 80.3066 16.6371C79.62 16.6371 78.9169 16.5511 78.4694 16.3246C78.0224 16.0982 77.8543 15.7387 77.8543 15.3869H75.0435C75.0435 16.2935 75.3865 17.2153 76.3534 17.809C77.3194 18.4028 78.7809 18.6214 80.2424 18.6214H80.242Z'],
  ['M97.4733 13.1431V13.9948H91.0932V12.2996H95.3252C95.23 11.6825 95.006 11.1043 94.6071 10.682C94.0313 10.0727 93.1456 9.85409 92.2666 9.85409C91.3876 9.85409 90.5018 10.0727 89.927 10.682C89.3522 11.2913 89.1452 12.2213 89.1452 13.1435C89.1452 14.0658 89.3522 15.003 89.927 15.6046C90.5018 16.2061 91.3886 16.433 92.2666 16.433C93.1446 16.433 94.0313 16.2143 94.6071 15.6046C94.6863 15.5186 94.7587 15.4248 94.8301 15.331H97.1935C96.9855 16.0657 96.6585 16.7299 96.1639 17.2454C95.2057 18.2531 93.7281 18.6205 92.2666 18.6205C90.805 18.6205 89.3284 18.2609 88.3703 17.2454C87.4121 16.2299 87.0613 14.6828 87.0613 13.1435C87.0613 11.6043 87.4043 10.0494 88.3703 9.04168C89.3367 8.03396 90.806 7.66663 92.2666 7.66663C93.7272 7.66663 95.2057 8.02618 96.1639 9.04168C97.1298 10.0572 97.4729 11.6043 97.4729 13.1435L97.4733 13.1431Z'],
  ['M109.499 13.1431V13.9948H103.119V12.2996H107.351C107.256 11.6825 107.032 11.1043 106.632 10.682C106.057 10.0727 105.172 9.85409 104.293 9.85409C103.414 9.85409 102.528 10.0727 101.953 10.682C101.378 11.2913 101.17 12.2213 101.17 13.1435C101.17 14.0658 101.378 15.003 101.953 15.6046C102.528 16.2061 103.415 16.433 104.293 16.433C105.171 16.433 106.057 16.2143 106.632 15.6046C106.712 15.5186 106.784 15.4248 106.856 15.331H109.22C109.012 16.0657 108.685 16.7299 108.19 17.2454C107.231 18.2531 105.754 18.6205 104.293 18.6205C102.831 18.6205 101.355 18.2609 100.396 17.2454C99.4382 16.2299 99.0864 14.6828 99.0864 13.1435C99.0864 11.6043 99.4295 10.0494 100.396 9.04168C101.362 8.03396 102.832 7.66663 104.293 7.66663C105.754 7.66663 107.231 8.02618 108.19 9.04168C109.156 10.0572 109.499 11.6043 109.499 13.1435V13.1431Z'],
  [
    'M113.5 4.62817H111.104V18.6217H113.5V4.62817Z',
    'M117.589 12.8154L121.517 18.6208H118.554L114.625 12.8154L118.554 8.15088H121.517L117.589 12.8154Z',
  ],
]

/** HARNESS 徽章：官方 lockup 中的反白胶囊（墨色胶囊 + 页面底色文字）。 */
const WORDMARK_BADGE = {
  rect: {"x":129.348,"y":5.5,"width":52,"height":14,"rx":2},
  letters: [
    'M132.848 8.93205H134.08V16.137H132.848V8.93205ZM136.5 8.93205H137.732V16.137H136.5V8.93205ZM133.365 13.024V11.99H137.193V13.024H133.365Z',
    'M140.397 14.432L140.672 13.453H143.202L143.532 14.432H140.397ZM140.287 16.137H139.055L141.277 8.93205H142.201L142.146 9.74605L140.947 13.915H140.969L140.287 16.137ZM145.039 16.137H143.741L143.07 13.948L143.081 13.937L141.871 9.74605L141.926 8.93205H142.817L145.039 16.137Z',
    'M146.846 8.93205H149.068C149.852 8.93205 150.443 9.11538 150.839 9.48205C151.235 9.84138 151.433 10.3327 151.433 10.956C151.433 11.22 151.396 11.4657 151.323 11.693C151.249 11.9204 151.125 12.1257 150.949 12.309C150.773 12.4924 150.531 12.65 150.223 12.782C149.922 12.9067 149.541 13.0057 149.079 13.079V13.321H146.846V12.639L148.023 12.485C148.631 12.4044 149.09 12.298 149.398 12.166C149.706 12.034 149.915 11.8764 150.025 11.693C150.135 11.5024 150.19 11.2934 150.19 11.066C150.19 10.6994 150.083 10.417 149.871 10.219C149.658 10.021 149.324 9.92205 148.87 9.92205H146.846V8.93205ZM146.395 8.93205H147.627V16.137H146.395V8.93205ZM151.917 16.093V16.137H150.366L149.024 14.322C148.87 14.1094 148.73 13.9407 148.606 13.816C148.481 13.684 148.345 13.5887 148.199 13.53C148.052 13.464 147.872 13.42 147.66 13.398C147.447 13.3687 147.176 13.3504 146.846 13.343V13.145H149.079C149.233 13.211 149.368 13.2844 149.486 13.365C149.61 13.4457 149.735 13.5447 149.86 13.662C149.992 13.7794 150.138 13.937 150.3 14.135L151.917 16.093Z',
    'M153.58 9.57005L153.591 8.93205H154.46L157.584 15.51V16.137H156.704L153.58 9.57005ZM158.024 16.137H156.968L156.88 8.93205H158.024V16.137ZM154.24 16.137H153.096V8.93205H154.152L154.24 16.137Z',
    'M159.963 8.93205H161.206V16.137H159.963V8.93205ZM160.095 9.96605V8.93205H164.858V9.96605H160.095ZM160.095 16.137V15.103H164.902V16.137H160.095ZM160.095 13.013V11.99H164.374V13.013H160.095Z',
    'M169.052 15.257C169.543 15.257 169.895 15.1654 170.108 14.982C170.328 14.7987 170.438 14.5457 170.438 14.223C170.438 14.047 170.405 13.8967 170.339 13.772C170.273 13.6474 170.152 13.5337 169.976 13.431C169.807 13.321 169.558 13.2147 169.228 13.112L168.491 12.881C167.846 12.6757 167.38 12.4044 167.094 12.067C166.808 11.7297 166.665 11.3007 166.665 10.78C166.665 10.428 166.76 10.1017 166.951 9.80105C167.142 9.50038 167.428 9.25838 167.809 9.07505C168.19 8.89172 168.663 8.80005 169.228 8.80005C169.631 8.80005 169.998 8.82938 170.328 8.88805C170.665 8.93938 171.039 9.01638 171.45 9.11905L171.274 10.175C170.834 10.0504 170.442 9.96238 170.097 9.91105C169.76 9.85238 169.463 9.82305 169.206 9.82305C168.737 9.82305 168.403 9.90738 168.205 10.076C168.007 10.2374 167.908 10.439 167.908 10.681C167.908 10.857 167.941 11.0147 168.007 11.154C168.073 11.286 168.19 11.407 168.359 11.517C168.535 11.627 168.784 11.7334 169.107 11.836L169.866 12.078C170.526 12.276 170.995 12.5327 171.274 12.848C171.553 13.156 171.692 13.585 171.692 14.135C171.692 14.5604 171.589 14.9344 171.384 15.257C171.179 15.5797 170.878 15.8327 170.482 16.016C170.093 16.1994 169.609 16.291 169.03 16.291C168.627 16.291 168.212 16.247 167.787 16.159C167.362 16.071 166.9 15.9427 166.401 15.774L166.665 14.718C167.156 14.894 167.6 15.0297 167.996 15.125C168.399 15.213 168.751 15.257 169.052 15.257Z',
    'M175.809 15.257C176.3 15.257 176.652 15.1654 176.865 14.982C177.085 14.7987 177.195 14.5457 177.195 14.223C177.195 14.047 177.162 13.8967 177.096 13.772C177.03 13.6474 176.909 13.5337 176.733 13.431C176.564 13.321 176.315 13.2147 175.985 13.112L175.248 12.881C174.603 12.6757 174.137 12.4044 173.851 12.067C173.565 11.7297 173.422 11.3007 173.422 10.78C173.422 10.428 173.517 10.1017 173.708 9.80105C173.899 9.50038 174.185 9.25838 174.566 9.07505C174.947 8.89172 175.42 8.80005 175.985 8.80005C176.388 8.80005 176.755 8.82938 177.085 8.88805C177.422 8.93938 177.796 9.01638 178.207 9.11905L178.031 10.175C177.591 10.0504 177.199 9.96238 176.854 9.91105C176.517 9.85238 176.22 9.82305 175.963 9.82305C175.494 9.82305 175.16 9.90738 174.962 10.076C174.764 10.2374 174.665 10.439 174.665 10.681C174.665 10.857 174.698 11.0147 174.764 11.154C174.83 11.286 174.947 11.407 175.116 11.517C175.292 11.627 175.541 11.7334 175.864 11.836L176.623 12.078C177.283 12.276 177.752 12.5327 178.031 12.848C178.31 13.156 178.449 13.585 178.449 14.135C178.449 14.5604 178.346 14.9344 178.141 15.257C177.936 15.5797 177.635 15.8327 177.239 16.016C176.85 16.1994 176.366 16.291 175.787 16.291C175.384 16.291 174.969 16.247 174.544 16.159C174.119 16.071 173.657 15.9427 173.158 15.774L173.422 14.718C173.913 14.894 174.357 15.0297 174.753 15.125C175.156 15.213 175.508 15.257 175.809 15.257Z',
  ],
}


/** 字标 SVG 视口（官方 lockup 的字标 + 徽章区域，留 1.5 边距）。 */
const WORDMARK_VIEW_BOX = '25.46 3.4 155.99 18.3'

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
 * Fade the splash page out (the page freezes the card pose and fades the
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
 * Build the splash page: a flat monochrome surface with the breathing whale
 * logo at its center, the official wordmark beneath it — and nothing else. When `initialTheme` is given the
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
  // Official wordmark: whale excluded (the breathing PNG plays above), the
  // "deepseek" letters and the HARNESS badge render whole.
  const letterPaths = WORDMARK_SLOTS.map((paths) => paths.map((d) => `<path d="${d}"/>`).join('')).join('')
  // HARNESS badge: the official inverted chip — ink capsule, page-color text.
  const badge = `<rect x="${WORDMARK_BADGE.rect.x}" y="${WORDMARK_BADGE.rect.y}" width="${WORDMARK_BADGE.rect.width}" height="${WORDMARK_BADGE.rect.height}" rx="${WORDMARK_BADGE.rect.rx}"/>`
    + `<g class="type-badge-text">${WORDMARK_BADGE.letters.map((d) => `<path d="${d}"/>`).join('')}</g>`
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
    --type: rgba(0, 0, 0, 0.65);
    --title: rgb(15, 17, 21);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: ${SPLASH_BG_DARK};
      --logo-filter: brightness(0) invert(1);
      --type: hsla(0, 0%, 100%, 0.6);
      --title: hsla(0, 0%, 100%, 0.92);
    }
  }

  /* 强制主题（跟随 dsh GUI 的外观设置）：html.force-dark / html.force-light
     覆盖系统 prefers-color-scheme，优先级高于 :root 与媒体查询 */
  html.force-dark {
    color-scheme: dark;
    --bg: ${SPLASH_BG_DARK};
    --logo-filter: brightness(0) invert(1);
    --type: hsla(0, 0%, 100%, 0.6);
      --title: hsla(0, 0%, 100%, 0.92);
  }
  html.force-light {
    color-scheme: light;
    --bg: ${SPLASH_BG_LIGHT};
    --logo-filter: brightness(0);
    --type: rgba(0, 0, 0, 0.65);
    --title: rgb(15, 17, 21);
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

  /* 舞台：两阶段绝对定位。阶段一只有字标（辉光扫过）；交接时鲸鱼 + 标题
     出现——互不挤占布局，无跳动。 */
  .splash {
    position: absolute; inset: 0;
    transform: translateZ(0);
  }
  /* 鲸鱼：初始隐藏（opacity 0），交接时以官方主块参数入场（上浮 24px +
     10px 模糊，0.9s），落定接呼吸循环。定位在字标正上方 12px 处。 */
  .splash-logo {
    position: absolute;
    top: calc(50% - 109px); left: calc(50% - 38px);
    width: 76px; height: 76px;
    filter: var(--logo-filter);
    transform: translateZ(0);
    will-change: transform, opacity;
    opacity: 0;
    --enter-y: 24px;
    --enter-blur: 10px;
    --enter-filter: var(--logo-filter);
    --enter-to: 0.7;
  }
  .splash-logo.is-in {
    animation:
      ds-hero-enter 0.9s ease-out backwards,
      logo-breathe 2.8s cubic-bezier(0.37, 0, 0.63, 1) 0.9s infinite;
  }

  /* 官网 ds-hero-enter 原样移植（deepseek.com/harness 的 hero 入场系统），
     仅两处适配：transform 保留 translateZ 维持合成层；终点透明度与 blur
     归零后的滤镜链通过自定义属性按元素解析（logo 回呼吸波谷，字标条回
     全亮）。 */
  @keyframes ds-hero-enter {
    0% {
      opacity: 0;
      transform: translateY(var(--enter-y, 20px)) translateZ(0);
      filter: var(--enter-filter, opacity(1)) blur(var(--enter-blur, 0px));
    }
    to {
      opacity: var(--enter-to, 1);
      transform: translateY(0) translateZ(0);
      filter: var(--enter-filter, opacity(1)) blur(0);
    }
  }

  /* 呼吸：logo 2.8s 内 scale 1→1.05、opacity 0.7→1，幅度克制；正弦型缓动
     + 关键帧零速起收，循环无速度突变。每帧都带 translateZ，呼吸稳定留在
     合成器线程。入场终点（0.9s）即呼吸 0% 状态，交接无跳变。 */
  @keyframes logo-breathe {
    0%, 100% { transform: translateZ(0) scale(1);    opacity: 0.7; }
    50%      { transform: translateZ(0) scale(1.05); opacity: 1; }
  }

  /* 官方字标：应用头部 lockup 的 "deepseek HARNESS" 矢量路径整体呈现。 */
  /* 字标容器：绝对居中（字标高 42px → top = 50% - 21px）；交接标题覆盖
     在字标槽位上。 */
  .splash-lockup {
    position: absolute;
    top: calc(50% - 21px); left: 0; right: 0;
    display: flex; flex-direction: column; align-items: center;
  }
  .splash-type {
    height: 42px;
    fill: var(--type);
    /* 官网 ds-hero-enter 次块参数：上浮 16px、0.7s、延迟 0.15s。 */
    --enter-y: 16px;
    animation: ds-hero-enter 0.7s ease-out 0.15s backwards;
  }
  /* HARNESS 徽章：官方反白胶囊——墨色胶囊 + 页面底色文字。 */
  .type-badge-text { fill: var(--bg); }

  /* 辉光扫过：亮色副本整体裁剪进字标字形，一条柔光带周期性从左向右划
     过（扫 1.32s、歇 1.08s），加载中的呼吸感来自这里。只动 transform，
     留在合成器线程。 */
  .wm-shine-band {
    animation: shine-sweep 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  }
  @keyframes shine-sweep {
    0% { transform: translateX(0); }
    55% { transform: translateX(265px); }
    100% { transform: translateX(265px); }
  }

  /* 交接标题：加载完成时字标退场后，官方 Hero 的“探索未至之境”
     以 ds-hero-enter 入场（GUI 空态标题同款文案），中文字重用系统黑体栈。
     绝对定位覆盖在字标槽位上——标题与鲸鱼的间距和字标完全一致，交接时
     不产生额外空白。 */
  .splash-title {
    position: absolute; left: 0; right: 0; top: 4px;
    display: flex; align-items: center; justify-content: center; gap: 14px;
    opacity: 0;
  }
  .splash-title.is-in {
    --enter-y: 18px;
    --enter-blur: 8px;
    animation: ds-hero-enter 0.7s ease-out 0.15s both;
  }
  .title-text {
    /* 官方渲染参数：从运行中的 GUI 空态标题逐项读取（26px / 500 / 系统栈，
       字距 normal）。 */
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 26px;
    font-weight: 500;
    letter-spacing: normal;
    color: var(--title);
  }
  /* 尊重系统“减弱动态效果”：只停呼吸与入场动画；退出淡出是功能性过渡，
     保持可用，避免系统开启该选项时退出变成瞬间切换。 */
  @media (prefers-reduced-motion: reduce) {
    .splash-logo { animation: none !important; opacity: 1 !important; }
    /* 静态展示完整字标与加载点阵：信息仍在，动态全部停止（官方入场动画
       一并停用）。 */
    .splash-type { animation: none !important; }
    .card { opacity: 1 !important; }
  }
</style>
</head>
<body>
  <div class="card">
    <div class="splash">
      <img class="splash-logo" src="${WHALE_PNG_DATA_URL}" alt="DeepSeek" draggable="false">
      <div class="splash-lockup">
        <svg class="splash-type" viewBox="${WORDMARK_VIEW_BOX}" aria-hidden="true" focusable="false">
          <defs>
            <clipPath id="wm-clip">${letterPaths}${badge}</clipPath>
            <linearGradient id="wm-shine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stop-color="#ffffff" stop-opacity="0"/>
              <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.9"/>
              <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <g>${letterPaths}${badge}</g>
          <g clip-path="url(#wm-clip)"><rect class="wm-shine-band" x="-45" y="0" width="46" height="22" fill="url(#wm-shine)"/></g>
        </svg>
        <div class="splash-title" aria-hidden="true"><span class="title-text">探索未至之境</span></div>
      </div>
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
      // 退出交接“字标退场 → 鲸鱼 + 探索未至之境入场 → 整层淡出”：
      // 0) 摘掉底色层的 enter 动画（forwards 填充会压住后续的内联过渡，
      //    必须先转成内联样式）；
      // 1) 官方反向退场：字标上浮 + 模糊淡出（320ms ease-in）；
      // 2) 鲸鱼以官方主块参数入场（0.9s），“探索未至之境”以官方次块参数
      //    随后入场（0.7s + 0.15s 交错）；reduced-motion 下直接静态显示；
      // 3) 停顿后底色层 700ms 正弦淡出，主界面从后面透出；
      // 4) 320 + 900 + 280 停顿 + 700 淡出 = ${SPLASH_EXIT_MS}ms，与主进程
      //    的 SPLASH_EXIT_MS 对齐。
      window.__exit = function () {
        var card = document.querySelector('.card');
        var lockup = document.querySelector('.splash-type');
        var whale = document.querySelector('.splash-logo');
        var title = document.querySelector('.splash-title');
        var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (card !== null) {
          card.style.opacity = getComputedStyle(card).opacity;
          card.style.animation = 'none';
        }
        if (lockup !== null) {
          lockup.style.transition = 'opacity 320ms ease-in, transform 320ms ease-in, filter 320ms ease-in';
          void lockup.offsetWidth;
          lockup.style.opacity = '0';
          lockup.style.transform = 'translateY(-10px)';
          lockup.style.filter = 'blur(4px)';
        }
        setTimeout(function () {
          if (whale !== null) {
            if (reduced) { whale.style.opacity = '1'; }
            else { whale.classList.add('is-in'); }
          }
          if (title !== null) {
            if (reduced) { title.style.opacity = '1'; }
            else { title.classList.add('is-in'); }
          }
        }, 320);
        setTimeout(function () {
          if (card !== null) {
            card.style.transition = 'opacity 700ms cubic-bezier(0.45, 0, 0.55, 1)';
            void card.offsetWidth;
            card.style.opacity = '0';
          }
        }, 1500);
        document.body.classList.add('exit');
      };
    })();
  </script>
</body>
</html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}