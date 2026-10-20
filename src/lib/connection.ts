import { createContext, useContext, useSyncExternalStore } from 'react'
import type { onlineManager as OnlineManager } from '@tanstack/react-query'

/*
 * Connection state for the phone (phone audit 2c, performance audit 3.2).
 *
 *  - useOnline(): the browser's own online flag, live. False means no network at all (airplane mode, no signal).
 *  - Connection (context, from AuthProvider): what the shell should say about it.
 *      'online'        the session is live; nothing to say.
 *      'offline'       no network: the shell runs from what this device kept (the remembered person and the saved query cache).
 *      'reconnecting'  the network is up but the session could not be confirmed yet (a slow or failing connection,
 *                      or a token refresh that has not gone through); the shell runs from what was kept meanwhile.
 *  - holdNetwork(): while the shell runs on a remembered person with no live token, data requests would go out with the
 *    anonymous key and come back empty. holdNetwork(true) tells TanStack Query it is offline, so queries pause (screens keep
 *    the saved data) instead of caching empty lists, and resume by themselves once the session is live.
 */
export type Connection = 'online' | 'offline' | 'reconnecting'

export const ConnectionContext = createContext<Connection>('online')

export function useConnection(): Connection {
  return useContext(ConnectionContext)
}

const browserOnline = (): boolean => typeof navigator === 'undefined' || navigator.onLine !== false

function subscribeOnline(cb: () => void): () => void {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, browserOnline, () => true)
}

let held = false
const holdListeners = new Set<() => void>()

export function holdNetwork(next: boolean): void {
  if (held === next) return
  held = next
  holdListeners.forEach(l => l())
}

export function isNetworkHeld(): boolean {
  return held
}

/**
 * TanStack Query's idea of "online": the browser is online AND the network is not held. Unlike TanStack's default (which
 * assumes online until an `offline` event), a cold start with no signal starts offline, so queries pause instead of
 * failing one by one; they resume on the `online` event.
 */
export function wireOnlineManager(manager: typeof OnlineManager): void {
  manager.setEventListener(setOnline => {
    if (typeof window === 'undefined') return undefined
    const update = () => setOnline(browserOnline() && !held)
    const stop = subscribeOnline(update)
    holdListeners.add(update)
    update()
    return () => {
      stop()
      holdListeners.delete(update)
    }
  })
}
