import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CloudOff, RefreshCw, WifiOff } from 'lucide-react'
import { AuthFrame, AuthLead } from '@/app/pages/AuthFrame'
import type { Connection } from '@/lib/connection'
import { getSupabase } from '@/lib/supabase'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'

/*
 * No signal is not "signed out" (phone audit 2c). Three pieces:
 *  - OfflineBanner: the strip above the shell while it runs on what this device kept.
 *  - OfflineWaitingPage: still signed in, but this device has not kept who the person is yet (first open after an
 *    update, or the very first open), so the shell cannot be drawn. It opens by itself when the session confirms.
 *  - OfflineSignInPage: signed out and offline. Signing in needs signal, so the form is not shown at all.
 */
const COPY: Record<Exclude<Connection, 'online'>, { title: string; body: string }> = {
  offline: { title: 'No connection', body: 'Saved records are shown. Changes need a connection.' },
  reconnecting: { title: 'Reconnecting', body: 'Saved records are shown. Changes need a connection.' },
}

export function OfflineBanner({ connection }: { connection: Exclude<Connection, 'online'> }) {
  const copy = COPY[connection]
  return (
    <div
      role="status"
      data-offline-banner={connection}
      className="flex items-center gap-x-3 gap-y-2 bg-tone-warning-bg px-4 py-2 text-sm font-medium text-tone-warning-fg"
    >
      <Icon icon={connection === 'offline' ? WifiOff : RefreshCw} className="shrink-0" />
      <p className="min-w-0 text-pretty">
        <b className="font-heavy">{copy.title}</b>
        {' — '}
        {copy.body}
      </p>
    </div>
  )
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <AuthFrame>
      <img src="/brand/logo-wordmark.png" alt="Q Tech Solutions" width={181} height={44} className="h-[44px] w-auto justify-self-start" />
      {children}
    </AuthFrame>
  )
}

export function OfflineWaitingPage({ connection }: { connection: Exclude<Connection, 'online'> }) {
  const queryClient = useQueryClient()
  const [trying, setTrying] = useState(false)
  async function tryAgain() {
    setTrying(true)
    try {
      await getSupabase()?.auth.getSession()
      await queryClient.refetchQueries({ queryKey: ['session'] })
    } finally {
      setTrying(false)
    }
  }
  return (
    <Frame>
      <AuthLead icon={connection === 'offline' ? WifiOff : CloudOff} title={connection === 'offline' ? 'No connection' : 'Q-Tech CRM cannot be reached yet'}>
        <p>You are still signed in. Q-Tech CRM reopens when the connection returns.</p>
        <p>Anything shared to Q-Tech CRM is kept on this device.</p>
      </AuthLead>
      <Button icon={RefreshCw} busy={trying} busyLabel="Trying" onClick={() => void tryAgain()} className="w-full">
        Try again
      </Button>
    </Frame>
  )
}

export function OfflineSignInPage({ children }: { children?: ReactNode }) {
  return (
    <Frame>
      <AuthLead icon={WifiOff} title="No connection">
        <p>Sign in again when the connection returns. This page changes to the sign-in form automatically.</p>
      </AuthLead>
      {children}
    </Frame>
  )
}
