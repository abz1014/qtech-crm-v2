/*
 * What this device remembers about the signed-in person, so a cold open without signal is not mistaken for a sign-out
 * (phone audit 2c, performance audit 3.2).
 *
 *  - storedSessionUserId(): whose Supabase session is kept in localStorage. supabase-js keeps it there until a sign-out
 *    or a refresh that the server REFUSES; a refresh that fails for lack of signal leaves it in place (auth-js
 *    _callRefreshToken), even though getSession() then reports no session. So "a stored session but no live one"
 *    means "signed in, waiting for signal".
 *  - The remembered person ({ id, name, role }, the last answer of the users row and current_user_role()), written each
 *    time the session resolves and forgotten on sign-out. It lets the shell open with the right navigation offline.
 *    It holds nothing the person's own session does not already hold on this device.
 */
import type { SessionUser } from '@/app/session'

const PROFILE_KEY = 'qtech.session.user'

/** supabase-js's default storage key: sb-<first label of the project host>-auth-token. */
export function supabaseStorageKey(url: string | undefined = import.meta.env.VITE_SUPABASE_URL as string | undefined): string | null {
  if (!url) return null
  try {
    return `sb-${new URL(url).hostname.split('.')[0]}-auth-token`
  } catch {
    return null
  }
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

/** The user id of the Supabase session kept on this device, if it still has a refresh token. */
export function storedSessionUserId(key: string | null = supabaseStorageKey()): string | null {
  if (!key) return null
  const raw = read(key)
  if (!raw) return null
  try {
    const s = JSON.parse(raw) as { refresh_token?: unknown; user?: { id?: unknown } }
    return typeof s.refresh_token === 'string' && s.refresh_token && typeof s.user?.id === 'string' ? s.user.id : null
  } catch {
    return null
  }
}

/** The remembered person as stored (a string, so a render can compare it cheaply). */
export function rememberedUserRaw(): string | null {
  return read(PROFILE_KEY)
}

export function parseRememberedUser(raw: string | null): SessionUser | null {
  if (!raw) return null
  try {
    const u = JSON.parse(raw) as Partial<SessionUser>
    return typeof u.id === 'string' && typeof u.name === 'string' && typeof u.role === 'string' ? { id: u.id, name: u.name, role: u.role } : null
  } catch {
    return null
  }
}

export function readRememberedUser(): SessionUser | null {
  return parseRememberedUser(rememberedUserRaw())
}

export function rememberUser(user: SessionUser): void {
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify({ id: user.id, name: user.name, role: user.role }))
  } catch {
    /* storage blocked: the shell then waits for signal on a cold open */
  }
}

export function forgetRememberedUser(): void {
  try {
    window.localStorage.removeItem(PROFILE_KEY)
  } catch {
    /* nothing was kept */
  }
}
