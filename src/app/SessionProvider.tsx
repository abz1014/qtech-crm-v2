import type { ReactNode } from 'react'
import { SessionContext, type SessionState } from '@/app/session'

export function SessionProvider({ value, children }: { value: SessionState; children: ReactNode }) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
