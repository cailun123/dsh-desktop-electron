import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  childExited,
  parseReadyLine,
  resolveWebLaunch,
  waitForHttpOk,
  waitForReadyLine,
  WEB_ARGS,
} from '../src/launcher.ts'

// Fixture paths are built with the host's `join` because the launcher resolves
// its candidates with the host's `node:path`; a Windows literal would not
// normalize on POSIX. `platform` is injected separately and only selects the
// permission fallback, so the win32 default below is independent of the path
// flavor.
const DSH_HOME = join('dsh-checkout')

function launchWith(
  exists: (path: string) => boolean,
  env: NodeJS.ProcessEnv = {},
  platform: NodeJS.Platform = 'win32',
): ReturnType<typeof resolveWebLaunch> {
  return resolveWebLaunch({ env, exists, platform })
}

describe('parseReadyLine', () => {
  it('parses the plain readiness line', () => {
    const url = parseReadyLine('dsh web: http://127.0.0.1:34567')
    expect(url?.href).toBe('http://127.0.0.1:34567/')
  })

  it('parses the readiness line with the LAN note', () => {
    const url = parseReadyLine('dsh web: http://127.0.0.1:34567 (LAN: http://192.168.1.5:34567)')
    expect(url?.port).toBe('34567')
  })

  it('returns undefined for a non-readiness line', () => {
    expect(parseReadyLine('cordis: plugin loaded')).toBeUndefined()
  })

  it('returns undefined when the URL part is not a URL', () => {
    expect(parseReadyLine('dsh web: not a url')).toBeUndefined()
  })

  it('parses the authenticated readiness line of dsh 0.1.2-rc.1', () => {
    // 0.1.2 attaches a per-connection token to the printed URL; the desktop
    // window must open the authenticated URL so the /api browser-trust fence
    // accepts it.
    const url = parseReadyLine('dsh web: http://127.0.0.1:41790/?token=ecve0PWSYkVxhOlYzS5cSuIWzxGReXYiBMH-A7urdn4')
    expect(url?.href).toBe('http://127.0.0.1:41790/?token=ecve0PWSYkVxhOlYzS5cSuIWzxGReXYiBMH-A7urdn4')
  })

  it('ignores the LAN note that follows the URL', () => {
    const url = parseReadyLine('dsh web: http://127.0.0.1:34567/?token=abc (LAN: http://192.168.1.5:34567/?token=abc)')
    expect(url?.href).toBe('http://127.0.0.1:34567/?token=abc')
  })
})

