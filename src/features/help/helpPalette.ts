import { CircleHelp } from 'lucide-react'
import type { PaletteItem, PaletteSource } from '@/ui/paletteSources'
import { recipesForPath, recipesForRole, searchRecipes, type Recipe } from '@/features/help/recipes'

/*
 * The palette's "How do I…" group (learnability spec 2.2). With nothing typed it offers the recipes for the current screen
 * (at most 3). Typed words search titles, keywords and steps (at most 5 rows). "help" or "how" on its own lists every
 * recipe for the person's role, with "Open Help" first. It sits after the palette's own groups (order 95), so search
 * results and the quick actions keep their place.
 */
export const HELP_GROUP = 'How do I…'
const IDLE = 3
const MAX = 5

export function helpPaletteSource(recipes: readonly Recipe[], role: string, pathname: string, openHelp: (id?: string | null) => void): PaletteSource {
  const mine = recipesForRole(recipes, role)
  const item = (r: Recipe): PaletteItem => ({ id: `help-${r.id}`, label: r.title, meta: 'Help', icon: CircleHelp, onSelect: () => openHelp(r.id) })
  const openAll: PaletteItem = { id: 'help-open', label: 'Open Help', meta: 'Every how-to answer', icon: CircleHelp, onSelect: () => openHelp(null) }
  return {
    id: 'help',
    group: HELP_GROUP,
    order: 95,
    idle: () => recipesForPath(recipes, pathname, role).slice(0, IDLE).map(item),
    search: q => {
      const words = q.toLowerCase().split(/\s+/).filter(Boolean)
      const asks = words.some(w => w === 'help' || w === 'how' || w === 'how?')
      const found = searchRecipes(mine, q)
      if (asks && found.length === mine.length) return [openAll, ...found.map(item)]
      return [...(asks ? [openAll] : []), ...found.slice(0, MAX).map(item)]
    },
  }
}
