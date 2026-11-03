import { useId } from 'react'
import * as RadixRadio from '@radix-ui/react-radio-group'
import { cn } from '@/lib/utils'
import { Select } from '@/ui/form/Select'
import { STAGE_LABEL, type StageFilter as Stage } from '@/features/jobs/lib/listModel'

/*
 * The Jobs list's stage filter: All, then the stages this person is offered (listModel stagesFor). Up to six choices is more than a
 * segmented control holds (DESIGN_SYSTEM), so from a tablet up they are a row of chips that wraps instead of scrolling sideways, and on a
 * phone a native select. No option carries a number (DECISIONS 2026-10-26). One value, one place in the address (?stage=).
 */
const ALL = 'all'
const LABEL = 'Show jobs at stage'

export function StageFilter({ value, stages, onChange }: { value: Stage | null; stages: readonly Stage[]; onChange: (v: Stage | null) => void }) {
  const labelId = useId()
  const options = [{ value: ALL, label: 'All' }, ...stages.map(s => ({ value: s as string, label: STAGE_LABEL[s] }))]
  const pick = (v: string) => onChange(v === ALL ? null : (v as Stage))
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2" data-testid="stage-filter">
      <span id={labelId} className="shrink-0 text-sm font-medium text-fg-2">
        {LABEL}
      </span>
      <div className="min-w-0 max-md:w-full md:hidden">
        <Select aria-label={LABEL} value={value ?? ALL} onChange={e => pick(e.target.value)} options={options} />
      </div>
      <RadixRadio.Root value={value ?? ALL} onValueChange={pick} orientation="horizontal" aria-labelledby={labelId} className="flex min-w-0 flex-wrap items-center gap-2 max-md:hidden">
        {options.map(o => (
          <RadixRadio.Item
            key={o.value}
            value={o.value}
            className={cn(
              'inline-flex h-control shrink-0 items-center gap-2 whitespace-nowrap rounded-round border px-4 text-sm font-medium transition-colors duration-fast ease-out',
              'border-line-strong bg-surface text-fg-2 hover:border-fg-muted hover:text-fg',
              'data-[state=checked]:border-chrome data-[state=checked]:bg-chrome data-[state=checked]:text-chrome-fg',
            )}
          >
            {o.label}
          </RadixRadio.Item>
        ))}
      </RadixRadio.Root>
    </div>
  )
}
