import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'

/*
 * A small (i) that opens a short explanation (UX audit 2026-10-19: footnotes and rule explanations become tips, said once).
 * The words are never the only place a fact lives that someone needs to act on: they explain a rule. Works with a tap on a
 * phone (no hover needed) and with the keyboard.
 */
export function Tip({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn('inline-grid size-6 shrink-0 place-items-center rounded-round align-middle text-fg-muted hover:bg-sunken hover:text-fg', className)}
        >
          <Icon icon={Info} size="sm" />
        </button>
      </PopoverTrigger>
      <PopoverContent variant="information" aria-label={label} className="text-pretty">
        {children}
      </PopoverContent>
    </Popover>
  )
}
