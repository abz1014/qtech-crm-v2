import { useCallback, useState } from 'react'

/* Whether the person collapsed the forest rail to 72 (kept on this device; Rail.tsx). */
const STORE = 'qtech.rail'

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORE) === 'collapsed'
  } catch {
    return false
  }
}

export function useRailCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const toggle = useCallback(() => {
    setCollapsed(c => {
      const next = !c
      try {
        if (next) window.localStorage.setItem(STORE, 'collapsed')
        else window.localStorage.removeItem(STORE)
      } catch {
        // private window or blocked storage: the choice lasts for this visit only
      }
      return next
    })
  }, [])
  return [collapsed, toggle]
}
