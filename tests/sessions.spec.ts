import { describe, expect, it } from 'vitest'
import {
  extractAuthCookie,
  normalizeSessionSummaries,
  parseUnaryResponse,
  relativeAge,
  SessionFeed,
  SESSION_LIST_ENDPOINT,
  sessionTopicLabel,
  unaryRequestBody,
} from '../src/sessions.ts'

/** One well-formed `session/list` item with the full projection shape. */
function item(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionId: 's-1',
    updatedAt: 1_000,
    running: false,
    blank: false,
    projections: { asOfSeq: 4, values: { title: 'Fix the login flow' } },
    ...overrides,
  }
}

describe('unaryRequestBody', () => {
  it('wraps the payload in the client-request envelope with an args object', () => {
    expect(JSON.parse(unaryRequestBody('rpc-1', SESSION_LIST_ENDPOINT, {}))).toEqual({
      type: 'client-request',
      rpcId: 'rpc-1',
      method: 'session/list',
      payload: { args: {} },
    })
  })
})

describe('parseUnaryResponse', () => {
  it('returns the value of a successful result', () => {
    const value = { items: [] }
    expect(parseUnaryResponse(JSON.stringify({ type: 'server-response', rpcId: 'r', result: { ok: true, value } }))).toEqual(value)
  })

  it('throws the application error of a failed result', () => {
    const body = JSON.stringify({
      type: 'server-response',
      rpcId: 'r',
      result: { ok: false, error: { code: 'gateway/lookup-not-found', message: 'nope', details: {} } },
    })
    expect(() => parseUnaryResponse(body)).toThrow('gateway/lookup-not-found')
  })

  it('throws on non-envelope garbage', () => {
    expect(() => parseUnaryResponse('<html>unauthorized</html>')).toThrow()
    expect(() => parseUnaryResponse('{}')).toThrow()
  })
})

describe('extractAuthCookie', () => {
  it('returns the dsh-auth cookie in name=value wire form', () => {
    const cookie = extractAuthCookie([
      'other=ignored; Path=/',
      'dsh-auth-abc123=v1.sig; Max-Age=2592000; Path=/; HttpOnly',
    ])
    expect(cookie).toBe('dsh-auth-abc123=v1.sig')
  })

  it('returns undefined when no dsh-auth cookie was set', () => {
    expect(extractAuthCookie(['session=abc; Path=/'])).toBeUndefined()
    expect(extractAuthCookie([])).toBeUndefined()
  })
})

describe('normalizeSessionSummaries', () => {
  it('maps summaries and keeps the title projection', () => {
    expect(normalizeSessionSummaries({ items: [item()] })).toEqual([
      { sessionId: 's-1', updatedAt: 1_000, running: false, blank: false, title: 'Fix the login flow' },
    ])
  })

  it('drops subagent children, which are agent internals rather than topics', () => {
    const value = {
      items: [
        item({ sessionId: 's-2', origin: 'subagent' }),
        item({ sessionId: 's-3', parentSessionId: 's-1' }),
        item({ sessionId: 's-4' }),
      ],
    }
    expect(normalizeSessionSummaries(value).map((session) => session.sessionId)).toEqual(['s-4'])
  })

  it('falls back to cwd and skips malformed entries', () => {
    const value = {
      items: [
        item({ sessionId: 's-5', projections: { asOfSeq: 1, values: {} }, cwd: 'D:\\work\\my-app' }),
        item({ sessionId: '' }),
        item({ sessionId: 's-6', updatedAt: 'nope' }),
        item({ sessionId: 's-7', running: 'yes' }),
        'garbage',
      ],
    }
    expect(normalizeSessionSummaries(value)).toEqual([
      { sessionId: 's-5', updatedAt: 1_000, running: false, blank: false, cwd: 'D:\\work\\my-app' },
    ])
  })

  it('returns an empty list for shapes it does not recognize', () => {
    expect(normalizeSessionSummaries(undefined)).toEqual([])
    expect(normalizeSessionSummaries({})).toEqual([])
  })
})

