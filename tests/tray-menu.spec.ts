import { describe, expect, it } from 'vitest'
import { resolveTrayLanguage, trayMenuTemplate, trayMenuTexts, trayTooltip, TRAY_RECENT_LIMIT, TRAY_RUNNING_LIMIT } from '../src/tray-menu.ts'
import type { SessionSummary } from '../src/sessions.ts'

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: 's-1',
    updatedAt: 1_000,
    running: false,
    blank: false,
    title: 'Fix the login flow',
    ...overrides,
  }
}

const ACTIONS = {
  openWindow: () => {},
  newTopic: () => {},
  focusSession: () => {},
  quit: () => {},
}

const NOW = 1_000_000

describe('trayMenuTemplate', () => {
  it('keeps the shell actions around the two topic sections', () => {
    const labels = trayMenuTemplate([], ACTIONS, NOW).map((entry) => entry.label)
    expect(labels).toEqual([
      'Open Window',
      undefined,
      'New Topic',
      undefined,
      'Running',
      'No running topics',
      undefined,
      'Recent Topics',
      'No recent topics',
      undefined,
      'Quit',
    ])
  })

  it('lists running topics first with the running glyph, recents below with ages', () => {
    const summaries = [
      session({ sessionId: 'idle', updatedAt: NOW - 120_000, title: 'Idle topic' }),
      session({ sessionId: 'run', updatedAt: NOW - 30_000, running: true, title: 'Busy topic' }),
      session({ sessionId: 'fresh-blank', updatedAt: NOW - 10_000, blank: true, title: 'Empty' }),
    ]
    const template = trayMenuTemplate(summaries, ACTIONS, NOW)
    const runningIndex = template.findIndex((entry) => entry.label === 'Running')
    const recentIndex = template.findIndex((entry) => entry.label === 'Recent Topics')
    // Each section body sits between its header and the trailing separator.
    const between = template.slice(runningIndex + 1, recentIndex - 1).map((entry) => entry.label)
    const after = template.slice(recentIndex + 1, template.length - 2).map((entry) => entry.label)
    expect(between).toEqual(['\u25CF Busy topic'])
    expect(after).toEqual(['Idle topic (2m)'])
  })

  it('caps each section and orders both by recency', () => {
    const summaries = Array.from({ length: 10 }, (_, index) => session({
      sessionId: `run-${String(index)}`,
      updatedAt: NOW - index * 1000,
      running: true,
      title: `Run ${String(index)}`,
    }))
    const template = trayMenuTemplate(summaries, ACTIONS, NOW)
    const runningIndex = template.findIndex((entry) => entry.label === 'Running')
    const recentIndex = template.findIndex((entry) => entry.label === 'Recent Topics')
    const running = template.slice(runningIndex + 1, recentIndex - 1)
    expect(running).toHaveLength(TRAY_RUNNING_LIMIT)
    expect(running[0]?.label).toBe('\u25CF Run 0')
    // Running topics overflow: the newest non-running slots stay empty rather
    // than duplicating the running section.
    expect(template.slice(recentIndex + 1, template.length - 2)[0]?.label).toBe('No recent topics')
  })

  it('fills the recent section up to its limit with the oldest dropped first', () => {
    const summaries = Array.from({ length: TRAY_RECENT_LIMIT + 2 }, (_, index) => session({
      sessionId: `t-${String(index)}`,
      updatedAt: NOW - index * 60_000,
      title: `Topic ${String(index)}`,
    }))
    const template = trayMenuTemplate(summaries, ACTIONS, NOW)
    const recentIndex = template.findIndex((entry) => entry.label === 'Recent Topics')
    const recent = template.slice(recentIndex + 1, template.length - 2)
    expect(recent).toHaveLength(TRAY_RECENT_LIMIT)
    expect(recent[0]?.label).toContain('Topic 0')
    expect(recent.at(-1)?.label).toContain(`Topic ${String(TRAY_RECENT_LIMIT - 1)}`)
  })

  it('dispatches focusSession to the matching topic entry', () => {
    const focused: string[] = []
    const template = trayMenuTemplate([session({ sessionId: 's-9', updatedAt: NOW - 5_000, title: 'Click me' })], {
      ...ACTIONS,
      focusSession: (target) => { focused.push(target.sessionId) },
    }, NOW)
    const entry = template.find((item) => item.label === 'Click me (now)')
    ;(entry?.click as () => void)()
    expect(focused).toEqual(['s-9'])
  })

  it('localizes every label into Chinese for the zh language', () => {
    const labels = trayMenuTemplate([
      session({ sessionId: 'run', running: true, updatedAt: NOW - 30_000, title: '重构登录' }),
      session({ sessionId: 'idle', updatedAt: NOW - 120_000, title: '闲置话题' }),
    ], ACTIONS, NOW, 'zh').map((entry) => entry.label)
    expect(labels).toEqual([
      '打开主窗口',
      undefined,
      '新话题',
      undefined,
      '正在运行',
      '\u25CF 重构登录',
      undefined,
      '最近话题',
      '闲置话题 (2m)',
      undefined,
      '退出',
    ])
  })

  it('localizes the untitled fallback for sessions without a title', () => {
    const template = trayMenuTemplate([session({ sessionId: 'no-title', updatedAt: NOW - 5_000, title: undefined, cwd: 'D:\\work\\app' })], ACTIONS, NOW, 'zh')
    expect(template.find((entry) => typeof entry.label === 'string' && entry.label.includes('app'))?.label).toBe('app (now)')
  })
})

describe('resolveTrayLanguage', () => {
  it('follows dsh locale.preference when the settings document carries one', () => {
    const settings = 'locale:\n  preference: zh\nother:\n  preference: en\n'
    expect(resolveTrayLanguage(settings, 'en-US')).toBe('zh')
    expect(resolveTrayLanguage('locale:\n  preference: "en"\n', 'zh-CN')).toBe('en')
  })

  it('ignores preference fields outside the top-level locale block', () => {
    expect(resolveTrayLanguage('ui-theme:\n  preference: dark\nother:\n  preference: zh\n', 'en-US')).toBe('en')
  })

  it('falls back to the system locale and lands on en for other languages', () => {
    expect(resolveTrayLanguage(undefined, 'zh-CN')).toBe('zh')
    expect(resolveTrayLanguage('', 'ja-JP')).toBe('en')
    expect(resolveTrayLanguage('locale:\n  preference: fr\n', 'fr-FR')).toBe('en')
  })
})

describe('trayTooltip', () => {
  it('reports the running count only while agents are live, in both languages', () => {
    expect(trayTooltip('DeepSeek Harness', 0)).toBe('DeepSeek Harness')
    expect(trayTooltip('DeepSeek Harness', 2)).toBe('DeepSeek Harness — 2 running')
    expect(trayTooltip('DeepSeek Harness', 2, 'zh')).toBe('DeepSeek Harness — 2 个话题运行中')
    expect(trayTooltip('DeepSeek Harness', 2, trayMenuTexts('zh') && 'zh')).toBe('DeepSeek Harness — 2 个话题运行中')
  })
})
