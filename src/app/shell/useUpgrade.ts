import { useCallback, useEffect, useState } from 'react'
import { whenContentDrawn } from '@/lib/afterContent'

/** How long after the page's content is drawn the shell's menus are made ready, when nobody has reached for one. */
const READY_AFTER_MS = 1500

/*
 * The shell's menus (New, the account menu) need Radix's popover, which is about a fifth of the first download. The top bar shows a
 * plain button with the same look first; the real menu is downloaded once the page's content is drawn, or at once when a pointer
 * or the keyboard reaches for it, the download starts (perf: first-load JS, LCP), and a click swaps in the menu already open: `openFirst`
 * is passed on as the menu's defaultOpen.
 */
export function useUpgrade(load: () => Promise<unknown>) {
  const [on, setOn] = useState(false)
  const [openFirst, setOpenFirst] = useState(false)
  useEffect(() => {
    let t: number | undefined
    whenContentDrawn(() => {
      t = window.setTimeout(() => setOn(true), READY_AFTER_MS)
    })
    return () => window.clearTimeout(t)
  }, [])
  // Reaching for the button only starts the download: the button itself is swapped later (on a click, or when content is drawn), never
  // between a press and its click, which would lose the tap.
  const upgrade = useCallback(() => void load().catch(() => undefined), [load])
  const upgradeAndOpen = useCallback(() => {
    setOpenFirst(true)
    setOn(true)
  }, [])
  return { on, openFirst, upgrade, upgradeAndOpen }
}
