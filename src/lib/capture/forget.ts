import { clearCaptures, safely } from './store'
import { clearRecents } from './recents'

/*
 * Security review L-5: on sign-out, this device forgets what the person captured (drafts in IndexedDB), which RFQs and
 * orders they opened (localStorage) and any half-typed New RFQ (localStorage, src/features/rfqs/lib/intakeDraftStore.ts), so
 * the next person who signs in on a shared phone or PC does not see them.
 * A share that arrives while nobody is signed in is still kept: it is cleared only by an explicit sign-out.
 */
/** The key prefix of the New RFQ drafts (INTAKE_DRAFT_PREFIX in intakeDraftStore.ts; a test there holds the two together). */
export const INTAKE_DRAFT_KEYS = 'qtech.rfqs.intakeDraft.'

function clearIntakeDrafts(): void {
  try {
    const keys = Object.keys(window.localStorage).filter(k => k.startsWith(INTAKE_DRAFT_KEYS))
    for (const k of keys) window.localStorage.removeItem(k)
  } catch {
    /* storage blocked: nothing was kept */
  }
}

export async function forgetDeviceCaptures(): Promise<void> {
  clearRecents()
  clearIntakeDrafts()
  await safely(() => clearCaptures(), undefined)
}
