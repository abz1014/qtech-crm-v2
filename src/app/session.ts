import { createContext, useContext } from 'react'
import { clearDevRole } from '@/app/devSession'
import { forgetDeviceCaptures, forgetIntakeDrafts } from '@/lib/capture/forget'
import { getSupabase } from '@/lib/supabase'

/**
 * What the shell needs to know about the person. The Supabase-backed provider is
 * AuthProvider.tsx (the users row plus current_user_role(), resolved through TanStack
 * Query). A dev build can instead fake a session with ?devRole= (devSession.ts).
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

/** Why the person is on the sign-in screen without having asked to be. */
export type SignInNotice = 'deactivated' | 'unreachable' | 'unconfigured' | null
export const SignInNoticeContext = createContext<SignInNotice>(null)
export function useSignInNotice(): SignInNotice {
  return useContext(SignInNoticeContext)
}

/**
 * Session actions. `signOut` ends the Supabase session; AuthProvider sees the change, clears the
 * query cache and the shell returns to /login. Capture drafts and recents on this device are forgotten first (L-5). For a dev ?devRole= session
 * it forgets the dev role and goes to /login.
 */
export const session = {
  signOut: async (): Promise<void> => {
    const dev = clearDevRole()
    await forgetDeviceCaptures()
    const supabase = getSupabase()
    // This device only: with the API refusing ended sessions at once (0087), a global sign-out here would also end the
    // person's other devices on the spot. Reset password and Deactivate (admin-users) are what end every device.
    if (supabase) await supabase.auth.signOut({ scope: 'local' })
    // Again once the session has ended: a New RFQ draft kept while the sign-out was on its way does not stay behind.
    forgetIntakeDrafts()
    if (dev) window.location.assign('/login')
  },
}
