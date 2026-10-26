import { useSyncExternalStore } from 'react'
import type { Workbox } from 'workbox-window'
import { hasDirtyForms, hasOpenDialog, isTypingNow } from '@/lib/pwa/dirtyForms'
import { RUNNING_BUILD } from '@/lib/pwa/buildInfo'

/*
 * Service worker registration and the update flow (R21; safe auto-update 2026-10-26).
 *
 * A new deploy installs a new worker that waits. It used to wait for a tap on the toast, so an installed or long-open app could
 * stay on an old build for days (the owner kept seeing old versions). Now the page switches to it by itself, but only at a SAFE
 * moment (isSafeToSwitch): the app is on screen, nothing is being typed, no form holds unsaved edits and no dialog is open.
 *   - on the next start (a worker already waiting when the app opens),
 *   - when the person comes back to the app (visibilitychange to visible), which also asks the browser for a new worker, so a
 *     deploy made while the app sat in the background is picked up the moment it is looked at,
 *   - when /version.json names a build other than this one (src/lib/pwa/minVersion.ts): the worker is fetched at once.
 * At any other moment the quiet toast stays ("New version ready. Reload to update (your typing is kept)."): the person's typing
 * is never thrown away, and a waiting worker still takes over at the next safe moment or the next normal visit.
 */
let ready = false
let wb: Workbox | null = null
let reloadWanted = false
let resumedAt = Date.now()
let updating: Promise<void> | null = null
const listeners = new Set<() => void>()

/** A worker that turns up this soon after the app started or came back to the front is the one that return asked for. */
const RESUME_WINDOW_MS = 30_000

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const emit = () => listeners.forEach(l => l())

export function useUpdateReady(): boolean {
  return useSyncExternalStore(subscribe, () => ready, () => false)
}

/** True once the page has been told to switch: the toast has nothing to offer then. */
export function isApplyingUpdate(): boolean {
  return reloadWanted
}

export interface SafeMoment {
  visible: boolean
  /** A form holds unsaved edits, or a field has text being typed. */
  typing: boolean
  dialogOpen: boolean
}

/** Whether the page may switch to a new build by itself right now: on screen, idle, no dialog. Pure, so it is tested alone. */
export function isSafeToSwitch(m: SafeMoment): boolean {
  return m.visible && !m.typing && !m.dialogOpen
}

function safeNow(): boolean {
  return isSafeToSwitch({
    visible: typeof document !== 'undefined' && document.visibilityState === 'visible',
    typing: hasDirtyForms() || isTypingNow(),
    dialogOpen: hasOpenDialog(),
  })
}

function switchToWaiting(): void {
  reloadWanted = true
  wb?.messageSkipWaiting()
}

/** Switch to the waiting worker if now is a safe moment. */
function tryAutoApply(): boolean {
  if (!wb || !ready || reloadWanted || !safeNow()) return false
  switchToWaiting()
  return true
}

/** Ask the browser for the newest service worker now (one request at a time). Never throws. */
export function checkForNewWorker(): Promise<void> {
  if (!wb) return Promise.resolve()
  if (!updating) {
    const instance = wb
    updating = (async () => {
      try {
        await instance.update()
      } catch {
        // offline, or not registered yet: nothing to do now
      } finally {
        updating = null
      }
    })()
  }
  return updating
}

/** /version.json names this build, or another one: another one means a deploy has landed. */
export function noteDeployedBuild(published: unknown): void {
  const build = typeof published === 'object' && published !== null ? (published as { build?: unknown }).build : undefined
  if (typeof build === 'string' && build && build !== RUNNING_BUILD) void checkForNewWorker()
}

export type ApplyResult = 'applying' | 'blocked' | 'none'

export function applyUpdate(): ApplyResult {
  if (!wb || !ready) return 'none'
  if (hasDirtyForms()) return 'blocked'
  switchToWaiting()
  return 'applying'
}

export type CheckResult = 'latest' | 'updating' | 'blocked' | 'offline' | 'pending'

