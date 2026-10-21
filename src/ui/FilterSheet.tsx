import { useState, type ReactNode } from 'react'
import { ListFilter, X } from 'lucide-react'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'

/*
 * FilterSheet (consistency spec 3.2): the one "Filters" button of a list toolbar and the filters it hides.
 *   640 px and up  a small popover under the button (280 px wide);
 *   below 640      a sheet (Dialog), so the list starts right under the search.
 * The button reads "Filters", or "Filters · 2 on" (a state, not a to-do: never a NeedsCount). Both forms end in the same footer:
 * Clear (only while something is on) and a primary "Show 12 orders" that closes it. The filters apply as they change.
 *
 *   <FilterSheet title="Filter orders" on={dimsOn} shown={rows.length} noun={['order', 'orders']} onClear={clearFilters}
 *     phoneOnly={ownerSwitch}>
 *     <Select … /> <Select … />
 *   </FilterSheet>
 *
 * `phoneOnly` is drawn above the filters in the phone sheet only: a toolbar control that the desktop keeps visible (Mine or All)
 * moves in here on a phone. Count it in `on` yourself when it is off its default on a phone.
 */
export interface FilterSheetProps {
  /** The sheet's title ("Filter orders"); also names the popover. */
  title: string
  /** How many filters are on (0: the button reads just "Filters"). */
  on: number
  /** How many rows the list shows with these filters, for "Show 12 orders". */
  shown: number
  /** [singular, plural]: ['order', 'orders']. */
  noun: readonly [string, string]
  /** Clears what this sheet holds. The Clear button shows only while `on` > 0. */
  onClear: () => void
  /** The filter controls (Selects, a SegmentedControl…), stacked. */
  children: ReactNode
  /** Phone sheet only, above the filters (a switch the desktop toolbar keeps visible). */
  phoneOnly?: ReactNode
  className?: string
}

const filtersLabel = (on: number): string => (on > 0 ? `Filters · ${on} on` : 'Filters')

export function FilterSheet({ title, on, shown, noun, onClear, children, phoneOnly, className }: FilterSheetProps) {
  const phone = useMediaQuery('(max-width: 639px)')
  const [open, setOpen] = useState(false)
  const label = filtersLabel(on)
  const show = `Show ${shown} ${shown === 1 ? noun[0] : noun[1]}`
  const triggerProps = { icon: ListFilter, variant: on > 0 ? ('secondary' as const) : ('quiet' as const), className }
  const clear = on > 0 ? (
    <Button icon={X} variant={phone ? 'secondary' : 'quiet'} size={phone ? undefined : 'sm'} className="mr-auto" onClick={onClear}>
      Clear
    </Button>
  ) : null

  if (phone) {
    return (
      <>
        <Button {...triggerProps} aria-haspopup="dialog" onClick={() => setOpen(true)}>
          {label}
        </Button>
        {open ? (
          <Dialog open onOpenChange={o => !o && setOpen(false)}>
            <DialogContent
              title={title}
              icon={ListFilter}
              footer={
                <>
                  {clear}
                  <Button variant="primary" data-cancel onClick={() => setOpen(false)}>
                    {show}
                  </Button>
                </>
              }
            >
              <div className="grid gap-4">
                {phoneOnly}
                {children}
              </div>
            </DialogContent>
          </Dialog>
        ) : null}
      </>
    )
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button {...triggerProps}>{label}</Button>
      </PopoverTrigger>
      <PopoverContent align="end" role="dialog" aria-label={title} className="w-[280px]">
        <div className="grid gap-3 p-1">
          {children}
          <div className="flex items-center gap-2 border-t pt-3">
            {clear}
            <Button size="sm" variant="primary" className="ml-auto" onClick={() => setOpen(false)}>
              {show}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
