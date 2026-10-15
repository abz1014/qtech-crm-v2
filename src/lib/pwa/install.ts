import { useSyncExternalStore } from 'react'

/*
 * Install prompt state (R21). Chrome and Edge on Android fire `beforeinstallprompt`; we keep the event (and
 * silence the browser's own bar) so Settings and the account menu can offer "Install". iPhone Safari has no
 * such event, so it gets a hint: Share, then Add to Home Screen. Dismissals are remembered on this device.
 */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export const DISMISS_KEY = 'qtech.install.dismissed'
export const IOS_HINT_KEY = 'qtech.install.iosHintSeen'
export const IOS_BANNER_KEY = 'qtech.install.iosBannerDismissed'

let deferred: InstallPromptEvent | null = null
let snapshot = { canPrompt: false }
const listeners = new Set<() => void>()
const emit = () => {
  snapshot = { canPrompt: deferred !== null }
  listeners.forEach(l => l())
}

export function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}
export function writeFlag(key: string): void {
  try {
    window.localStorage.setItem(key, '1')
  } catch {
    /* private window: the hint may show again, which is harmless */
  }
}

let capturing = false
/** Call once at startup (main.tsx) so the event is not missed before the UI mounts. */
export function initInstallCapture(): void {
  if (capturing || typeof window === 'undefined') return
  capturing = true
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault()
    deferred = e as InstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    emit()
  })
}

/** Shows the browser's install dialog. Resolves true when the person accepted. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred
  if (!e) return false
  deferred = null
  emit()
  await e.prompt()
  const { outcome } = await e.userChoice
  return outcome === 'accepted'
}

/** iPhone and iPad Safari (not Chrome or Firefox on iOS, whose menus differ from the Share-sheet route we describe). */
export function isIosSafari(ua: string, maxTouchPoints = 0): boolean {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)
  if (!ios) return false
  return /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua)
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true
}

export interface InstallState {
  /** The browser has offered an install and it has not been used. */
  canPrompt: boolean
  /** iPhone Safari in the browser (not yet on the home screen). */
  showIosHint: boolean
}

export function useInstall(): InstallState {
  const s = useSyncExternalStore(
    l => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => snapshot,
    () => snapshot,
  )
  const ios = typeof navigator !== 'undefined' && isIosSafari(navigator.userAgent, navigator.maxTouchPoints)
  const standalone = isStandalone()
  return { canPrompt: s.canPrompt && !standalone, showIosHint: ios && !standalone }
}

/** Tests only. */
export function resetInstallForTests(): void {
  deferred = null
  capturing = false
  snapshot = { canPrompt: false }
  listeners.clear()
}
