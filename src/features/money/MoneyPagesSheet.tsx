import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Icon } from '@/ui/Icon'
import type { MoneyTab } from '@/features/money/moneyTabs'

/*
 * The admin phone's Money switcher (clarity lane L2): ONE row, "Invoices v ... All Money pages", in place of the five tabs and the
 * "More money pages" links. It opens a bottom sheet with the five tabs, a divider and the other pages; the page you are on is
 * ticked. The sheet is the app's Dialog (a Radix sheet below 768: Escape and the Back button close it, focus is trapped and goes
 * back to this row). Picking a page navigates; the old frame unmounts with the sheet, so the route change moves focus to the new
 * page's h1 as it does for every route (useRouteFocus). Sales keep their three tabs and never see this.
 */
export function MoneyPagesSwitcher({
  current,
  tabs,
  activeKey,
  more,
  toOf,
  isHere,
}: {
  /** The name of the page you are on ("Invoices"). */
  current: string
  tabs: readonly MoneyTab[]
  activeKey: string | null
  more: readonly { label: string; to: string }[]
  toOf: (t: MoneyTab) => string
  /** Whether a page that is not a tab is the one open. */
  isHere: (to: string) => boolean
}) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const moreHere = more.some(p => isHere(p.to))
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        data-testid="money-switcher"
        onClick={() => setOpen(true)}
        className="flex h-12 w-full min-w-0 items-center justify-between gap-3 rounded border border-line bg-surface px-4 text-base"
      >
        <span className="type-row inline-flex min-w-0 items-center gap-2">
          <span className="truncate">{current}</span>
          <Icon icon={ChevronDown} size="sm" />
        </span>
        <span className="type-body shrink-0 text-fg-2">All Money pages</span>
      </button>
      {open ? (
        <Dialog open onOpenChange={o => !o && close()}>
          <DialogContent title="Money pages">
            <nav aria-label="All Money pages" className="-mx-5 grid">
              {tabs.map(t => (
                <SheetLink key={t.key} to={toOf(t)} here={t.key === activeKey && !moreHere} strong onGo={close}>
                  {t.label}
                </SheetLink>
              ))}
              <hr className="my-2 border-line" />
              {more.map(p => (
                <SheetLink key={p.to} to={p.to} here={isHere(p.to)} onGo={close}>
                  {p.label}
                </SheetLink>
              ))}
            </nav>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}

function SheetLink({ to, here, strong, onGo, children }: { to: string; here: boolean; strong?: boolean; onGo: () => void; children: string }) {
  return (
    <Link
      to={to}
      aria-current={here ? 'page' : undefined}
      onClick={onGo}
      className={cn('flex min-h-touch items-center justify-between gap-3 px-5 text-fg', strong ? 'type-row' : 'type-body', here && 'bg-selected')}
    >
      {children}
      {here ? <Icon icon={Check} size="sm" /> : null}
    </Link>
  )
}
