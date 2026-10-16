/*
 * Service worker (R21, R22). App-shell precache, one share-target handler, and nothing else.
 *
 *  - Precache: the built JS, CSS, HTML, fonts and brand images that vite-plugin-pwa injects as __WB_MANIFEST. There is no
 *    runtime caching and no fetch handler of our own: a request that is not in the precache list falls through to the
 *    network untouched, so no Supabase response (REST, auth, storage, functions) is ever seen or stored.
 *    src/sw.test.ts asserts it.
 *  - Navigations: a same-origin page navigation gets the cached app shell.
 *  - Share target (R22): the one POST the manifest's share_target sends to /capture is stored in IndexedDB (src/lib/capture)
 *    and answered with a redirect to the Capture sheet. It is same-origin, user-initiated and never leaves the device.
 *
 * Updates: a new worker installs and WAITS. The page asks it to take over (SKIP_WAITING) only when the person presses
 * Reload in the "New version available" toast (src/lib/pwa/updates.ts).
 */
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { handleShareRequest, isShareRequest } from './lib/capture/shareTarget'
import { isShellNavigation } from './lib/pwa/shellRoute'

declare const self: {
  // The literal `self.__WB_MANIFEST` below is what vite-plugin-pwa replaces with the precache list.
  __WB_MANIFEST: Array<string | { url: string; revision: string | null }>
}
const sw = self as unknown as {
  location: Location
  skipWaiting: () => void
  addEventListener: (type: 'message', listener: (e: { data?: { type?: string } }) => void) => void
}

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
clientsClaim()

registerRoute(({ request, url }) => isShellNavigation(request, url, sw.location.origin), createHandlerBoundToURL('/index.html'))

registerRoute(
  ({ request, url }) => isShareRequest(request, url, sw.location.origin),
  ({ request }: { request: Request }) => handleShareRequest(request, sw.location.origin),
  'POST',
)

sw.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') sw.skipWaiting()
})