describe('sessionTopicLabel', () => {
  it('prefers the derived title over the workspace basename', () => {
    expect(sessionTopicLabel({ sessionId: 's', updatedAt: 0, running: false, blank: false, title: 'Refactor auth', cwd: 'D:\\work\\app' })).toBe('Refactor auth')
    expect(sessionTopicLabel({ sessionId: 's', updatedAt: 0, running: false, blank: false, cwd: 'D:/work/my-app/' })).toBe('my-app')
  })

  it('falls back to Untitled and truncates run-on titles', () => {
    expect(sessionTopicLabel({ sessionId: 's', updatedAt: 0, running: false, blank: false })).toBe('Untitled')
    expect(sessionTopicLabel({ sessionId: 's', updatedAt: 0, running: false, blank: false, title: 'a'.repeat(80) })).toBe(`${'a'.repeat(63)}…`)
  })
})

describe('relativeAge', () => {
  const now = 1_000_000_000
  it('buckets the age coarsely', () => {
    expect(relativeAge(now - 30_000, now)).toBe('now')
    expect(relativeAge(now - 5 * 60_000, now)).toBe('5m')
    expect(relativeAge(now - 3 * 3_600_000, now)).toBe('3h')
    expect(relativeAge(now - 2 * 86_400_000, now)).toBe('2d')
  })
})

describe('SessionFeed', () => {
  const SERVER = 'http://127.0.0.1:39481/?token=secret'
  const COOKIE_PAIR = 'dsh-auth-k=v1.sig'

  /** A fetch double scripted per call: URL match → canned response factory. */
  function scriptFetch(routes: Array<{ match: RegExp; respond: (url: string, init: RequestInit) => Response }>): { calls: Array<{ url: string; init: RequestInit }>; fetch: (url: string, init: RequestInit) => Promise<Response> } {
    const calls: Array<{ url: string; init: RequestInit }> = []
    return {
      calls,
      fetch: async (url, init) => {
        calls.push({ url, init })
        const route = routes.find((candidate) => candidate.match.test(url))
        if (route === undefined) return new Response('not found', { status: 404 })
        return route.respond(url, init)
      },
    }
  }

  function listResponse(): Response {
    return new Response(
      JSON.stringify({
        type: 'server-response',
        rpcId: 'ignored',
        result: { ok: true, value: { items: [item({ sessionId: 's-9' })] } },
      }),
      { status: 200 },
    )
  }

  it('exchanges the token for the auth cookie and lists sessions', async () => {
    const scripted = scriptFetch([
      { match: /\/\?token=secret$/, respond: () => new Response(null, { status: 303, headers: { 'set-cookie': `${COOKIE_PAIR}; Path=/; HttpOnly` } }) },
      { match: /\/api\/session\/list$/, respond: () => listResponse() },
    ])
    const feed = new SessionFeed(new URL(SERVER), scripted.fetch)
    const sessions = await feed.list()
    expect(sessions.map((session) => session.sessionId)).toEqual(['s-9'])
    expect(scripted.calls[0]?.url).toBe('http://127.0.0.1:39481/?token=secret')
    const rpcCall = scripted.calls[1]
    expect(rpcCall?.init.headers).toEqual({ 'content-type': 'application/json', cookie: COOKIE_PAIR })
    const body = JSON.parse(String(rpcCall?.init.body))
    expect(body.method).toBe('session/list')
    expect(body.payload).toEqual({ args: { _request: {} } })
  })

  it('re-authenticates once and retries when the cookie is rejected', async () => {
    let rpcCalls = 0
    const scripted = scriptFetch([
      { match: /\/\?token=secret$/, respond: () => new Response(null, { status: 303, headers: { 'set-cookie': `${COOKIE_PAIR}; Path=/` } }) },
      {
        match: /\/api\/session\/list$/,
        respond: () => {
          rpcCalls += 1
          if (rpcCalls === 1) return new Response('unauthorized', { status: 401 })
          return listResponse()
        },
      },
    ])
    const feed = new SessionFeed(new URL(SERVER), scripted.fetch)
    const sessions = await feed.list()
    expect(sessions).toHaveLength(1)
    expect(rpcCalls).toBe(2)
  })

  it('calls the API bare for an unauthenticated server and surfaces RPC failures', async () => {
    const scripted = scriptFetch([
      {
        match: /\/api\/session\/list$/,
        respond: () => new Response(
          JSON.stringify({ type: 'server-response', rpcId: 'r', result: { ok: false, error: { code: 'boom', message: 'nope', details: {} } } }),
          { status: 200 },
        ),
      },
    ])
    const feed = new SessionFeed(new URL('http://127.0.0.1:39481/'), scripted.fetch)
    await expect(feed.list()).rejects.toThrow('boom')
    // No token → no auth hop.
    expect(scripted.calls).toHaveLength(1)
  })
})
