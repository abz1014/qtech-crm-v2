import { Link } from 'react-router-dom'
import { Wallet } from 'lucide-react'
import { formatDay } from '@/lib/formatDay'
import { orderRef } from '@/lib/refs'
import { Icon } from '@/ui/Icon'
import { InfoTip } from '@/ui/InfoTip'
import { Money } from '@/ui/Money'
import { useHeldAdvances } from '@/features/money/payments/hooks'
import type { HeldAdvance } from '@/features/money/payments/api'

/*
 * "Advance held — refund or keep" (owner decision 2026-10-22, migration 0080 held_advances). Money a customer paid on an order
 * that was then cancelled before any invoice. It is never owed and never overdue, so it is not in the table above, its totals or
 * Today's reminders; it is listed here apart, for the admin only, so the money is not forgotten: refund it (void the payment with
 * the reason, from the order) or keep it. Renders nothing when there is none, or for anyone but the admin.
 */
export function HeldAdvancesPanel({ isAdmin }: { isAdmin: boolean }) {
  const q = useHeldAdvances(isAdmin)
  const rows = q.data ?? []
  if (!isAdmin || rows.length === 0) return null
  return <HeldAdvancesList rows={rows} />
}

export function HeldAdvancesList({ rows }: { rows: readonly HeldAdvance[] }) {
  const total = rows.reduce((s, r) => s + r.held, 0)
  return (
    <section aria-label="Advance held — refund or keep" className="mt-6 rounded border border-dashed border-line-input bg-canvas">
      <header className="flex flex-wrap items-center gap-3 border-b border-dashed border-line-input px-5 py-3">
        <h2 className="text-base font-semibold">Advance held — refund or keep</h2>
        <InfoTip label="About advances held">
          Paid on an order that was cancelled before it was invoiced. Nobody owes this, so it is not counted above and never reminded.
          Refund it (void the payment on the order with the reason) or keep it.
        </InfoTip>
        <span className="flex-1" />
        <Money value={total} strong />
      </header>
      <ul>
        {rows.map(r => (
          <li key={r.orderId} className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 border-t border-dashed border-line-input px-5 py-3 text-sm first:border-t-0">
            <Icon icon={Wallet} size="md" className="text-fg-muted" />
            <span className="grid min-w-0">
              <span className="truncate font-medium">{r.companyName}</span>
              <span className="text-sm text-fg-muted">
                <Link to={`/orders/${r.orderId}`} className="num underline decoration-1 underline-offset-2 hover:text-fg">
                  {orderRef(r.orderNumber)}
                </Link>
                {r.cancelledOn ? ` · cancelled ${formatDay(r.cancelledOn)}` : ' · cancelled'}
              </span>
            </span>
            <Money value={r.held} />
          </li>
        ))}
      </ul>
    </section>
  )
}
