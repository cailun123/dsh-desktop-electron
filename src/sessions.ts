/**
 * dsh web session ("topic") feed for the tray menu.
 *
 * The desktop shell is a shell: it does not read the harness's session store,
 * it asks the running `dsh web` server. The server exposes the same unary RPC
 * surface the web GUI uses — `POST /api/<endpoint>` with a JSON envelope —
 * discovered from the GUI's own client bundle, so the shell stays correct
 * across harness upgrades the same way it does for the readiness line:
 *
 *   request  { type: "client-request", rpcId, method: "session/list",
 *              payload: { args: { _request: {} } } }
 *   response { type: "server-response", rpcId, result: { ok: true, value } }
 *
 * The `/api` fence accepts browser-trust cookies only (the URL token is not
 * honored there), so the feed first exchanges the readiness token for the
 * `dsh-auth-*` cookie with a `GET /?token=…` and replays that cookie on every
 * RPC. Session summaries carry everything the tray needs: `running` (the
 * agent's live state, authoritative on the host), `updatedAt`, and the title
 * projection. Subagent child sessions are filtered so the menu lists topics.
 *
 * `session/list` has no archive flag, and the harness keeps an archived
 * session in its store (it only leaves the workspace's visible list), so the
 * feed also reads the workspace baseline — the first frame of the GUI's
 * `workspace/follow` stream over the `/api/remote.mux` WebSocket — and drops
 * sessions the user archived. That baseline needs the cookie on the WebSocket
 * upgrade, which the WHATWG `WebSocket` global cannot send; the `ws` client
 * can, so it is the one runtime dependency here.
 */

import WebSocket from 'ws'

/** One top-level session ("topic") as shown in the tray menu. */
export interface SessionSummary {
  sessionId: string
  updatedAt: number
  running: boolean
  /** No messages yet: excluded from the recent list, kept while running. */
  blank: boolean
  /** The session-title projection; undefined until the harness derives one. */
  title?: string
  /** The workspace directory the session runs in. */
  cwd?: string
}

/** The unary RPC endpoint that lists session summaries. */
export const SESSION_LIST_ENDPOINT = 'session/list'

/** The stream endpoint whose first frame carries the workspace baseline. */
export const WORKSPACE_FOLLOW_ENDPOINT = 'workspace/follow'

/**
 * Build the JSON body of one unary client request. Exported for tests; the
 * envelope shape is validated by the server (`gateway/bad-request` otherwise).
 */
export function unaryRequestBody(rpcId: string, endpoint: string, payload: unknown): string {
  return JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args: payload } })
}

/**
 * Parse one unary server response. Returns the `value` of a successful
 * result; throws on transport-level garbage and on application errors so the
 * caller can distinguish "no sessions" from "the RPC did not answer".
 */
export function parseUnaryResponse(text: string): unknown {
  const message: unknown = JSON.parse(text)
  if (typeof message !== 'object' || message === null) {
    throw new Error('dsh web: RPC response is not an object')
  }
  const record = message as Record<string, unknown>
  if (record.type !== 'server-response' || typeof record.rpcId !== 'string') {
    throw new Error('dsh web: RPC response is not a server-response envelope')
  }
  const result = record.result
  if (typeof result !== 'object' || result === null) {
    throw new Error('dsh web: RPC response has no result')
  }
  const { ok, value, error } = result as Record<string, unknown>
  if (ok === true) return value
  const code = typeof (error as Record<string, unknown> | undefined)?.code === 'string'
    ? (error as Record<string, unknown>).code
    : 'unknown'
  const detail = typeof (error as Record<string, unknown> | undefined)?.message === 'string'
    ? (error as Record<string, unknown>).message
    : ''
  throw new Error(`dsh web: RPC failed (${String(code)})${detail === '' ? '' : `: ${detail}`}`)
}

