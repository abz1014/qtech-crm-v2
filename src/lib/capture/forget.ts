import { clearCaptures, safely } from './store'
import { clearRecents } from './recents'

/** The key prefix of the command palette's recent items, one key per person (PALETTE_RECENT_PREFIX in CommandPalette.tsx). */
export const PALETTE_RECENT_KEYS = 'qtech.palette.recent'

/** Every person's palette recents on this device, and the old shared key (BUG-RV-04). */
export function forgetPaletteRecents(): void {
  try {
    const keys = Object.keys(window.localStorage).filter(k => k === PALETTE_RECENT_KEYS || k.startsWith(`${PALETTE_RECENT_KEYS}.`))
    for (const k of keys) window.localStorage.removeItem(k)
  } catch {
    /* storage blocked: nothing was kept */
  }
}

/*
 * Security review L-5: on sign-out, this device forgets what the person captured (drafts in IndexedDB), which RFQs and
 * orders they opened (localStorage) and any half-typed New RFQ (localStorage, src/features/rfqs/lib/intakeDraftStore.ts), so
 * the next person who signs in on a shared phone or PC does not see them.
 * A share that arrives while nobody is signed in is still kept: it is cleared only by an explicit sign-out.
 */
/** The key prefix of the New RFQ drafts (INTAKE_DRAFT_PREFIX in intakeDraftStore.ts; a test there holds the two together). */
export const INTAKE_DRAFT_KEYS = 'qtech.rfqs.intakeDraft.'

/**
 * Every New RFQ draft on this device. Sign-out calls it twice: first with the rest, then again once the session has ended, so a
 * draft the open New RFQ screen kept while the sign-out was on its way is not left behind (review of ux/rfqs, item 14).
 */
export function forgetIntakeDrafts(): void {
  try {
    const keys = Object.keys(window.localStorage).filter(k => k.startsWith(INTAKE_DRAFT_KEYS))
    for (const k of keys) window.localStorage.removeItem(k)
  } catch {
    /* storage blocked: nothing was kept */
  }
}

let wiping: Promise<void> | null = null

/**
 * Wipes what this device kept for the person. Sign-out paths overlap (the button, then Auth's SIGNED_OUT), so calls made
 * while a wipe is running share it instead of starting another.
 */
export function forgetDeviceCaptures(): Promise<void> {
  if (wiping) return wiping
  clearRecents()
  forgetIntakeDrafts()
  forgetPaletteRecents()
  wiping = safely(() => clearCaptures(), undefined).finally(() => {
    wiping = null
  })
  return wiping
}
