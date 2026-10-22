import { createElement, forwardRef, lazy, useCallback, useMemo, useState, type ComponentProps, type ComponentType, type LazyExoticComponent } from 'react'
import { PlainError } from '@/lib/errors/plainError'
import { hasDirtyForms } from '@/lib/pwa/dirtyForms'
import { applyUpdate } from '@/lib/pwa/updates'

/*
 * Lazy chunks after a deploy (phone audit 2a). A window that has been open since before a deploy still runs the old
 * build. When it asks for one of the old build's chunks that is not in its precache (the PDF renderer is too big to
 * precache), the host answers the missing /assets/*.js with the app's HTML, and the dynamic import fails with a MIME or
 * "Failed to fetch dynamically imported module" error. Making a quotation PDF then breaks until the person reloads.
 *
 * importWithReload() retries the import once (a dropped connection), and if it still fails with a chunk-load error it
 * moves the page onto the new build:
 *   - a new service worker is waiting: it takes over and the page reloads (the same path as Reload in the
 *     "New version available" toast, src/lib/pwa/updates.ts);
 *   - otherwise the page reloads once. A sessionStorage mark stops a second automatic reload, so a chunk that is
 *     really missing cannot loop; the mark is cleared by the next import that works.
 * It never reloads over unsaved typing (hasDirtyForms, the same rule the update toast follows), and never while
 * offline (a reload cannot fetch anything new). In those cases, and when the one reload is spent, it throws a
 * PlainError whose sentence says what to do; mapPgError shows it as it is.
 */
export const RELOAD_MARK = 'qtech.chunkReload'

/** How long to wait for a waiting worker to take over before giving up on it. */
const TAKEOVER_MS = 10_000

/** Swappable in tests (jsdom cannot navigate). */
export const pageReload = { run: (): void => window.location.reload() }

const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|is not a valid JavaScript MIME type|Unable to preload CSS|ChunkLoadError|Loading (CSS )?chunk [\w-]+ failed|Unexpected token '<'/i

/** A dynamic import that failed because the file could not be fetched or was not JavaScript (HTML from the SPA rewrite). */
export function isChunkLoadError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const { name, message } = err as { name?: unknown; message?: unknown }
  return name === 'ChunkLoadError' || (typeof message === 'string' && CHUNK_ERROR.test(message))
}

export class StaleAppError extends PlainError {
  constructor(message: string, code: 'offline' | 'unsaved' | 'reload-spent' | 'not-loaded') {
    super(message, code)
    this.name = 'StaleAppError'
  }
}

const OFFLINE = 'You are offline, and this part of Q-Tech has not been downloaded to this device yet. Try again when you have signal.'
const UNSAVED = 'Q-Tech has been updated. Save what you are typing, then reload the page and try again.'
const SPENT = 'Q-Tech has been updated. Close the app (or the tab) and open it again, then try once more.'
const NOT_LOADED = 'This part of Q-Tech could not be downloaded. Check your signal, then try again.'

function readMark(): boolean {
  try {
    return window.sessionStorage.getItem(RELOAD_MARK) !== null
  } catch {
    return false
  }
}
function writeMark(on: boolean): void {
  try {
    if (on) window.sessionStorage.setItem(RELOAD_MARK, String(Date.now()))
    else window.sessionStorage.removeItem(RELOAD_MARK)
  } catch {
    /* storage blocked: the reload still happens once per failure, which the person triggers */
  }
}

/** Never settles while the page is on its way to reloading; gives up with a plain sentence if the takeover stalls. */
function waitForReload(): Promise<never> {
  return new Promise((_, reject) => {
    window.setTimeout(() => reject(new StaleAppError(SPENT, 'reload-spent')), TAKEOVER_MS)
  })
}

async function recover(): Promise<never> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new StaleAppError(OFFLINE, 'offline')
  if (hasDirtyForms()) throw new StaleAppError(UNSAVED, 'unsaved')
  // A new worker is waiting: let it take over. updates.ts reloads the page when it does.
  if (applyUpdate() === 'applying') {
    writeMark(true)
    return waitForReload()
  }
  if (readMark()) throw new StaleAppError(SPENT, 'reload-spent')
  writeMark(true)
  pageReload.run()
  return waitForReload()
}

/**
 * `await importWithReload(() => import('./heavy'))`: a dynamic import that survives a deploy. Errors that are not
 * about loading the chunk (the module itself threw) are rethrown untouched.
 */
export interface ImportOptions {
  /**
   * false: never reload the page, just throw the plain sentence. For loads nobody asked for (an idle-time preload): a
   * reload the person did not cause would be a surprise, and the failure must stay local to the part that needed the chunk.
   */
  reload?: boolean
}

export async function importWithReload<T>(load: () => Promise<T>, { reload = true }: ImportOptions = {}): Promise<T> {
  let mod: T
  try {
    mod = await load()
  } catch {
    try {
      mod = await load()
    } catch (err) {
      if (!isChunkLoadError(err)) throw err
      if (!reload) {
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false
        throw new StaleAppError(offline ? OFFLINE : NOT_LOADED, offline ? 'offline' : 'not-loaded')
      }
      return recover()
    }
  }
  if (readMark()) writeMark(false)
  return mod
}

/** React.lazy with the same recovery. A drop-in for `lazy` in the route table. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the same constraint React.lazy itself uses
export function lazyWithReload<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>, options?: ImportOptions): LazyExoticComponent<T> {
  // React.lazy keeps a failed download for good. A part that could not be downloaded (no signal) is tried again the next time it
  // is drawn (ChunkBoundary draws it again when the phone is back online): each failure swaps in a fresh lazy component.
  let current: LazyExoticComponent<T>
  const make = (): LazyExoticComponent<T> =>
    lazy(() =>
      importWithReload(factory, options).catch((err: unknown) => {
        current = make()
        throw err
      }),
    )
  current = make()
  const Retrying = forwardRef<unknown, ComponentProps<T>>((props, ref) => createElement(current, { ...props, ref } as ComponentProps<T>))
  return Retrying as unknown as LazyExoticComponent<T>
}

/**
 * A lazy component that can be tried again. React.lazy keeps a failed import for good, so `retry()` makes a fresh one.
 * Pair it with <LoadBoundary key={attempt}> (src/ui/LoadBoundary.tsx) so a chunk that cannot load (no signal) breaks
 * only that part, not the whole app (hunt HE-2). The first attempt is often an idle-time preload: it never reloads the
 * page (`reload: false`); an attempt the person asked for (retry) may, under importWithReload's usual rules.
 * `factory` must be stable (a module-level function).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the same constraint React.lazy itself uses
export function useRetryableLazy<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  const [attempt, setAttempt] = useState(0)
  const Component = useMemo(() => lazyWithReload(factory, { reload: attempt > 0 }), [factory, attempt])
  const retry = useCallback(() => setAttempt(a => a + 1), [])
  return { Component, attempt, retry }
}