/**
 * Pick the `dsh-auth-*` cookie out of a `set-cookie` header list and return it
 * in `name=value` wire form. The server names the cookie per-installation, so
 * only the prefix is matched; anything else in the jar is ignored.
 */
export function extractAuthCookie(setCookie: readonly string[]): string | undefined {
  for (const header of setCookie) {
    const pair = header.split(';', 1)[0] ?? ''
    if (pair.startsWith('dsh-auth-') && pair.includes('=')) return pair
  }
  return undefined
}

/**
 * Parse the workspace baseline (the first `workspace/follow` frame's value)
 * into the set of archived session ids. Strict shape: a future harness that
 * reshapes the frame yields an error the caller surfaces as "no archive
 * information", never a silently empty archive set presented as truth.
 */
export function parseWorkspaceBaseline(value: unknown): Set<string> {
  if (typeof value !== 'object' || value === null) throw new Error('dsh web: workspace baseline is not an object')
  const record = value as Record<string, unknown>
  if (record.type !== 'baseline' || typeof record.value !== 'object' || record.value === null) {
    throw new Error('dsh web: workspace baseline frame is malformed')
  }
  const baseline = record.value as Record<string, unknown>
  if (!Array.isArray(baseline.archivedSessionIds)) {
    throw new Error('dsh web: workspace baseline has no archivedSessionIds')
  }
  const ids = new Set<string>()
  for (const id of baseline.archivedSessionIds) {
    if (typeof id === 'string' && id !== '') ids.add(id)
  }
  return ids
}

/** Drop archived sessions from tray summaries. */
export function filterArchived(summaries: readonly SessionSummary[], archived: ReadonlySet<string>): SessionSummary[] {
  if (archived.size === 0) return [...summaries]
  return summaries.filter((session) => !archived.has(session.sessionId))
}

/**
 * Normalize a `session/list` value into tray-ready summaries. Top-level
 * topics only: subagent children (`origin: "subagent"` or a parent session
 * id) are the agent's internals, not user-facing topics. Entries that do not
 * meet the documented shape are skipped rather than trusted.
 */
export function normalizeSessionSummaries(value: unknown): SessionSummary[] {
  if (typeof value !== 'object' || value === null) return []
  const items = (value as Record<string, unknown>).items
  if (!Array.isArray(items)) return []
  const summaries: SessionSummary[] = []
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const { sessionId, updatedAt, running, blank, parentSessionId, origin, cwd, projections } = record as Record<string, unknown>
    if (typeof sessionId !== 'string' || sessionId === '') continue
    if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) continue
    if (typeof running !== 'boolean' || typeof blank !== 'boolean') continue
    if (origin === 'subagent' || typeof parentSessionId === 'string') continue
    let title: string | undefined
    let workspaceCwd: string | undefined
    if (typeof cwd === 'string' && cwd !== '') workspaceCwd = cwd
    if (typeof projections === 'object' && projections !== null) {
      const values = (projections as Record<string, unknown>).values
      if (typeof values === 'object' && values !== null && typeof (values as Record<string, unknown>).title === 'string') {
        const candidate = (values as Record<string, unknown>).title as string
        if (candidate.trim() !== '') title = candidate.trim()
      }
    }
    summaries.push({ sessionId, updatedAt, running, blank, ...(title === undefined ? {} : { title }), ...(workspaceCwd === undefined ? {} : { cwd: workspaceCwd }) })
  }
  return summaries
}

/**
 * The tray label for one session: the derived title when the harness has
 * produced one, otherwise the workspace directory's basename, otherwise the
 * caller's "untitled" text. Long titles are truncated so a run-on prompt
 * cannot stretch the tray menu across the screen.
 */
export function sessionTopicLabel(
  session: SessionSummary,
  options: { maxLength?: number; untitled?: string } = {},
): string {
  const { maxLength = 64, untitled = 'Untitled' } = options
  const fallback = session.cwd === undefined ? undefined : session.cwd.split(/[\\/]/).filter((part) => part !== '').at(-1)
  const label = session.title ?? fallback ?? untitled
  if (label.length <= maxLength) return label
  return `${label.slice(0, Math.max(0, maxLength - 1))}…`
}

