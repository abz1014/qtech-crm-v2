/*
 * What waits until the opening page's content is drawn (perf/lcp): the Geist web fonts and the service worker.
 *
 * On a first visit over a slow connection, both would otherwise compete with the page's own code and data: a browser fetches
 * fonts ahead of scripts, and the service worker's install downloads the whole app shell (about 2 MB). So:
 *  - the fonts (src/index.css: `.fonts-on` on <html>) are switched on at once when the service worker already controls the
 *    page (its cache holds them), and otherwise once the content is drawn; until then text uses the system font, the same
 *    swap font-display: swap makes;
 *  - the service worker registers once the content is drawn (and the page has loaded), not at start-up.
 * When nothing is being opened ahead of the session (the sign-in form, a dev page), the content counts as drawn at once. In any
 * case everything is released after AT_THE_LATEST_MS.
 */
const AT_THE_LATEST_MS = 4_000

// Drawn until start-up says a page is being fetched ahead (startAfterContent): elsewhere (tests, tools) nothing waits.
let drawn = true
const waiting: Array<() => void> = []

function release(): void {
  if (drawn) return
  drawn = true
  for (const run of waiting.splice(0)) run()
}

/** Run `run` once the opening page's content is on screen (at once if it already is). */
export function whenContentDrawn(run: () => void): void {
  if (drawn) run()
  else waiting.push(run)
}

/** The page's content is on screen (the shell calls this when the page has its data). */
export function markContentDrawn(): void {
  // After the frame that shows the content, so what waits starts after it is painted.
  window.requestAnimationFrame(() => window.setTimeout(release, 0))
}

export function fontsOn(): void {
  document.documentElement.classList.add('fonts-on')
}

/** Decide at start-up. `pageAhead`: a page and its data are being fetched ahead of the session (routeChunks.ts). */
export function startAfterContent(pageAhead: boolean): void {
  const cached = typeof navigator !== 'undefined' && 'serviceWorker' in navigator && navigator.serviceWorker.controller !== null
  if (pageAhead) {
    drawn = false
    window.setTimeout(release, AT_THE_LATEST_MS)
  }
  if (cached) fontsOn()
  else whenContentDrawn(fontsOn)
}