describe('resolveWebLaunch', () => {
  // `platform` is explicit: the permission fallback is a win32 behavior, and
  // leaving it to `process.platform` would make these cases host-dependent.
  const base = { env: {}, platform: 'win32' as NodeJS.Platform }

  it('prefers DSH_BIN over every other candidate', () => {
    const dshBin = join('tools', 'dsh')
    const launch = resolveWebLaunch({
      ...base,
      env: { DSH_BIN: dshBin },
    })
    expect(launch).toEqual({
      command: dshBin,
      args: [...WEB_ARGS],
      env: { DSH_PERMISSION_MODE: 'danger-full-access' },
      source: 'DSH_BIN',
    })
  })

  it('falls back to danger-full-access on win32 when DSH_PERMISSION_MODE is unset', () => {
    const launch = launchWith(() => false)
    expect(launch.env).toEqual({ DSH_PERMISSION_MODE: 'danger-full-access' })
  })

  it('keeps an explicit DSH_PERMISSION_MODE untouched', () => {
    const launch = launchWith(() => false, { DSH_PERMISSION_MODE: 'workspace-write' })
    expect(launch.env).toEqual({})
  })

  it('adds no permission fallback off Windows', () => {
    const launch = launchWith(() => false, {}, 'linux')
    expect(launch.env).toEqual({})
  })

  it('prefers the DSH_HOME built lib over the source launch', () => {
    const launch = launchWith(path => path.endsWith(join('apps', 'cli', 'lib', 'bin.js')), { DSH_HOME: DSH_HOME })
    expect(launch).toEqual({
      command: 'node',
      args: [join(DSH_HOME, 'apps', 'cli', 'lib', 'bin.js'), ...WEB_ARGS],
      env: { DSH_PERMISSION_MODE: 'danger-full-access' },
      source: 'DSH_HOME lib',
    })
  })

  it('falls back to the tsx source launch with DSH_HOME as cwd', () => {
    const launch = launchWith(path => path.endsWith(join('apps', 'cli', 'src', 'bin.ts')), { DSH_HOME: DSH_HOME })
    expect(launch).toEqual({
      command: 'node',
      args: ['--import', 'tsx/esm', join(DSH_HOME, 'apps', 'cli', 'src', 'bin.ts'), ...WEB_ARGS],
      env: { DSH_PERMISSION_MODE: 'danger-full-access' },
      cwd: DSH_HOME,
      source: 'DSH_HOME source',
    })
  })

  it('falls back to PATH when DSH_HOME holds no CLI', () => {
    const launch = launchWith(() => false, { DSH_HOME: DSH_HOME })
    expect(launch).toEqual({ command: 'dsh', args: [...WEB_ARGS], env: { DSH_PERMISSION_MODE: 'danger-full-access' }, source: 'PATH' })
  })

  it('treats an empty DSH_HOME as unset', () => {
    // A blank DSH_HOME must not be probed as a checkout root: `join('', …)`
    // would resolve relative to the process cwd and could spawn a stranger's CLI.
    const launch = launchWith(() => true, { DSH_HOME: '' })
    expect(launch.source).toBe('PATH')
  })

  it('falls back to dsh on PATH when nothing else exists', () => {
    const launch = launchWith(() => false)
    expect(launch).toEqual({ command: 'dsh', args: [...WEB_ARGS], env: { DSH_PERMISSION_MODE: 'danger-full-access' }, source: 'PATH' })
  })

  it('treats an empty DSH_BIN as unset', () => {
    const launch = launchWith(() => false, { DSH_BIN: '' })
    expect(launch).toEqual({ command: 'dsh', args: [...WEB_ARGS], env: { DSH_PERMISSION_MODE: 'danger-full-access' }, source: 'PATH' })
  })

  it('treats an empty DSH_PERMISSION_MODE as unset on win32', () => {
    const launch = launchWith(() => false, { DSH_PERMISSION_MODE: '' })
    expect(launch.env).toEqual({ DSH_PERMISSION_MODE: 'danger-full-access' })
  })
})

describe('waitForReadyLine', () => {
  function streamOf(chunks: string[]): AsyncIterable<string> {
    return (async function* () {
      for (const chunk of chunks) yield chunk
    })()
  }

  it('resolves with the URL even when the line spans chunks', async () => {
    const url = await waitForReadyLine(streamOf(['dsh web: http://127', '.0.0.1:1234\nmore noise']))
    expect(url.href).toBe('http://127.0.0.1:1234/')
  })

  it('rejects when the stream ends without a readiness line', async () => {
    await expect(waitForReadyLine(streamOf(['cordis: booting\n']))).rejects.toThrow(/exited before printing/)
  })

  it('rejects after the timeout when the stream never yields a line', async () => {
    const pending = new Promise<string>(() => {})
    const stream = (async function* () { yield 'no line here\n'; await pending })()
    await expect(waitForReadyLine(stream, { timeoutMs: 10 })).rejects.toThrow(/within 10ms/)
  })

  it('accepts a final readiness line without a trailing newline', async () => {
    const url = await waitForReadyLine(streamOf(['noise line\n', 'dsh web: http://127.0.0.1:4321']))
    expect(url.href).toBe('http://127.0.0.1:4321/')
  })

  it('keeps consuming the stream after readiness instead of destroying it', async () => {
    // Regression: returning from a `for await` over a Node stream destroys it,
    // and the live server then dies with EPIPE on its next stdout write.
    const stream = new PassThrough()
    const forwarded: string[] = []
    const urlPromise = waitForReadyLine(stream, { onChunk: (chunk) => { forwarded.push(chunk) } })
    stream.write('dsh web: http://127.0.0.1:1234\n')
    const url = await urlPromise
    expect(url.href).toBe('http://127.0.0.1:1234/')
    stream.write('more server output after readiness\n')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(stream.destroyed).toBe(false)
    expect(forwarded.join('')).toContain('more server output after readiness')
    stream.end()
    await new Promise(resolve => setTimeout(resolve, 20))
  })

  it('destroys the stream on timeout so the consumption loop cannot leak', async () => {
    const stream = new PassThrough()
    stream.write('nothing useful\n')
    await expect(waitForReadyLine(stream, { timeoutMs: 10 })).rejects.toThrow(/within 10ms/)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(stream.destroyed).toBe(true)
  })
})

