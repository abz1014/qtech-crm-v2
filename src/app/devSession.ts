import type { SessionState } from '@/app/session'

const NAMES: Record<string, string> = {
  admin: 'Farhan Mirza',
  sales: 'Ayesha Rana',
  engineer: 'Bilal Chaudhry',
}

/**
 * Dev builds only: `?devRole=admin|sales|engineer` fakes a signed-in session so
 * the shell can be reviewed without Supabase. Remembered for the tab. Returns
 * undefined in production (the branch is dead code there, so it is stripped).
 * A03 replaces the whole mechanism with the real session.
 */
export function devSessionFromUrl(): SessionState | undefined {
  if (!import.meta.env.DEV) return undefined
  let role: string | null = null
  try {
    role = new URLSearchParams(window.location.search).get('devRole') ?? window.sessionStorage.getItem('devRole')
    if (role) window.sessionStorage.setItem('devRole', role)
  } catch {
    // storage can be blocked; the URL parameter still works for this load
  }
  if (!role) return undefined
  return { status: 'signed-in', user: { id: `dev-${role}`, name: NAMES[role] ?? 'Dev User', role } }
}
