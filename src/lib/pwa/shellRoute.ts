/*
 * The one thing the service worker answers besides its precache: a page navigation to this app's own
 * origin gets the cached app shell (index.html), so the SPA opens and the router takes over.
 * Everything else (every Supabase request, any fetch, any other origin, files with an extension)
 * is NOT matched, so the worker never touches it and the browser goes to the network as if no
 * worker existed. Nothing that carries data or a session is ever stored.
 */
export function isShellNavigation(request: { mode: string }, url: URL, ownOrigin: string): boolean {
  if (request.mode !== 'navigate') return false
  if (url.origin !== ownOrigin) return false
  return !/\.[a-z0-9]+$/i.test(url.pathname)
}
