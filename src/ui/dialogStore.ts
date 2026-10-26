import { createContext, useSyncExternalStore } from 'react'
import { swapKeepingFocus } from '@/ui/keepFocus'
import type * as Impl from '@/ui/dialogImpl'

/* The state shared by Dialog (light) and dialogImpl (Radix): see src/ui/Dialog.tsx. */
export interface Guard {
  busy: boolean
  dirty: boolean
  asking: boolean
  ask: () => void
  keep: () => void
  discard: () => void
  report: (id: string, dirty: boolean) => void
}
export const GuardContext = createContext<Guard | null>(null)


let impl: typeof Impl | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

/** Download the Radix half (once). Safe to call from anywhere, any number of times. */
export function preloadDialog(): Promise<void> {
  loading ??= import('@/ui/dialogImpl').then(
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
export const useDialogImpl = () => useSyncExternalStore(subscribe, () => impl, () => impl)
