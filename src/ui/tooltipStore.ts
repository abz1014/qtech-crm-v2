import { useSyncExternalStore } from 'react'
import { swapKeepingFocus } from '@/ui/keepFocus'
import type * as Impl from '@/ui/tooltipImpl'

/* The Radix half of Tooltip and TruncateTip (src/ui/Tooltip.tsx), loaded once for the whole app, as popoverStore.ts does for Popover. */
let impl: typeof Impl | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

/** Download the Radix half (once). Safe to call from anywhere, any number of times. */
export function preloadTooltip(): Promise<void> {
  loading ??= import('@/ui/tooltipImpl').then(
    m => {
      impl = m
      swapKeepingFocus(() => listeners.forEach(l => l()))
    },
    () => {
      loading = null // a failed download is tried again next time
    },
  )
  return loading
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}
export const useTooltipImpl = () => useSyncExternalStore(subscribe, () => impl, () => impl)
