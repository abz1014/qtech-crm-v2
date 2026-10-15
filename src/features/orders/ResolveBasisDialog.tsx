import { useState } from 'react'
import { Scale } from 'lucide-react'
import { formatAmount } from '@/lib/money'
import { mapPgError } from '@/lib/pgErrors'
import { orderRef } from '@/lib/refs'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Radio, RadioGroup } from '@/ui/form/Radio'
import { useToast } from '@/ui/useToast'
import type { OrderHeader, OrderItemRow, OrderMoney } from '@/features/orders/api'
import { useResolveBasis } from '@/features/orders/hooks'
import { basisChoices } from '@/features/orders/lib/basis'

/*
 * "Resolve price basis" (admin; g2-order-detail.html "Admin: legacy order, basis unknown"). The old CRM did not record whether an imported
 * order's prices include GST. Until the admin chooses, the order is left out of margin, GST totals and the net cash that counts toward
 * targets. This dialog shows exactly what each choice would do before anything is rewritten, then calls resolve_value_basis, which
 * rewrites the item prices and clears the flag (audit-logged; a second call is refused, so a retry cannot divide twice).
 */
export function ResolveBasisDialog({ order, items, money, onClose }: { order: OrderHeader; items: readonly OrderItemRow[]; money: OrderMoney | null | undefined; onClose: () => void }) {
  const { toast } = useToast()
  const resolve = useResolveBasis(order.id)
  const [basis, setBasis] = useState<'net' | 'gross' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lines = items.filter(i => i.unitPriceNet !== null).map(i => ({ qty: i.qty, unitPriceNet: i.unitPriceNet as number, gstRate: i.gstRate ?? 18 }))
  const choices = basisChoices(lines, money?.actualCost ?? null)

  const apply = async () => {
    if (!basis) return
    setError(null)
    try {
      await resolve.mutateAsync(basis)
      toast({ title: 'Price basis applied', body: `${orderRef(order.number)} · prices ${basis === 'gross' ? 'include GST' : 'are before GST'}` })
      onClose()
    } catch (err) {
      setError(mapPgError(err, { entity: 'order' }).message)
    }
  }

  const option = (key: 'gross' | 'net', title: string) => {
    const c = choices[key]
    return (
      <Radio
        value={key}
        label={
          <span className="grid gap-px">
            <span className="font-medium">{title}</span>
            <span className="num text-xs text-fg-2">
              Net {formatAmount(c.net)} + GST {formatAmount(c.gst)} = {formatAmount(c.gross)} gross.
              {c.margin !== null ? ` Margin would be ${formatAmount(c.margin)}.` : ''}
            </span>
          </span>
        }
      />
    )
  }

  return (
    <Dialog open busy={resolve.isPending} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent
        title="Resolve price basis"
        context={`${orderRef(order.number)} · ${order.companyName}`}
        icon={Scale}
        tone="warning"
        footer={
          <>
            <Button data-cancel onClick={onClose} disabled={resolve.isPending}>
              Cancel
            </Button>
            <Button variant="primary" busy={resolve.isPending} busyLabel="Applying" disabled={!basis} onClick={() => void apply()}>
              Apply basis
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <p className="text-sm text-fg-2">
            The old CRM did not record whether these prices include GST. Choose what they are. Nothing changes until you press Apply basis.
          </p>
          <RadioGroup aria-label="Price basis" value={basis ?? ''} onValueChange={v => setBasis(v as 'net' | 'gross')} className="gap-3">
            {option('gross', 'The prices include GST')}
            {option('net', 'The prices are before GST')}
          </RadioGroup>
          <p className="text-xs text-fg-muted">Rewrites the item prices and clears the flag. Recorded in the audit log.</p>
          {error ? (
            <Banner tone="danger" title="Couldn't apply the basis">
              {error}
            </Banner>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