/**
 * Coarse relative age for the recent-topics section. Menu labels are static
 * text, so this is only as fresh as the last poll — precision ("just now")
 * would be a lie the menu cannot keep.
 */
export function relativeAge(updatedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - updatedAt) / 1000))
  if (seconds < 60) return 'now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${String(minutes)}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)}h`
  const days = Math.floor(hours / 24)
  return `${String(days)}d`
}

/** Minimal fetch surface the feed needs (injectable for tests). */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

/** Minimal socket surface the workspace baseline needs (injectable for tests). */
export interface WsLike {
  send(data: string): void
  close(): void
  on(event: 'open' | 'message' | 'error' | 'close', handler: (data?: unknown) => void): unknown
}

/** Creates one WebSocket; `ws` in production, a scripted fake in tests. */
export type WebSocketFactory = (url: string, options: { headers: Record<string, string> }) => WsLike

/** Bound on waiting for the workspace baseline before giving up for this poll. */
const BASELINE_TIMEOUT_MS = 5_000

/**
 * Open the `workspace/follow` stream, take its baseline frame, and leave.
 * One socket per poll: the tray only needs the archived set, and a stateless
 * one-shot avoids reconnect/backoff machinery for a stream it never listens
 * to after the first frame.
 */
async function openWorkspaceBaseline(url: string, cookie: string | undefined, factory: WebSocketFactory): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    let settled = false
    let streamId: string | undefined
    const socket = factory(url, { headers: cookie === undefined ? {} : { cookie } })
    const finish = (outcome: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { socket.close() } catch { /* already closing */ }
      outcome()
    }
    const fail = (error: Error): void => finish(() => { reject(error) })
    const timer = setTimeout(() => { fail(new Error('dsh web: workspace baseline timed out')) }, BASELINE_TIMEOUT_MS)
    socket.on('open', () => {
      streamId = `desktop-baseline-${String(Date.now())}`
      socket.send(JSON.stringify({ type: 'open', streamId, endpoint: WORKSPACE_FOLLOW_ENDPOINT, payload: { args: {} } }))
    })
    socket.on('message', (data) => {
      let frame: Record<string, unknown>
      try {
        frame = JSON.parse(String(data)) as Record<string, unknown>
      } catch {
        return // Foreign or non-JSON mux traffic is not ours to judge.
      }
      if (frame.streamId !== streamId) return
      if (frame.type === 'item') {
        try { if (streamId !== undefined) socket.send(JSON.stringify({ type: 'cancel', streamId })) } catch { /* best-effort */ }
        finish(() => { resolve(frame.value) })
        return
      }
      if (frame.type === 'error') {
        const error = frame.error as Record<string, unknown> | undefined
        fail(new Error(`dsh web: workspace stream error (${String(error?.code ?? 'unknown')})`))
        return
      }
      if (frame.type === 'end') fail(new Error('dsh web: workspace stream ended before its baseline'))
    })
    socket.on('error', () => { fail(new Error('dsh web: workspace stream failed')) })
    socket.on('close', () => { fail(new Error('dsh web: workspace stream closed before its baseline')) })
  })
}

/**
 * Fetches session summaries from the running `dsh web`. Auth is lazy and
 * self-healing: the first RPC exchanges the readiness token for the auth
 * cookie, and any 401 triggers one re-auth + retry before giving up — the
 * cookie outlives the app (30 days) but a server restart may mint a fresh one.
 */
export class SessionFeed {
  private readonly serverUrl: URL
  private readonly fetchImpl: FetchLike
  private readonly webSocketFactory: WebSocketFactory
  private cookie: string | undefined
  /** In-flight auth exchange, so parallel poll branches share one hop. */
  private authPromise: Promise<void> | undefined
  private rpcCounter = 0
  /** Last known archived set; kept across baseline failures so a blip never un-archives anything. */
  private archivedSessionIds: Set<string> = new Set()

