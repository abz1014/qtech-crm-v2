import { Plus } from 'lucide-react'
import { limeButtonClass, railTextClass } from '@/app/shell/railStyle'
import { useStartEntry } from '@/app/shell/useStartEntry'
import { newEntries } from '@/app/shell/newEntries'
import { Icon } from '@/ui/Icon'
import { Kbd } from '@/ui/Kbd'
import { MenuItem, Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'

/*
 * The rail's Create menu (see NewMenu.tsx): the lime button opens a menu under it, in the live order and words, with the key letters
 * N, E and O beside their rows for a mouse (they work only outside a text field and outside a dialog: PaletteHost, shortcuts.ts).
 */
export function NewMenuImpl({ role, collapsed = false, defaultOpen = false }: { role: string; collapsed?: boolean; defaultOpen?: boolean }) {
  const start = useStartEntry()
  const entries = newEntries(role)
  if (entries.length === 0) return null
  return (
    <Popover defaultOpen={defaultOpen}>
      <PopoverTrigger asChild>
        <button type="button" title="Create" className={limeButtonClass(collapsed)}>
          <Icon icon={Plus} size="lg" />
          <span className={railTextClass(collapsed)}>Create</span>
        </button>
      </PopoverTrigger>
      <PopoverContent variant="menu" align="start" aria-label="Create">
        {entries.map(e => (
          <MenuItem key={e.id} icon={e.icon} onClick={() => start(e)} hint={e.key ? <Kbd aria-hidden className="max-md:hidden">{e.key}</Kbd> : undefined}>
            {e.label}
          </MenuItem>
        ))}
      </PopoverContent>
    </Popover>
  )
}
