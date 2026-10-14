import { createContext, useContext, useEffect } from 'react'
import type { PaletteSource } from '@/ui/paletteSources'

export interface PaletteApi {
  open: () => void
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