  constructor(serverUrl: URL, fetchImpl: FetchLike = fetch, webSocketFactory: WebSocketFactory = defaultWebSocketFactory) {
    this.serverUrl = serverUrl
    this.fetchImpl = fetchImpl
    this.webSocketFactory = webSocketFactory
  }

  /**
   * List top-level session summaries, most recently active first, with the
   * user's archived sessions dropped. Throws when the server cannot be
   * reached or answers with an RPC error; the caller decides how stale data
   * is surfaced. A failed archive fetch is not fatal: the previous set stays
   * in force so a WebSocket blip never resurrects archived topics.
   */
  async list(): Promise<SessionSummary[]> {
    const [summaries, archived] = await Promise.all([
      this.call(SESSION_LIST_ENDPOINT, { _request: {} }).then(normalizeSessionSummaries),
      this.refreshArchivedSessionIds().catch(() => undefined),
    ])
    if (archived !== undefined) this.archivedSessionIds = archived
    return filterArchived(summaries, this.archivedSessionIds)
  }

  /**
   * Run one unary RPC, re-authenticating once on a rejected cookie. The
   * envelope is `POST /api/<endpoint>`; the token in the URL is only accepted
   * for the page itself, never for the API fence.
   */
  private async call(endpoint: string, payload: unknown): Promise<unknown> {
    try {
      return await this.attempt(endpoint, payload)
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        this.cookie = undefined
        return await this.attempt(endpoint, payload)
      }
      throw error
    }
  }

  private async attempt(endpoint: string, payload: unknown): Promise<unknown> {
    if (this.cookie === undefined) await this.authenticate()
    const rpcId = `desktop-${String(this.rpcCounter++)}`
    const response = await this.fetchImpl(`${this.serverUrl.origin}/api/${endpoint}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.cookie === undefined ? {} : { cookie: this.cookie }),
      },
      body: unaryRequestBody(rpcId, endpoint, payload),
    })
    if (response.status === 401) throw new UnauthorizedError()
    if (!response.ok) throw new Error(`dsh web: ${endpoint} answered ${String(response.status)}`)
    return parseUnaryResponse(await response.text())
  }

  /**
   * Exchange the readiness token for the auth cookie. Older `dsh web` builds
   * print an unauthenticated URL; there the cookie is simply absent and the
   * API fence (which does not exist there either) is called bare.
   */
  private async authenticate(): Promise<void> {
    if (this.authPromise === undefined) {
      this.authPromise = this.exchangeTokenForCookie().finally(() => { this.authPromise = undefined })
    }
    await this.authPromise
  }

  private async exchangeTokenForCookie(): Promise<void> {
    const token = this.serverUrl.searchParams.get('token')
    if (token === null) return
    const response = await this.fetchImpl(`${this.serverUrl.origin}/?token=${encodeURIComponent(token)}`, {
      method: 'GET',
      redirect: 'manual',
    })
    this.cookie = extractAuthCookie(response.headers.getSetCookie())
  }

  /** One baseline fetch per poll; shares the authenticated cookie. */
  private async refreshArchivedSessionIds(): Promise<Set<string>> {
    if (this.cookie === undefined) await this.authenticate()
    const url = `${this.serverUrl.origin.replace(/^http/, 'ws')}/api/remote.mux`
    const value = await openWorkspaceBaseline(url, this.cookie, this.webSocketFactory)
    return parseWorkspaceBaseline(value)
  }
}

/** The `ws` client: the WHATWG global cannot send the cookie on the upgrade. */
const defaultWebSocketFactory: WebSocketFactory = (url, options) => new WebSocket(url, { headers: options.headers })

/** Marker for the re-auth + retry path; never shown to the user. */
class UnauthorizedError extends Error {
  constructor() {
    super('dsh web: unauthorized')
  }
}
