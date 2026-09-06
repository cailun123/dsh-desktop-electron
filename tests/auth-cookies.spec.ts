import { describe, expect, it } from 'vitest'
import { AUTH_COOKIE_PREFIX, authCookieRemovals, isAuthCookie } from '../src/auth-cookies.ts'
import type { StoredCookie } from '../src/auth-cookies.ts'

function cookie(overrides: Partial<StoredCookie> = {}): StoredCookie {
  return { name: 'dsh-auth-abc123', domain: '127.0.0.1', path: '/', secure: false, ...overrides }
}

describe('isAuthCookie', () => {
  it('matches the harness auth family by prefix', () => {
    expect(isAuthCookie('dsh-auth-2N3tY6aHAefsGH1hjy7IOkuxrtQUvYw')).toBe(true)
    expect(isAuthCookie(AUTH_COOKIE_PREFIX)).toBe(true)
  })

  it('rejects unrelated cookies, including near-collisions', () => {
    expect(isAuthCookie('session')).toBe(false)
    expect(isAuthCookie('dsh-auth')).toBe(false)
    expect(isAuthCookie('dsh-authentic-token')).toBe(false)
    expect(isAuthCookie('xdsh-auth-abc')).toBe(false)
  })
})

describe('authCookieRemovals', () => {
  it('keeps only auth cookies and maps each to its URL scope and name', () => {
    const removals = authCookieRemovals([
      cookie({ name: 'dsh-auth-one' }),
      cookie({ name: 'preferences', domain: '127.0.0.1' }),
      cookie({ name: 'dsh-auth-two' }),
    ])
    expect(removals).toEqual([
      { url: 'http://127.0.0.1/', name: 'dsh-auth-one' },
      { url: 'http://127.0.0.1/', name: 'dsh-auth-two' },
    ])
  })

  it('strips the leading dot of domain cookies in the removal URL', () => {
    expect(authCookieRemovals([cookie({ domain: '.example.com' })])).toEqual([
      { url: 'http://example.com/', name: 'dsh-auth-abc123' },
    ])
  })

  it('upgrades the removal URL scheme for secure cookies and keeps non-root paths', () => {
    expect(authCookieRemovals([cookie({ secure: true, path: '/gui' })])).toEqual([
      { url: 'https://127.0.0.1/gui', name: 'dsh-auth-abc123' },
    ])
  })

  it('returns nothing for an empty or auth-free store', () => {
    expect(authCookieRemovals([])).toEqual([])
    expect(authCookieRemovals([cookie({ name: 'other' })])).toEqual([])
  })
})
