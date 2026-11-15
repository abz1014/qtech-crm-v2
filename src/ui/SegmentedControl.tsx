import { useLayoutEffect, useState, type ReactNode, type RefObject } from 'react'
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
 * Forest .qb-seg: a pill track on --bg-deep; the selected segment is the brand-100 pill with green words and a green edge
 * (the edge is the 3:1 cue, WCAG 1.4.11) and the e1 lift.
 * Each segment is --segment-h tall (36, 26 with smaller text, 44 on touch), --control-h when `large`.
 * Below 640 px (audit 1 blocker 3) two to four segments sit on ONE row of equal columns (a grid, tighter padding; a label
 * that cannot fit breaks onto two lines inside its own segment), so Mine / Open / History never drops one option to a
 * second row. Five options wrap. Never a sideways-scrolling strip on a phone; from 640 px up a track too narrow for its
 * words scrolls inside itself, never overlapping labels.
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
  /** 'danger' for critical items (Mistakes to fix). */
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
  // A caller that lays the segments out in its own grid columns keeps its layout.
  const canRow = options.length <= 4 && !/(^|\s)(max-sm:)?grid-cols-/.test(className ?? '')
  // Phones: up to four options on ONE row: equal columns; if a longest word does not fit its equal share, columns sized by
  // their words; only if even that spills (or there are five options) do the segments wrap. Measured before paint.
  const fit = usePhoneRowFit(trackRef, canRow, options)
  const oneRow = canRow && fit !== 'wrap'
  const track = cn(
    // Wider screens keep one row and scroll inside the track if they must. A caller that passes `flex-wrap` (Today's tabs)
    // wraps at every width and never scrolls.
    'inline-flex max-w-full flex-wrap gap-1 rounded-card bg-deep p-1 sm:rounded-pill',
    oneRow && 'max-sm:inline-grid max-sm:grid-flow-col',
    oneRow && (fit === 'equal' ? 'max-sm:auto-cols-fr' : 'max-sm:auto-cols-[minmax(min-content,1fr)]'),
    !/(^|\s)flex-wrap(\s|$)/.test(className ?? '') && 'sm:flex-nowrap sm:overflow-x-auto',
    fill && (oneRow ? 'flex w-full max-sm:grid' : 'flex w-full'),
    className,
  )
  const segment = (o: SegmentOption) => (
    <>
      {o.icon ? <Icon icon={o.icon} className="text-fg-muted group-data-[state=checked]:text-primary group-data-[state=active]:text-primary" /> : null}
      {o.label}
      <NeedsCount n={o.needs} variant={o.needsVariant} />
    </>
  )
  const segClass = cn(
    'group inline-flex shrink-0 items-center justify-center gap-[6px] whitespace-nowrap rounded-control border border-transparent px-4 text-xs font-card text-fg-2 sm:rounded-pill',
    'transition-colors duration-fast ease-out hover:text-fg disabled:text-fg-disabled disabled:hover:text-fg-disabled',
    // WCAG 1.4.11: the selected segment's green edge is the 3:1 cue against the track; brand-100 fill, green heavy words.
    'data-[state=checked]:border-primary data-[state=checked]:bg-selected data-[state=checked]:font-heavy data-[state=checked]:text-primary data-[state=checked]:shadow-e1',
    'data-[state=active]:border-primary data-[state=active]:bg-selected data-[state=active]:font-heavy data-[state=active]:text-primary data-[state=active]:shadow-e1',
    // locked (a submitting form disables its fieldset): the selected segment keeps its surface but greys out
    'disabled:data-[state=checked]:border-line disabled:data-[state=checked]:bg-surface disabled:data-[state=checked]:text-fg-disabled disabled:data-[state=active]:border-line disabled:data-[state=active]:bg-surface disabled:data-[state=active]:text-fg-disabled',
    // On a phone the height is a floor, so a label that has to break onto two lines grows the segment instead of spilling out.
    large ? 'h-control max-sm:h-auto max-sm:min-h-control' : 'h-segment max-sm:h-auto max-sm:min-h-segment',
    // Shares the width but never shrinks below its words: a track too narrow wraps (phones) or scrolls (wider) instead of overlapping labels.
    fill && 'flex-1 px-2',
    // A label longer than its room breaks onto two lines rather than poking out of the track.
    'max-sm:whitespace-normal max-sm:text-center',
    // Wrapping rows: a segment is never wider than the track. One row: the grid column sizes it.
    !oneRow && 'max-sm:max-w-full',
    // A segment is a role=radio button, which the global touch floor leaves out (it is for the small checkbox and radio boxes):
    // on a touch screen its own width never drops under the touch size either ("All" with tight padding was 47 px).
    '[@media(pointer:coarse)]:min-w-touch',
    // One row on a phone: tighter side padding so three or four options fit 320 px.
    oneRow && 'max-sm:px-2',
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

const PHONE = '(max-width: 639.98px)'

type RowFit = 'equal' | 'words' | 'wrap'
const NEXT: Record<RowFit, RowFit> = { equal: 'words', words: 'wrap', wrap: 'wrap' }

/**
 * How the segments share one phone row: 'equal' columns, else columns sized by their 'words', else 'wrap'. Each step is tried
 * in a layout effect (before paint) and given up when a segment's words, or the track, spill; a new width or new words start
 * again from 'equal', so the person only ever sees the first layout that fits.
 */
function usePhoneRowFit(ref: RefObject<HTMLDivElement | null>, canRow: boolean, options: readonly SegmentOption[]): RowFit {
  const [fit, setFit] = useState<RowFit>('equal')
  const [width, setWidth] = useState(0)
  const words = options.map(o => `${o.label}|${o.needs ?? ''}`).join('/')
  useLayoutEffect(() => setFit('equal'), [width, words])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !canRow || fit === 'wrap' || typeof window.matchMedia !== 'function' || !window.matchMedia(PHONE).matches) return
    // 3 px of slack: a segment's own 1 px edges and sub-pixel rounding are not a spill
    const spills = (e: Element) => e.scrollWidth > e.clientWidth + 3
    // the track wider than the room its parent gives it (a percentage max-width does not hold a grid inside a content-sized box)
    const parent = el.parentElement
    const ps = parent ? getComputedStyle(parent) : null
    const room = parent && ps ? parent.clientWidth - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight) : Infinity
    const wide = el.getBoundingClientRect().width > room + 1
    if (wide || spills(el) || Array.from(el.children).some(c => c.tagName !== 'INPUT' && spills(c))) setFit(NEXT[fit])
  }, [ref, canRow, fit, width, words])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !canRow || typeof ResizeObserver === 'undefined') return
    const parent = el.parentElement ?? el
    const ro = new ResizeObserver(() => setWidth(Math.round(parent.getBoundingClientRect().width)))
    ro.observe(parent)
    return () => ro.disconnect()
  }, [ref, canRow])
  return canRow ? fit : 'wrap'
}
