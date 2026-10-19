import { clearCaptures, safely } from './store'
import { clearRecents } from './recents'

/*
 * Security review L-5: on sign-out, this device forgets what the person captured (drafts in IndexedDB) and which RFQs and
 * orders they opened (localStorage), so the next person who signs in on a shared phone or PC does not see them.
 * A share that arrives while nobody is signed in is still kept: it is cleared only by an explicit sign-out.
 */
export async function forgetDeviceCaptures(): Promise<void> {
  clearRecents()
  await safely(() => clearCaptures(), undefined)
}
