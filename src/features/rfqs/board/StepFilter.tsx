import * as RadixRadio from '@radix-ui/react-radio-group'
import { cn } from '@/lib/utils'
import { Select } from '@/ui/form/Select'
import { NeedsCount } from '@/ui/Tag'
import { SHOW_OPTIONS, type BoardShow } from '@/features/rfqs/board/model'

/*
 * The board's one filter (UX audit 2026-10-19, recommendation 18): All open, the four next steps, and Closed. Only the two steps that
 * wait on our side (Needs suppliers, Ready to quote) carry a number, drawn as NeedsCount (consistency spec 2.2 #10); the others are
 * not "needs you" counts, so they carry none.
 * Six choices is one more than a segmented control holds (DESIGN_SYSTEM), so on a tablet and up they are a row of chips that wraps
 * instead of scrolling sideways, and on a phone a native select. One value, one place in the address.
 */
type NeedsStep = 'suppliers' | 'ready'

export function StepFilter({ value, needs, onChange }: { value: BoardShow; needs: Partial<Record<NeedsStep, number>>; onChange: (v: BoardShow) => void }) {
  const needsOf = (v: BoardShow) => (v === 'suppliers' || v === 'ready' ? needs[v] : undefined)
  const label = (o: (typeof SHOW_OPTIONS)[number]) => {
    const n = needsOf(o.value)
    return n ? `${o.label} (${n} need you)` : o.label
  }
  return (
    <>
      <div className="w-full md:hidden">
        <Select aria-label="Show RFQs" value={value} onChange={e => onChange(e.target.value as BoardShow)} options={SHOW_OPTIONS.map(o => ({ value: o.value, label: label(o) }))} />
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
            <NeedsCount n={needsOf(o.value)} />
          </RadixRadio.Item>
        ))}
      </RadixRadio.Root>
    </>
  )
}
