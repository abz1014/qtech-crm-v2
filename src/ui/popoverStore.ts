import { createContext, useSyncExternalStore } from 'react'
import type * as Impl from '@/ui/popoverImpl'

/* The state shared by Popover (light) and popoverImpl (Radix): see src/ui/Popover.tsx. */
export const OpenState = createContext<{ open: boolean; close: () => void } | null>(null)
export const Want = createContext<(() => void) | null>(null)

let impl: typeof Impl | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

/** Download the Radix half (once). Safe to call from anywhere, any number of times. */
export function preloadPopover(): Promise<void> {
  loading ??= import('@/ui/popoverImpl').then(
    m => {
      impl = m
      listeners.forEach(l => l())
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
export const usePopoverImpl = () => useSyncExternalStore(subscribe, () => impl, () => impl)
