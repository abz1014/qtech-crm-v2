import { useSyncExternalStore } from 'react'

/*
 * Single-key shortcuts (WCAG 2.2 SC 2.1.4). N, C, G then T and "/" act on one printable key outside a text field.
 * Speech-input users and stray keystrokes can trigger them, so Settings > Your details can turn them off.
 * On by default; kept per device in localStorage (`qtech.single-keys`) like the text size. Ctrl+K and Ctrl+Z stay.
 */
export const SINGLE_KEYS_KEY = 'qtech.single-keys'

const listeners = new Set<() => void>()
let memory: boolean | null = null

function stored(): boolean {
  try {
    return window.localStorage.getItem(SINGLE_KEYS_KEY) !== 'off'
  } catch {
    return true
  }
}

/** Read inside a key handler: true when single-key shortcuts may run (the default). */
export function shortcutsEnabled(): boolean {
  return memory ?? stored()
}

/**
 * True while something that owns the keyboard is open: a dialog, an alert dialog or a menu. Page shortcuts (N, C, "/",
 * Ctrl+K) wait until it closes. A panel that sits beside the page and says so (aria-modal="false", the desktop Help panel)
 * does not count, so the page's keys keep working next to it.
 */
export function blockingOverlayOpen(): boolean {
  return Boolean(document.querySelector('[role="dialog"]:not([aria-modal="false"]),[role="alertdialog"],[role="menu"]'))
}

export function setSingleKeyShortcuts(on: boolean): void {
  memory = on
  try {
    if (on) window.localStorage.removeItem(SINGLE_KEYS_KEY)
    else window.localStorage.setItem(SINGLE_KEYS_KEY, 'off')
  } catch {
    /* applies to this session only */
  }
  listeners.forEach(l => l())
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== SINGLE_KEYS_KEY) return
    memory = null
    onChange()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onStorage)
  }
}

export function useSingleKeyShortcuts(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, shortcutsEnabled, () => true)
  return [on, setSingleKeyShortcuts]
}
