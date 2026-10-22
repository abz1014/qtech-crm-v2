import * as RadixRadio from '@radix-ui/react-radio-group'
import { cn } from '@/lib/utils'
import { Select } from '@/ui/form/Select'
import { SHOW_OPTIONS, type BoardShow } from '@/features/rfqs/board/model'

/*
 * The board's one filter (UX audit 2026-10-19, recommendation 18): All open, the four next steps, and Closed. No step carries a number
 * (redesign phase 0: the one "needs you" count is Today's; the board's own "N need you" is that number, in the header).
 * Six choices is one more than a segmented control holds (DESIGN_SYSTEM), so on a tablet and up they are a row of chips that wraps
 * instead of scrolling sideways, and on a phone a native select. One value, one place in the address.
 */
export function StepFilter({ value, onChange }: { value: BoardShow; onChange: (v: BoardShow) => void }) {
  return (
    <>
      <div className="w-full md:hidden">
        <Select aria-label="Show RFQs" value={value} onChange={e => onChange(e.target.value as BoardShow)} options={SHOW_OPTIONS.map(o => ({ value: o.value, label: o.label }))} />
      </div>
      <RadixRadio.Root
        value={value}
        onValueChange={v => onChange(v as BoardShow)}
        orientation="horizontal"
        aria-label="Show RFQs"
        className="flex flex-wrap items-center gap-2 max-md:hidden"
      >
        {SHOW_OPTIONS.map(o => (
          <RadixRadio.Item
            key={o.value}
            value={o.value}
            className={cn(
              'inline-flex h-control shrink-0 items-center gap-2 whitespace-nowrap rounded border px-3 text-sm font-medium transition-colors duration-fast ease-out',
              'border-line-strong bg-surface text-fg-2 hover:border-fg-muted hover:text-fg',
              'data-[state=checked]:border-fg data-[state=checked]:bg-selected data-[state=checked]:text-fg',
              o.value === 'closed' && 'md:ml-2',
            )}
          >
            {o.label}
          </RadixRadio.Item>
        ))}
      </RadixRadio.Root>
    </>
  )
}
