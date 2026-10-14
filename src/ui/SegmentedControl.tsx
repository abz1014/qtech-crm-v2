import type { ReactNode } from 'react'
import * as RadixRadio from '@radix-ui/react-radio-group'
import * as RadixTabs from '@radix-ui/react-tabs'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'

/*
 * SegmentedControl (INVENTORY: U03; D08 section 11). 2 to 5 options that switch
 * between a few views of the same thing, or set one value. Never navigation
 * between pages, never more than five options (use a Select).
 *   mode="radio" (default)  role=radiogroup: sets a value; arrows move and select.
 *   mode="tabs"             role=tablist: switches a panel (render <TabPanel> children);
 *                           arrows move focus, Space or Enter selects.
 * Track bg-selected, selected segment is a surface with a border-strong edge.
 * 26px tall, 32 when `large`. A phone scrolls it inside its own container.
 */
export interface SegmentOption {
  value: string
  label: string
  icon?: LucideIcon
  /** Mono count after the label ("All 9"). */
  count?: number
  disabled?: boolean
}

interface SegmentedControlProps {
  options: readonly SegmentOption[]
  value: string
  onValueChange: (value: string) => void
  /** Names the group for assistive tech ("Message channel"). Required. */
  'aria-label': string
  mode?: 'radio' | 'tabs'
  large?: boolean
  /** Segments share the full width (forms, toolbars). */
  fill?: boolean
  /** tabs mode: the panels this control switches. */
  children?: ReactNode
  className?: string
}

export function SegmentedControl({
  options,
  value,
  onValueChange,
  mode = 'radio',
  large = false,
  fill = false,
  children,
  className,
  ...aria
}: SegmentedControlProps) {
  const track = cn(
    'inline-flex max-w-full gap-[2px] overflow-x-auto rounded bg-selected p-[2px]',
    fill && 'flex w-full',
    className,
  )
  const segment = (o: SegmentOption) => (
    <>
      {o.icon ? <Icon icon={o.icon} className="text-fg-muted group-data-[state=checked]:text-fg-2 group-data-[state=active]:text-fg-2" /> : null}
      {o.label}
      {o.count !== undefined ? <span className="num font-regular">{o.count}</span> : null}
    </>
  )
  const segClass = cn(
    'group inline-flex shrink-0 items-center justify-center gap-[6px] whitespace-nowrap rounded border border-transparent px-3 text-xs font-medium text-fg-muted',
    'transition-colors duration-fast ease-out hover:text-fg disabled:text-fg-disabled disabled:hover:text-fg-disabled',
    'data-[state=checked]:border-line-strong data-[state=checked]:bg-surface data-[state=checked]:text-fg',
    'data-[state=active]:border-line-strong data-[state=active]:bg-surface data-[state=active]:text-fg',
    // locked (a submitting form disables its fieldset): the selected segment keeps its surface but greys out
    'disabled:data-[state=checked]:text-fg-disabled disabled:data-[state=active]:text-fg-disabled',
    large ? 'h-8' : 'h-[26px]',
    fill && 'min-w-0 flex-1 px-2',
  )

  if (mode === 'tabs') {
    return (
      <RadixTabs.Root value={value} onValueChange={onValueChange} activationMode="manual">
        <RadixTabs.List {...aria} className={track}>
          {options.map(o => (
            <RadixTabs.Trigger key={o.value} value={o.value} disabled={o.disabled} className={segClass}>
              {segment(o)}
            </RadixTabs.Trigger>
          ))}
        </RadixTabs.List>
        {children}
      </RadixTabs.Root>
    )
  }
  return (
    <RadixRadio.Root value={value} onValueChange={onValueChange} orientation="horizontal" {...aria} className={track}>
      {options.map(o => (
        <RadixRadio.Item key={o.value} value={o.value} disabled={o.disabled} className={segClass}>
          {segment(o)}
        </RadixRadio.Item>
      ))}
    </RadixRadio.Root>
  )
}
