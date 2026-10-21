import type { ReactNode } from 'react'
import * as RadixRadio from '@radix-ui/react-radio-group'
import * as RadixTabs from '@radix-ui/react-tabs'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useScrollActiveIntoView } from '@/lib/useScrollActiveIntoView'
import { Icon } from '@/ui/Icon'
import { NeedsCount } from '@/ui/Tag'

/*
 * SegmentedControl (INVENTORY: U03; D08 section 11). 2 to 5 options that switch
 * between a few views of the same thing, or set one value. Never navigation
 * between pages, never more than five options (use a Select).
 *   mode="radio" (default)  role=radiogroup: sets a value; arrows move and select.
 *   mode="tabs"             role=tablist: switches a panel (render <TabPanel> children);
 *                           arrows move focus, Space or Enter selects.
 * Track bg-selected, selected segment is a surface with a border-strong edge.
 * Each segment is --segment-h tall (36, 26 with smaller text, 44 on touch), --control-h when `large`.
 * Below 640 px the segments WRAP onto a second row instead of scrolling sideways (rubric: no sideways-scrolling filter
 * strips on a phone); from 640 px up a track too narrow for its words scrolls inside itself, never overlapping labels.
 */
export interface SegmentOption {
  value: string
  label: string
  icon?: LucideIcon
  /**
   * How many items under this option need you (NeedsCount: warning pill, ", N need you" for screen readers, nothing for 0).
   * Only a needs-you count: a total ("All 9") is never drawn here; write it in words (consistency spec 2.1).
   */
  needs?: number
  /** 'danger' for critical items (Things to check). */
  needsVariant?: 'warning' | 'danger'
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
  const trackRef = useScrollActiveIntoView<HTMLDivElement>()
  const track = cn(
    // Phones wrap (flex-wrap, no horizontal overflow); wider screens keep one row and scroll inside the track if they must.
    'inline-flex max-w-full flex-wrap gap-[2px] rounded bg-selected p-[2px] sm:flex-nowrap sm:overflow-x-auto',
    fill && 'flex w-full',
    className,
  )
  const segment = (o: SegmentOption) => (
    <>
      {o.icon ? <Icon icon={o.icon} className="text-fg-muted group-data-[state=checked]:text-fg-2 group-data-[state=active]:text-fg-2" /> : null}
      {o.label}
      <NeedsCount n={o.needs} variant={o.needsVariant} />
    </>
  )
  const segClass = cn(
    'group inline-flex shrink-0 items-center justify-center gap-[6px] whitespace-nowrap rounded border border-transparent px-3 text-xs font-medium text-fg-muted',
    'transition-colors duration-fast ease-out hover:text-fg disabled:text-fg-disabled disabled:hover:text-fg-disabled',
    // WCAG 1.4.11: the selected segment has an ink edge (3:1+ against the track), not only a white fill.
    'data-[state=checked]:border-fg data-[state=checked]:bg-surface data-[state=checked]:text-fg',
    'data-[state=active]:border-fg data-[state=active]:bg-surface data-[state=active]:text-fg',
    // locked (a submitting form disables its fieldset): the selected segment keeps its surface but greys out
    'disabled:data-[state=checked]:text-fg-disabled disabled:data-[state=active]:text-fg-disabled',
    // On a phone the height is a floor, so a label that has to break onto two lines grows the segment instead of spilling out.
    large ? 'h-control max-sm:h-auto max-sm:min-h-control' : 'h-segment max-sm:h-auto max-sm:min-h-segment',
    // Shares the width but never shrinks below its words: a track too narrow wraps (phones) or scrolls (wider) instead of overlapping labels.
    fill && 'flex-1 px-2',
    // A segment longer than the phone itself (one very long label) breaks onto two lines rather than poking out of the track.
    'max-sm:max-w-full max-sm:whitespace-normal max-sm:text-center',
  )

  if (mode === 'tabs') {
    return (
      <RadixTabs.Root value={value} onValueChange={onValueChange} activationMode="manual">
        <RadixTabs.List ref={trackRef} {...aria} className={track}>
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
    <RadixRadio.Root ref={trackRef} value={value} onValueChange={onValueChange} orientation="horizontal" {...aria} className={track}>
      {options.map(o => (
        <RadixRadio.Item key={o.value} value={o.value} disabled={o.disabled} className={segClass}>
          {segment(o)}
        </RadixRadio.Item>
      ))}
    </RadixRadio.Root>
  )
}
