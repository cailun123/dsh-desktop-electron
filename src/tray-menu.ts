/**
 * Pure builder for the Codex-style tray context menu, kept out of `main.ts`
 * so the grouping/labeling rules are testable without Electron.
 *
 * Menu shape: Open Window, then a New Topic shortcut, then two data sections —
 * the topics whose agent is currently running, and the most recent topics —
 * each entry jumping straight into that conversation, then Quit. Section
 * headers are disabled items (Electron menus have no section primitives) and
 * empty sections show an explanatory disabled row instead of collapsing, so
 * the menu layout never jumps between polls.
 */

import { relativeAge, sessionTopicLabel } from './sessions.ts'
import type { SessionSummary } from './sessions.ts'

/** Topics shown in the tray's running section. */
export const TRAY_RUNNING_LIMIT = 5
/** Topics shown in the tray's recent section. */
export const TRAY_RECENT_LIMIT = 8

/**
 * Menu language. The harness GUI ships exactly two locales (`zh`, `en`), so
 * the tray mirrors that pair: the shell's language follows dsh's
 * `locale.preference` when set, and the system locale otherwise.
 */
export type TrayLang = 'en' | 'zh'

/** All user-visible tray strings, for the two languages dsh ships. */
export interface TrayMenuTexts {
  openWindow: string
  newTopic: string
  running: string
  noRunning: string
  recentTopics: string
  noRecent: string
  quit: string
  untitled: string
  /** Tooltip suffix while agents are live, e.g. "2 running". */
  runningTooltip: (count: number) => string
}

const TRAY_TEXTS: Record<TrayLang, TrayMenuTexts> = {
  en: {
    openWindow: 'Open Window',
    newTopic: 'New Topic',
    running: 'Running',
    noRunning: 'No running topics',
    recentTopics: 'Recent Topics',
    noRecent: 'No recent topics',
    quit: 'Quit',
    untitled: 'Untitled',
    runningTooltip: (count) => `${String(count)} running`,
  },
  zh: {
    openWindow: '打开主窗口',
    newTopic: '新话题',
    running: '正在运行',
    noRunning: '暂无运行中的话题',
    recentTopics: '最近话题',
    noRecent: '暂无最近话题',
    quit: '退出',
    untitled: '未命名话题',
    runningTooltip: (count) => `${String(count)} 个话题运行中`,
  },
}

export function trayMenuTexts(lang: TrayLang): TrayMenuTexts {
  return TRAY_TEXTS[lang]
}

/**
 * Pick the tray language: dsh's own `locale.preference` when the settings
 * document carries one (the tray should match the GUI the user configured),
 * otherwise the system locale. The harness ships only Chinese and English, so
 * any non-Chinese preference lands on English.
 */
export function resolveTrayLanguage(settingsText: string | undefined, systemLocale: string): TrayLang {
  const preference = settingsText === undefined ? undefined : /^\s*preference\s*:\s*"?([A-Za-z-]+)"?/m.exec(localeBlock(settingsText))?.[1]
  const effective = (preference ?? systemLocale).toLowerCase()
  return effective.startsWith('zh') ? 'zh' : 'en'
}

/**
 * The `locale:` top-level block of dsh's settings.yaml, or empty text. The
 * block runs to the next non-indented line, matching how dsh's layered
 * settings treat top-level namespaces.
 */
function localeBlock(settingsText: string): string {
  const match = /^locale:\s*$/m.exec(settingsText)
  if (match === null) return ''
  const rest = settingsText.slice(match.index + match[0].length)
  const end = /\n\S/.exec(rest)
  return end === null ? rest : rest.slice(0, end.index + 1)
}

/** Actions the menu entries dispatch to, owned by the Electron layer. */
export interface TrayMenuActions {
  openWindow: () => void
  newTopic: () => void
  focusSession: (session: SessionSummary) => void
  quit: () => void
}

/**
 * Build the menu template. Running topics lead (most recent first); the
 * recent section drops running ones (already listed above) and blank ones (a
 * session with no messages is not a topic yet).
 */
export function trayMenuTemplate(
  summaries: readonly SessionSummary[],
  actions: TrayMenuActions,
  now: number,
  lang: TrayLang = 'en',
): Array<Record<string, unknown>> {
  const texts = trayMenuTexts(lang)
  const byRecency = (a: SessionSummary, b: SessionSummary): number => b.updatedAt - a.updatedAt
  const running = summaries.filter((session) => session.running).sort(byRecency).slice(0, TRAY_RUNNING_LIMIT)
  const recent = summaries
    .filter((session) => !session.running && !session.blank)
    .sort(byRecency)
    .slice(0, TRAY_RECENT_LIMIT)
  const runningItems: Array<Record<string, unknown>> = running.length === 0
    ? [{ label: texts.noRunning, enabled: false }]
    : running.map((session) => ({
      label: `\u25CF ${sessionTopicLabel(session, { untitled: texts.untitled })}`,
      click: () => { actions.focusSession(session) },
    }))
  const recentItems: Array<Record<string, unknown>> = recent.length === 0
    ? [{ label: texts.noRecent, enabled: false }]
    : recent.map((session) => ({
      label: `${sessionTopicLabel(session, { untitled: texts.untitled })} (${relativeAge(session.updatedAt, now)})`,
      click: () => { actions.focusSession(session) },
    }))
  return [
    { label: texts.openWindow, click: actions.openWindow },
    { type: 'separator' },
    { label: texts.newTopic, click: actions.newTopic },
    { type: 'separator' },
    { label: texts.running, enabled: false },
    ...runningItems,
    { type: 'separator' },
    { label: texts.recentTopics, enabled: false },
    ...recentItems,
    { type: 'separator' },
    { label: texts.quit, click: actions.quit },
  ]
}

/**
 * The tray tooltip: the plain title when idle, a localized running count
 * while any agent is live — the same summary Codex surfaces in its tray.
 */
export function trayTooltip(base: string, runningCount: number, lang: TrayLang = 'en'): string {
  if (runningCount <= 0) return base
  return `${base} — ${trayMenuTexts(lang).runningTooltip(runningCount)}`
}
