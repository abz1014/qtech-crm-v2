import { useState } from 'react'
import { Banknote, FilePlus2 } from 'lucide-react'
import { Button, type ButtonProps } from '@/ui/Button'
import { lazyDialog } from '@/lib/lazyDialog'

// Downloaded the first time each opens (perf/lcp, lazyDialog.tsx): the order page and To collect do not wait for the forms.
const CreateInvoiceDialog = lazyDialog(() => import('@/features/money/invoices/CreateInvoiceDialog').then(m => m.CreateInvoiceDialog))
const RecordPaymentDialog = lazyDialog(() => import('@/features/money/payments/RecordPaymentDialog').then(m => m.RecordPaymentDialog))

/*
 * The two money actions on the order page (g2-order-detail, data-slot="order-actions"): each is a button with its own dialog, so the
 * order page needs only one line per action. "Record payment" is admin only (the page decides who sees it); "Create invoice" is for
 * admin and sales.
 */
type ButtonLook = Pick<ButtonProps, 'size' | 'variant' | 'className'>

export function RecordPaymentButton({ orderId, ...look }: { orderId: string } & ButtonLook) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button icon={Banknote} onClick={() => setOpen(true)} {...look}>
        Record payment
      </Button>
      <RecordPaymentDialog open={open} onOpenChange={setOpen} orderId={orderId} />
    </>
  )
}

export function CreateInvoiceButton({ orderId, ...look }: { orderId: string } & ButtonLook) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button icon={FilePlus2} onClick={() => setOpen(true)} {...look}>
        Create invoice
      </Button>
      <CreateInvoiceDialog open={open} onOpenChange={setOpen} orderId={orderId} />
    </>
  )
}
