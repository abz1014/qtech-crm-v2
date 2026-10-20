import { useState } from 'react'
import { Printer } from 'lucide-react'
import { useSession } from '@/app/session'
import { Button, type ButtonProps } from '@/ui/Button'
import { InvoicePdfDialog } from '@/features/money/invoices/pdf/InvoicePdfDialog'

/*
 * The one component a screen adopts to print a sales-tax invoice: a button with its own dialog (the OrderMoneyButtons pattern).
 *
 *   <InvoicePdfButton invoiceId={invoice.id} />                   one invoice (the invoice dialog, a register row)
 *   <InvoicePdfButton orderId={order.id} />                       an order's invoices (picks one when there are several)
 *   <InvoicePdfButton invoiceId={r.invoiceId} iconOnly size="sm" /> a compact icon for a table row
 *
 * Invoices are admin and sales only (DATA_MODEL section 10): for anyone else it draws nothing and makes no request. Nothing is
 * read until it is tapped.
 */
type ButtonLook = Pick<ButtonProps, 'size' | 'variant' | 'className'>

type Target = { invoiceId: string; orderId?: never } | { orderId: string; invoiceId?: never }

export function InvoicePdfButton({ iconOnly = false, label = 'Print invoice', ...props }: Target & ButtonLook & { iconOnly?: boolean; label?: string }) {
  const session = useSession()
  const [open, setOpen] = useState(false)
  const role = session.status === 'signed-in' ? session.user.role : null
  if (role !== 'admin' && role !== 'sales') return null
  const { invoiceId, orderId, size, variant, className } = props
  return (
    <>
      {iconOnly ? (
        <Button icon={Printer} aria-label={label} title={label} size={size} variant={variant ?? 'quiet'} className={className} onClick={() => setOpen(true)} />
      ) : (
        <Button icon={Printer} size={size} variant={variant} className={className} onClick={() => setOpen(true)}>
          {label}
        </Button>
      )}
      <InvoicePdfDialog open={open} onOpenChange={setOpen} invoiceId={invoiceId} orderId={orderId} />
    </>
  )
}
