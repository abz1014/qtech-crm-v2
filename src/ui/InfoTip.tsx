import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'

/*
 * InfoTip (UX audit 2026-10-19, step 2: "footnotes become (i) tips"). A small (i) button beside a heading, a label or a
 * figure that opens one short explanation ("TCS is the tax the customer pays us at sale..."). It replaces the explanatory
 * footnote or grey sub-line printed under a panel. Never put the only copy of something the person must act on in here.
 *
 * Built on the information Popover, not Tooltip: it opens on click and on tap (phones have no hover; a Radix tooltip
 * ignores touch), on Enter or Space from the keyboard, and closes on Esc, an outside click or a second press, with focus
 * back on the button. The click does not bubble, so it can sit inside a clickable row or card.
 * Target: 24px on a mouse; on a touch screen (pointer: coarse) the button is 44px (--hit-touch) around the same glyph, with a
 * negative margin so the line it sits on does not grow.
 *
 *   <h2>TCS <InfoTip label="About TCS">Tax collected at source: ...</InfoTip></h2>
 */
export interface InfoTipProps {
  /** Names the button and the pop-up for screen readers: "About TCS", "Why is this estimated?". */
  label: string
  /** The explanation: one or two plain sentences, or short JSX. No form controls. */
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  /** On the button (spacing beside the text it explains). */
  className?: string
}

export function InfoTip({ label, children, side = 'bottom', align = 'start', className }: InfoTipProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          data-infotip=""
          onClick={e => e.stopPropagation()}
          className={cn(
            'relative inline-grid size-6 shrink-0 place-items-center rounded align-middle text-fg-muted',
            'transition-colors duration-fast ease-out hover:bg-sunken hover:text-fg data-[state=open]:bg-sunken data-[state=open]:text-fg',
            // touch: the button itself is 44px; the negative margin keeps the 24px footprint beside the text it explains
            '[@media(pointer:coarse)]:size-touch [@media(pointer:coarse)]:-m-[10px]',
            className,
          )}
        >
          <Icon icon={Info} />
        </button>
      </PopoverTrigger>
      <PopoverContent role="dialog" aria-label={label} side={side} align={align} className="max-w-[32ch] p-3 text-sm text-fg text-pretty">
        {children}
      </PopoverContent>
    </Popover>
  )
}