/**
 * "Check for update now" (the version label): ask the server which build is live, fetch its worker, and switch to it when one
 * is waiting. A form with unsaved edits blocks it, as the toast's Reload does. Never throws.
 */
export async function checkForUpdateNow(waitMs = 8_000, fetcher: typeof fetch = fetch): Promise<CheckResult> {
  let published: { build?: unknown } | null = null
  try {
    const res = await fetcher('/version.json', { cache: 'no-store', headers: { accept: 'application/json' } })
    if (!res.ok) return 'offline'
    published = (await res.json()) as { build?: unknown }
  } catch {
    return 'offline'
  }
  const build = typeof published?.build === 'string' ? published.build : ''
  const newer = build !== '' && build !== RUNNING_BUILD
  if (!ready && !newer) {
    await checkForNewWorker() // a worker may be waiting that /version.json has not caught up with
    if (!ready) return 'latest'
  }
  if (hasDirtyForms()) return 'blocked'
  if (!wb) {
    // No worker (a browser without service workers): a plain reload fetches the new build.
    window.location.reload()
    return 'updating'
  }
  if (!ready) {
    await checkForNewWorker()
    const until = Date.now() + waitMs
    while (!ready && Date.now() < until) await new Promise(r => setTimeout(r, 250))
    if (!ready) return 'pending'
  }
  if (hasDirtyForms()) return 'blocked'
  switchToWaiting()
  return 'updating'
}

/**
 * "Update needed — tap Reload" (owner decision 2026-10-22, pwa/minVersion.ts): move this window onto the newest build. A worker
 * already waiting takes over and the page reloads when it controls; otherwise the browser is asked for the new worker first
 * (up to `waitMs`), because a plain reload would be answered by the OLD worker's cached shell. With no worker at all (a browser
 * without service workers, or the dev server) it is a plain reload. The caller decides about unsaved typing first.
 */
export async function reloadOntoNewVersion(waitMs = 10_000): Promise<void> {
  const takeOver = (): boolean => {
    if (!wb || !ready) return false
    reloadWanted = true
    wb.messageSkipWaiting()
    return true
  }
  if (takeOver()) return
  // No worker controls this page (none registered, or service workers are off): a plain reload already fetches the new build.
  const controlled = typeof navigator !== 'undefined' && 'serviceWorker' in navigator && navigator.serviceWorker.controller !== null
  if (wb && controlled) {
    try {
      await wb.update()
    } catch {
      // offline or the check failed: fall through to the plain reload
    }
    const until = Date.now() + waitMs
    while (!ready && Date.now() < until) await new Promise(r => setTimeout(r, 250))
    if (takeOver()) return
  }
  window.location.reload()
}

export async function registerServiceWorker(): Promise<void> {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  if (wb) return
  // Loaded on demand, not in the first-load JS (bundle budget, P04): registration waits for nothing on screen.
  // No signal on a first visit: the chunk cannot load. Registration is retried on the next page load; nothing to tell anyone.
  const loaded = await import('workbox-window').catch(() => null)
  if (!loaded || wb) return
  const { Workbox } = loaded
  const instance = new Workbox('/sw.js', { scope: '/' })
  wb = instance
  instance.addEventListener('waiting', () => {
    ready = true
    // Right after the app opened or came back to the front, at a safe moment: switch now (before the toast is drawn).
    if (Date.now() - resumedAt <= RESUME_WINDOW_MS) tryAutoApply()
    emit()
  })
  instance.addEventListener('controlling', () => {
    if (reloadWanted) window.location.reload()
  })
  resumedAt = Date.now()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    resumedAt = Date.now()
    if (!tryAutoApply()) void checkForNewWorker()
  })
  window.addEventListener('online', () => void checkForNewWorker())
  void instance.register().catch(() => {
    // Registration refused (private mode, storage full, a blocked /sw.js): the app works without offline support, and an
    // unhandled rejection here would only be noise. Let a later page load try again.
    if (wb === instance) wb = null
  })
}

/** Tests only. */
export function resetUpdatesForTests(): void {
  ready = false
  wb = null
  reloadWanted = false
  updating = null
  resumedAt = Date.now()
  listeners.clear()
}
