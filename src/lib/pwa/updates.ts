import { useSyncExternalStore } from 'react'
import type { Workbox } from 'workbox-window'
import { hasDirtyForms } from '@/lib/pwa/dirtyForms'

/*
 * Service worker registration and the update flow (R21).
 *
 * A new deploy installs a new worker that waits. We only flag "an update is ready"; the app shows a quiet
 * toast, and the page reloads onto the new version ONLY after the person presses Reload, and never while a
 * form holds unsaved edits (applyUpdate returns 'blocked'; the toast tells them to save first).
 * Nothing reloads on its own, and a waiting worker simply takes over on the next normal visit.
 */
let ready = false
let wb: Workbox | null = null
let reloadWanted = false
let lastCheck = 0
const listeners = new Set<() => void>()

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const emit = () => listeners.forEach(l => l())

export function useUpdateReady(): boolean {
  return useSyncExternalStore(subscribe, () => ready, () => false)
}

export type ApplyResult = 'applying' | 'blocked' | 'none'

export function applyUpdate(): ApplyResult {
  if (!wb || !ready) return 'none'
  if (hasDirtyForms()) return 'blocked'
  reloadWanted = true
  wb.messageSkipWaiting()
  return 'applying'
}

const CHECK_EVERY_MS = 60 * 60 * 1000

export async function registerServiceWorker(): Promise<void> {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  if (wb) return
  // Loaded on demand, not in the first-load JS (bundle budget, P04): registration waits for nothing on screen.
  const { Workbox } = await import('workbox-window')
  if (wb) return
  const instance = new Workbox('/sw.js', { scope: '/' })
  wb = instance
  instance.addEventListener('waiting', () => {
    ready = true
    emit()
  })
  instance.addEventListener('controlling', () => {
    if (reloadWanted) window.location.reload()
  })
  void instance.register().then(reg => {
    if (!reg) return
    lastCheck = Date.now()
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastCheck < CHECK_EVERY_MS) return
      lastCheck = now
      void reg.update().catch(() => {})
    })
  })
}

/** Tests only. */
export function resetUpdatesForTests(): void {
  ready = false
  wb = null
  reloadWanted = false
  lastCheck = 0
  listeners.clear()
}
