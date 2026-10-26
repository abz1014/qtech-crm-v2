import { useSyncExternalStore } from 'react'

/*
 * Text size (owner decision, DECISIONS 2026-10-19). "Normal" is the bigger default scale in docs/design/tokens.css;
 * "Smaller" puts data-text="small" on <html>, which restores the old 12/13/14 px scale and 32/40 px heights; "Larger" puts
 * data-text="large" there: 18 px text (16 px timestamps) and 48 px controls.
 *
 *   - Kept per device in localStorage (`qtech.text-size`), like the table density. Storage can be missing or
 *     throw (a private window, blocked site data): every read and write is in try/catch and the size is Normal.
 *   - Applied before the first paint: main.tsx calls applyStoredTextSize() before React renders anything, so the
 *     page never draws at one size and jumps to the other. (The CSP allows no inline script in index.html.)
 *   - Changed live from the account menu and Settings > Your details; other tabs follow through the storage event.
 * The <html> attribute is the source of truth that every hook reads.
 */
export type TextSize = 'normal' | 'small' | 'large'

export const TEXT_SIZE_KEY = 'qtech.text-size'

/** The stored choice, or Normal when nothing (or nothing readable) is stored. */
export function readTextSize(): TextSize {
  try {
    const v = window.localStorage.getItem(TEXT_SIZE_KEY)
    return v === 'small' || v === 'large' ? v : 'normal'
  } catch {
    return 'normal'
  }
}

/** Puts the size on <html> (or another root): data-text="small" or "large", or no attribute for Normal. */
export function applyTextSize(size: TextSize, root: HTMLElement = document.documentElement): void {
  if (size === 'small' || size === 'large') root.dataset.text = size
  else delete root.dataset.text
}

/** The earliest bootstrap step: read the stored choice and apply it. Returns what was applied. */
export function applyStoredTextSize(): TextSize {
  const size = readTextSize()
  applyTextSize(size)
  return size
}

const listeners = new Set<() => void>()
const notify = () => listeners.forEach(l => l())

/** Store, apply and tell every mounted control. The choice still applies when storage refuses it. */
export function setTextSize(size: TextSize): void {
  try {
    if (size === 'small' || size === 'large') window.localStorage.setItem(TEXT_SIZE_KEY, size)
    else window.localStorage.removeItem(TEXT_SIZE_KEY)
  } catch {
    /* not remembered on this device, still applied now */
  }
  applyTextSize(size)
  notify()
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  // Another tab changed it: follow.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== TEXT_SIZE_KEY) return
    applyTextSize(readTextSize())
    notify()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onStorage)
  }
}

const current = (): TextSize => {
  const v = document.documentElement.dataset.text
  return v === 'small' || v === 'large' ? v : 'normal'
}

/** The text size now, and the setter. Every control that shows the choice reads this, so they never disagree. */
export function useTextSize(): [TextSize, (size: TextSize) => void] {
  const size = useSyncExternalStore(subscribe, current, () => 'normal' as const)
  return [size, setTextSize]
}
