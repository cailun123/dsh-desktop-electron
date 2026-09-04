import { describe, expect, it } from 'vitest'
import { killProcessTree, type KillProcessTreeOptions } from '../src/process-tree.ts'

/**
 * Deterministic coverage of the process-tree termination primitive. All kill
 * and liveness primitives are injectable, so every platform decision is
 * exercised without touching real processes — except one win32 integration
 * case that runs the real `taskkill` (spawned with stdio ignore) against a
 * pid that cannot exist, proving the default implementation settles cleanly.
 */

function esrch(message = 'no such process'): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException
  error.code = 'ESRCH'
  return error
}

function eperm(message = 'permission denied'): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException
  error.code = 'EPERM'
  return error
}

describe('killProcessTree', () => {
  describe('non-positive pid is a no-op', () => {
    it('does nothing on win32', async () => {
      const calls: string[] = []
      const options: KillProcessTreeOptions = {
        platform: 'win32',
        taskkill: async (pid) => { calls.push(`taskkill ${pid}`) },
        directTerminate: (pid) => { calls.push(`direct ${pid}`) },
      }
      await killProcessTree(0, options)
      await killProcessTree(-7, options)
      expect(calls).toEqual([])
    })

    it('does nothing on posix', async () => {
      const calls: string[] = []
      await killProcessTree(0, {
        platform: 'darwin',
        signal: (pid, sig) => { calls.push(`${pid} ${sig}`) },
        treeAlive: () => true,
      })
      expect(calls).toEqual([])
    })
  })

  describe('win32', () => {
    it('delegates to taskkill and settles when it exits', async () => {
      const seen: number[] = []
      await killProcessTree(42, {
        platform: 'win32',
        taskkill: async (pid) => { seen.push(pid) },
        directTerminate: () => { throw new Error('must not run') },
      })
      expect(seen).toEqual([42])
    })

    it('falls back to direct termination when taskkill cannot start', async () => {
      const terminated: number[] = []
      await killProcessTree(42, {
        platform: 'win32',
        taskkill: async () => { throw new Error('spawn EPERM') },
        directTerminate: (pid) => { terminated.push(pid) },
        logger: () => {},
      })
      expect(terminated).toEqual([42])
    })

    it('reports the escalation and treats an already-gone root as success', async () => {
      let logged = ''
      await killProcessTree(42, {
        platform: 'win32',
        taskkill: async () => { throw new Error('spawn EPERM') },
        directTerminate: () => { throw esrch() },
        logger: (message) => { logged = message },
      })
      expect(logged).toContain('taskkill failed for pid 42')
      expect(logged).toContain('falling back to direct termination')
      expect(logged).not.toContain('direct termination failed')
    })

    it('contains a non-ESRCH fallback failure and reports it', async () => {
      let logged = ''
      await killProcessTree(42, {
        platform: 'win32',
        taskkill: async () => { throw new Error('spawn EPERM') },
        directTerminate: () => { throw eperm() },
        logger: (message) => { logged = message },
      })
      expect(logged).toContain('direct termination failed for pid 42')
    })

    it.runIf(process.platform === 'win32')('settles against a real taskkill for a pid that cannot exist', async () => {
      // The "already gone" outcome is the desired one: taskkill reports it
      // with a non-zero exit and the default implementation resolves cleanly.
      await expect(killProcessTree(2_147_483_647, { platform: 'win32' })).resolves.toBeUndefined()
    })
  })

  describe('posix', () => {
    it('SIGTERMs the negated group pid and resolves once the group is gone', async () => {
      const signals: Array<[number, string]> = []
      let alive = true
      await killProcessTree(7, {
        platform: 'linux',
        signal: (pid, sig) => {
          signals.push([pid, sig])
          if (sig === 'SIGTERM') alive = false
        },
        treeAlive: () => alive,
        pollMs: 5,
        logger: () => {},
      })
      expect(signals).toEqual([[-7, 'SIGTERM']])
    })

    it('escalates to SIGKILL when the group outlives the grace period', async () => {
      const signals: Array<[number, string]> = []
      let alive = true
      await killProcessTree(7, {
        platform: 'linux',
        signal: (pid, sig) => {
          signals.push([pid, sig])
          if (sig === 'SIGKILL') alive = false
        },
        treeAlive: () => alive,
        graceMs: 30,
        pollMs: 5,
        logger: () => {},
      })
      expect(signals).toEqual([[-7, 'SIGTERM'], [-7, 'SIGKILL']])
    })

    it('treats ESRCH on SIGTERM as the desired already-gone outcome', async () => {
      let logged = ''
      await killProcessTree(7, {
        platform: 'linux',
        signal: () => { throw esrch() },
        treeAlive: () => true,
        logger: (message) => { logged = message },
      })
      expect(logged).toBe('')
    })

    it('reports and contains a non-ESRCH SIGTERM failure', async () => {
      let logged = ''
      await killProcessTree(7, {
        platform: 'linux',
        signal: () => { throw eperm() },
        treeAlive: () => true,
        logger: (message) => { logged = message },
      })
      expect(logged).toContain('SIGTERM failed for pid 7')
    })
  })
})
