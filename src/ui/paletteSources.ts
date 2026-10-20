import type { LucideIcon } from 'lucide-react'

// Types and helpers for command-palette sources (see CommandPalette.tsx).
export interface PaletteItem {
  id: string
  label: string
  /** Heading to group this row under, when a source returns several kinds at once (a search across companies, contacts and RFQs). Default: the source's own group. */
  group?: string
  /** Muted text on the right: "RFQ · quotation due Tue 1 Dec". */
  meta?: string
  /** Other words that find this row but are not shown (an old name, a synonym): ["capture"]. */
  keywords?: readonly string[]
  icon?: LucideIcon
  /** Keys shown as hints: ["G", "T"]. Display only. */
  shortcut?: string[]
  /** A route. The palette opens it through `onNavigate`, and remembers it under Recent. */
  href?: string
  /** Runs instead of navigating, for actions with no route. */
  onSelect?: (opts: { newTab: boolean }) => void
}

export interface PaletteSource {
  id: string
  /** Group heading ("Jump to", "Actions"). */
  group: string
  /** Lower first. Default 0; ties keep the order the sources were given. */
  order?: number
  idle?: () => PaletteItem[]
  search?: (query: string, signal: AbortSignal) => PaletteItem[] | Promise<PaletteItem[]>
}

/** Case-insensitive match helper for sources: keeps items whose label, meta or keywords contain every typed word. */
export function filterItems<T extends { label: string; meta?: string; keywords?: readonly string[] }>(items: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return items.slice()
  return items.filter(i => {
    const hay = `${i.label} ${i.meta ?? ''} ${(i.keywords ?? []).join(' ')}`.toLowerCase()
    return words.every(w => hay.includes(w))
  })
}

/** The platform's command key as shown in hints: the command sign on Apple devices, "Ctrl" elsewhere. */
export function modKeyLabel(): string {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform) ? '⌘' : 'Ctrl'
}

/** Search-field hint: "⌘K" on Apple devices, "Ctrl K" elsewhere. */
export function searchKeyHint(): string {
  const m = modKeyLabel()
  return m === '⌘' ? '⌘K' : `${m} K`
}
