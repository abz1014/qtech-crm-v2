import { useEffect, useState, type RefObject } from 'react'
import { CloudOff } from 'lucide-react'
import { useConnection } from '@/lib/connection'
import { useSlowLoad } from '@/lib/useSlowLoad'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'

/*
 * Offline and nothing kept for this page (review 24 Nov, screen 11). The banner says "Saved records are shown", but a page that
 * was never opened on this device has nothing saved: its code or its data cannot download, TanStack pauses the reads, and the
 * page sat on grey placeholders for good. Two shared places say so instead:
 *  - PageLoading (the route fallback while a page's code downloads) shows this message in place of its placeholders;
 *  - OfflineSkeletonNotice (in the shell, over every page) shows it above any page whose placeholders are still on screen, and
 *    stops their pulse, so a page waiting for data reads as waiting for the connection, not as loading.
 * Both wait a moment first: a page whose code and data this device kept still draws its placeholders for a frame or two.
 */
export const NOT_OPENED_TEXT = 'This page has not been opened on this device yet. It loads when the connection is back.'

/** How long a placeholder may show while offline before PageLoading says why. */
export const OFFLINE_GRACE_MS = 800
/** The shell notice waits longer, so it never shows for the moment PageLoading's placeholders are on screen. */
export const OFFLINE_NOTICE_MS = OFFLINE_GRACE_MS * 2

/** The message as a card: a cloud with a line through it and the one sentence. */
export function NotOpenedMessage({ className }: { className?: string }) {
  return (
    <p
      data-offline-not-opened
      className={cn('flex items-start gap-3 rounded-card bg-tone-info-bg px-card py-4 text-base text-tone-info-fg', className)}
    >
      <Icon icon={CloudOff} className="mt-px shrink-0" />
      <span className="min-w-0 text-pretty text-fg">{NOT_OPENED_TEXT}</span>
    </p>
  )
}

/**
 * Watches the page area (`root`, the shell's #main) while offline. Once grey placeholders (.skeleton) have stayed on it for
 * OFFLINE_NOTICE_MS, the message shows above the page and the placeholders stop pulsing (`data-offline-waiting`, index.css). It
 * goes by itself as soon as the page draws or the connection is back. The message sits in a polite live region that is always on
 * the page, so a screen reader hears it when it appears.
 */
export function OfflineSkeletonNotice({ root }: { root: RefObject<HTMLElement | null> }) {
  // offline or reconnecting: the same states the offline banner shows
  const offline = useConnection() !== 'online'
  const [placeholders, setPlaceholders] = useState(false)
  useEffect(() => {
    const el = root.current
    if (!offline || !el || typeof MutationObserver === 'undefined') {
      setPlaceholders(false)
      return
    }
    const check = () => setPlaceholders(el.querySelector('.skeleton') !== null)
    check()
    const mo = new MutationObserver(check)
    mo.observe(el, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [offline, root])
  const waiting = useSlowLoad(offline && placeholders, OFFLINE_NOTICE_MS)

  useEffect(() => {
    const el = root.current
    if (!el || !waiting) return
    el.dataset.offlineWaiting = ''
    return () => {
      delete el.dataset.offlineWaiting
    }
  }, [root, waiting])

  return (
    <div aria-live="polite" data-offline-notice>
      {waiting ? (
        <div className="mx-auto w-full max-w-table px-4 pt-4 md:px-8 md:pt-6">
          <NotOpenedMessage />
        </div>
      ) : null}
    </div>
  )
}
