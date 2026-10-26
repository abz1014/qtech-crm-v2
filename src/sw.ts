/*
 * Service worker (R21, R22). App-shell precache, one share-target handler, and nothing else.
 *
 *  - Precache: the built JS, CSS, HTML, fonts and brand images that vite-plugin-pwa injects as __WB_MANIFEST. There is no
 *    runtime caching and no fetch handler of our own: a request that is not in the precache list falls through to the
 *    network untouched, so no Supabase response (REST, auth, storage, functions) is ever seen or stored.
 *    src/sw.test.ts asserts it.
 *  - Navigations: a same-origin page navigation asks the network for the page first (revalidated, never the browser's HTTP
 *    cache), so a fresh visit gets the newest index.html and its new asset names; only when the network is offline, fails or
 *    takes longer than NETWORK_WAIT_MS does it get the cached app shell. The response is passed on and never stored.
 *  - Share target (R22): the one POST the manifest's share_target sends to /capture is stored in IndexedDB (src/lib/capture)
 *    and answered with a redirect to the Capture sheet. It is same-origin, user-initiated and never leaves the device.
 *
 * Updates: a new worker installs and WAITS. The page asks it to take over (SKIP_WAITING) at a safe moment (the app is on
 * screen, nothing typed, no dialog open) or when the person presses Reload in the "New version ready" toast
 * (src/lib/pwa/updates.ts).
 */
import { clientsClaim, type RouteHandlerCallbackOptions } from 'workbox-core'
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

/** How long a page open waits for the network before it takes the cached shell. */
const NETWORK_WAIT_MS = 3000
const cachedShell = createHandlerBoundToURL('/index.html')

async function freshShell(options: RouteHandlerCallbackOptions): Promise<Response> {
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), NETWORK_WAIT_MS)
  try {
    const res = await fetch(options.request, { cache: 'no-cache', signal: stop.signal })
    // Only a real page counts: an error page or anything else falls back to the shell that is known to work.
    if (res.ok && !res.redirected && (res.headers.get('content-type') ?? '').includes('text/html')) return res
  } catch {
    // offline, or too slow: the cached shell below
  } finally {
    clearTimeout(timer)
  }
  return cachedShell(options)
}

registerRoute(({ request, url }) => isShellNavigation(request, url, sw.location.origin), freshShell)

registerRoute(
  ({ request, url }) => isShareRequest(request, url, sw.location.origin),
  ({ request }: { request: Request }) => handleShareRequest(request, sw.location.origin),
  'POST',
)

sw.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') sw.skipWaiting()
})
