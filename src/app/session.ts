import { createContext, useContext } from 'react'

/**
 * What the shell needs to know about the person. U02 owns this contract; A03
 * supplies the real provider (Supabase session + role resolved through TanStack
 * Query, deactivated users forced out). Until then main.tsx only supplies a
 * session in dev builds (see devSession.ts), so a production build before A03
 * shows the sign-in screen and nothing else.
 */
export interface SessionUser {
  id: string
  name: string
  /** admin, sales or engineer. Kept a string: an unknown role lands on /no-access. */
  role: string
}

export type SessionState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; user: SessionUser }

export const SessionContext = createContext<SessionState>({ status: 'signed-out' })

export function useSession(): SessionState {
  return useContext(SessionContext)
}

export const ROLE_LABEL: Record<string, string> = { admin: 'Admin', sales: 'Sales', engineer: 'Engineer' }
