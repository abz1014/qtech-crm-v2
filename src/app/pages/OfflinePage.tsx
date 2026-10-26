import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CloudOff, RefreshCw, WifiOff } from 'lucide-react'
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
  offline: { title: 'You’re offline', body: 'Showing what’s saved; changes need signal.' },
  reconnecting: { title: 'Reconnecting', body: 'Showing what’s saved; changes need signal.' },
}

export function OfflineBanner({ connection }: { connection: Exclude<Connection, 'online'> }) {
  const copy = COPY[connection]
  return (
    <div
      role="status"
      data-offline-banner={connection}
      className="flex items-center gap-2 border-b border-tone-warning-fg/25 bg-tone-warning-bg px-4 py-2 text-sm text-fg-2"
    >
      <Icon icon={connection === 'offline' ? WifiOff : RefreshCw} className="shrink-0 text-tone-warning-fg" />
      <p className="min-w-0 text-pretty">
        <b className="font-semibold text-fg">{copy.title}</b>
        {' — '}
        {copy.body}
      </p>
    </div>
  )
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 py-8 max-sm:items-start max-sm:bg-surface max-sm:px-0 max-sm:py-6">
      <div className="grid w-full max-w-[360px] gap-5 rounded-panel border border-line bg-surface px-8 pb-6 pt-8 max-sm:max-w-none max-sm:border-0 max-sm:px-4">
        <img src="/brand/logo-wordmark.png" alt="Q Tech Solutions" width={181} height={44} className="h-[44px] w-auto justify-self-start" />
        {children}
      </div>
    </main>
  )
}

function Lead({ icon, title, children }: { icon: typeof CloudOff; title: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span aria-hidden="true" className="grid size-[36px] shrink-0 place-items-center rounded bg-tone-warning-bg text-tone-warning-fg">
        <Icon icon={icon} size="lg" />
      </span>
      <div className="grid gap-[2px]">
        <h1 className="text-xl font-semibold tracking-snug">{title}</h1>
        <div className="grid gap-2 text-sm text-fg-muted text-pretty">{children}</div>
      </div>
    </div>
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
      <Lead icon={connection === 'offline' ? WifiOff : CloudOff} title={connection === 'offline' ? 'You’re offline' : 'Can’t reach Q-Tech yet'}>
        <p>You’re still signed in. Q-Tech opens by itself as soon as there is signal.</p>
        <p>Anything you shared to Q-Tech is kept on this phone.</p>
      </Lead>
      <Button icon={RefreshCw} busy={trying} busyLabel="Trying" onClick={() => void tryAgain()} className="w-full">
        Try again
      </Button>
    </Frame>
  )
}

export function OfflineSignInPage({ children }: { children?: ReactNode }) {
  return (
    <Frame>
      <Lead icon={WifiOff} title="You’re offline">
        <p>Sign in again when you have signal. This page changes to the sign-in form by itself.</p>
      </Lead>
      {children}
    </Frame>
  )
}
