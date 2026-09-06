/**
 * Stale auth-cookie purge for the hosted GUI session.
 *
 * `dsh web` mints a fresh randomly-suffixed auth cookie per boot
 * (`dsh-auth-<random>`), and HTTP cookies are scoped to the host — not the
 * port — so every desktop launch leaves one more `dsh-auth-*` cookie for
 * 127.0.0.1 behind in Electron's persistent profile. The browser sends the
 * whole pile with every request, and once the combined Cookie header plus the
 * long plugin-bundle URL crosses the server's HTTP header limit, `dsh web`
 * answers 431 and every plugin client bundle fails to load ("Failed to load
 * plugins" at boot). Purging all `dsh-auth-*` cookies before the GUI loads is
 * safe: the readiness URL carries a fresh token, and the server re-issues its
 * cookie during the load's 303 exchange.
 */

/** Name prefix shared by every auth cookie the harness web server issues. */
export const AUTH_COOKIE_PREFIX = 'dsh-auth-' as const

/** The cookie fields the purge decision reads; a structural subset of Electron's Cookie. */
export interface StoredCookie {
  name: string
  /** Cookie domain as stored: host-only cookies carry it bare, domain cookies a leading dot. */
  domain: string
  path: string
  secure: boolean
}

/** One pending removal: the cookie name plus the URL scope that owns it. */
export interface AuthCookieRemoval {
  url: string
  name: string
}

/**
 * Whether a stored cookie belongs to the harness auth family. The suffix is
 * random per server boot, so the name can only be matched by prefix.
 * @param name - the stored cookie's name.
 */
export function isAuthCookie(name: string): boolean {
  return name.startsWith(AUTH_COOKIE_PREFIX)
}

/**
 * Build the removal targets for the stale auth cookies among `cookies`.
 * Domain cookies carry a leading dot that a URL cannot, so it is stripped;
 * the scheme follows the cookie's `secure` flag so Electron's removal scope
 * matches how the cookie was stored.
 * @param cookies - the session's stored cookies.
 * @returns one removal per auth cookie, in input order.
 */
export function authCookieRemovals(cookies: readonly StoredCookie[]): AuthCookieRemoval[] {
  return cookies.filter((cookie) => isAuthCookie(cookie.name)).map((cookie) => ({
    url: `http${cookie.secure ? 's' : ''}://${cookie.domain.replace(/^\./, '')}${cookie.path}`,
    name: cookie.name,
  }))
}