describe('waitForHttpOk', () => {
  it('resolves when the server answers 200', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }))
    await expect(waitForHttpOk(new URL('http://127.0.0.1:1/'), { fetchImpl, timeoutMs: 100, pollIntervalMs: 5 })).resolves.toBeUndefined()
  })

  it('accepts any HTTP status as proof the server is live (dsh 0.1.2 auth fence)', async () => {
    // The 0.1.2 browser-trust fence answers an unauthenticated probe with a
    // 303 cookie exchange (401 for a cookieless client). The readiness poll
    // only proves the socket is served; the status is not ours to judge.
    const fetchImpl = vi.fn(async () => new Response('redirect', { status: 303 }))
    await expect(waitForHttpOk(new URL('http://127.0.0.1:1/?token=x'), { fetchImpl, timeoutMs: 100, pollIntervalMs: 5 })).resolves.toBeUndefined()
  })

  it('accepts the 401 of the auth fence as live-server proof', async () => {
    const fetchImpl = vi.fn(async () => new Response('unauthorized', { status: 401 }))
    await expect(waitForHttpOk(new URL('http://127.0.0.1:1/?token=x'), { fetchImpl, timeoutMs: 100, pollIntervalMs: 5 })).resolves.toBeUndefined()
  })

  it('resolves on the first answered probe even if it is a 503', async () => {
    let attempts = 0
    const fetchImpl = vi.fn(async () => {
      attempts += 1
      return attempts < 3 ? new Response('no', { status: 503 }) : new Response('ok', { status: 200 })
    })
    await expect(waitForHttpOk(new URL('http://127.0.0.1:1/'), { fetchImpl, timeoutMs: 200, pollIntervalMs: 5 })).resolves.toBeUndefined()
    expect(attempts).toBe(1)
  })

  it('rejects with the URL when the server never answers', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED') })
    await expect(waitForHttpOk(new URL('http://127.0.0.1:1/'), { fetchImpl, timeoutMs: 30, pollIntervalMs: 5 }))
      .rejects.toThrow(/http:\/\/127\.0\.0\.1:1\/.*ECONNREFUSED/)
  })

  it('rejects when the server never answers at all', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED') })
    await expect(waitForHttpOk(new URL('http://127.0.0.1:1/'), { fetchImpl, timeoutMs: 50, pollIntervalMs: 5 }))
      .rejects.toThrow(/ECONNREFUSED/)
  })
})

describe('childExited', () => {
  it('is false while the child is still running', () => {
    expect(childExited({ exitCode: null, signalCode: null })).toBe(false)
  })

  it('is true once the child exited with a code', () => {
    expect(childExited({ exitCode: 0, signalCode: null })).toBe(true)
  })

  it('is true once the child was killed by a signal', () => {
    expect(childExited({ exitCode: null, signalCode: 'SIGKILL' })).toBe(true)
  })
})
