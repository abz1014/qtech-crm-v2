import { createContext, useContext, useEffect } from 'react'
import type { PaletteSource } from '@/ui/paletteSources'

export interface PaletteApi {
  /** Opens the palette. With `query`, the search box starts with that text (a "No results" state hands its words over). */
  open: (query?: string) => void
  /**
   * Opens the Keyboard shortcuts sheet (the `?` key, the account menu, the palette's idle action). PaletteHost always
   * provides it; optional only so test doubles of this API need not.
   */
  openShortcuts?: () => void
  register: (source: PaletteSource) => () => void
}
export const PaletteContext = createContext<PaletteApi | null>(null)

export function usePalette(): PaletteApi {
  const api = useContext(PaletteContext)
  if (!api) throw new Error('usePalette needs a PaletteHost (it is part of AppShell)')
  return api
}

/** Register a source for as long as the calling component is mounted. Pass a stable (memoised) object. */
export function usePaletteSource(source: PaletteSource | null) {
  const { register } = usePalette()
  useEffect(() => (source ? register(source) : undefined), [register, source])
}
