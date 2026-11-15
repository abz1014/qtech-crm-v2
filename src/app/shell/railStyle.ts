import { cn } from '@/lib/utils'

/* The forest rail's shared looks (Rail.tsx, the Create button in NewMenu.tsx). */

/** The lime button at the top of the rail (Create, or the engineer's Take photo). Lime only ever sits on the forest. */
export const limeButtonClass = (collapsed: boolean) =>
  cn(
    'flex h-control-lg w-full items-center gap-3 rounded-pill bg-lime-300 font-heavy text-lime-on shadow-e1 transition-colors duration-fast ease-out hover:bg-lime-hover active:bg-lime-press',
    collapsed ? 'justify-center px-0' : 'px-4 max-lg:justify-center max-lg:px-0',
  )

/** A rail word: shown from 1024 up while the rail is 240 wide; read out at every width. */
export const railTextClass = (collapsed: boolean) => (collapsed ? 'sr-only' : 'truncate max-lg:sr-only')
