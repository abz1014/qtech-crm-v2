/*
 * Service worker (R21). App-shell precache ONLY: the built JS, CSS, HTML, fonts and brand images that
 * vite-plugin-pwa injects as __WB_MANIFEST. There is no runtime caching, no fetch handler of our own,
 * and nothing here ever sees a Supabase response: a request that is not in the precache list, or a
 * same-origin page navigation, falls through to the network untouched. src/sw.test.ts asserts it.
 *
 * Updates: a new worker installs and WAITS. The page asks it to take over (SKIP_WAITING) only when the
 * person presses Reload in the "New version available" toast (src/lib/pwa/updates.ts).
 */
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
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

sw.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') sw.skipWaiting()
})
