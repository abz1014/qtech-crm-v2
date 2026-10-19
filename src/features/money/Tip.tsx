import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { Icon } from '@/ui/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'

/*
 * The (i) next to a word that needs one line of explanation (PSID, TCS, FBR, what closing a month does). A tap opens it, so it
 * works on a phone too; the rule it explains is no longer printed as a footnote under the screen (owner decision 2026-10-19).
 */
export function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`About ${label}`}
          className="inline-grid size-6 shrink-0 place-items-center rounded-round align-middle text-fg-muted transition-colors duration-fast hover:bg-sunken hover:text-fg"
        >
          <Icon icon={Info} size="sm" />
        </button>
      </PopoverTrigger>
      <PopoverContent variant="information" side="bottom" className="text-pretty text-fg-2">
        {children}
      </PopoverContent>
    </Popover>
  )
}
