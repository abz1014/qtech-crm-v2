import { useMemo } from 'react'
import { Import } from 'lucide-react'
import { usePaletteSource } from '@/app/palette/usePalette'
import { filterItems, type PaletteItem, type PaletteSource } from '@/ui/paletteSources'

/** The "Capture" action in the command palette (Cmd or Ctrl K, then Capture), for people who live on the keyboard. */
export function useCapturePaletteSource(openCapture: () => void) {
  const source = useMemo<PaletteSource>(() => {
    const items: PaletteItem[] = [{ id: 'capture', label: 'Capture', meta: 'Action', icon: Import, shortcut: ['C'], onSelect: openCapture }]
    return { id: 'capture', group: 'Actions', order: 10, idle: () => items, search: q => filterItems(items, q) }
  }, [openCapture])
  usePaletteSource(source)
}
