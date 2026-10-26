import { Copy } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useSession } from '@/app/session'
import { copyToClipboard } from '@/lib/clipboard'
import { businessToday } from '@/lib/dates'
import { Button } from '@/ui/Button'
import { useToast } from '@/ui/useToast'
import type { OrderHeader, OrderMoney } from '@/features/orders/api'
import { qk } from '@/features/queryKeys'
// The two files the reminder needs, not the rfqs/lib barrel (which brings the enquiry parser and every chase text with it).
import { chaseClipboardText, COMPANY_NAME } from '@/features/rfqs/lib/chaseCommon'
import { generatePaymentReminder } from '@/features/rfqs/lib/paymentReminder'

/**
 * Today's usePaymentDraft (same key, same read, same refetch), with Today's reads module fetched when the read starts instead of with
 * the order page's first download (perf/lcp): today/api brings Today's whole rule engine, and this button sits in the order's header.
 */
function usePaymentDraft(orderId: string) {
  return useQuery({
    queryKey: qk.today.payment(orderId),
    queryFn: () => import('@/features/today/api').then(m => m.getPaymentDraft(orderId)),
    refetchOnMount: 'always',
  })
}

/*
 * Sales' one green button on an invoiced order the customer still owes on (UX audit P1): the payment reminder in the approved wording
 * (rfqs/lib/paymentReminder.ts, the same text Today and To collect copy), put on the clipboard for WhatsApp. One tap, nothing typed.
 * It only copies: marking the reminder sent stays on Today and Money ("Copy and mark reminded"). Admin and sales only (the invoices it
 * reads are refused to an engineer, who never sees this button).
 */
export function CopyReminderButton({ order, money, className }: { order: OrderHeader; money: OrderMoney | null | undefined; className?: string }) {
  const { toast } = useToast()
  const session = useSession()
  const draft = usePaymentDraft(order.id)
  const copy = async () => {
    const d = draft.data
    if (!d || !money || !money.dueOn) {
      toast({ title: 'The reminder is not ready yet', body: draft.isError ? 'The invoice did not load. Reload to try again.' : 'Try again in a moment.', tone: 'danger' })
      return
    }
    const count = Math.max(0, ...d.invoices.map(i => i.reminderCount))
    const last = d.invoices.map(i => i.lastRemindedOn).filter((x): x is string => Boolean(x)).sort().pop() ?? null
    const t = generatePaymentReminder({
      invoiceNumber: d.invoiceNumber,
      invoiceDate: d.invoiceDate,
      customerPo: d.customerPo,
      balance: money.balance,
      settled: money.settled,
      dueOn: money.dueOn,
      today: businessToday(),
      reminderCount: count,
      lastRemindedOn: last,
      contactName: d.contact?.name ?? null,
      signature: { name: session.status === 'signed-in' ? session.user.name : COMPANY_NAME, company: COMPANY_NAME },
      variant: 'whatsapp',
      invoiceNumbers: d.invoiceNumbers,
    })
    const ok = await copyToClipboard(chaseClipboardText(t))
    toast(ok ? { title: 'Reminder copied', body: `Paste it into ${d.contact?.name ? `${d.contact.name}'s` : "the customer's"} chat.`, tone: 'success' } : { title: 'Could not copy the reminder', body: 'Nothing was changed.', tone: 'danger' })
  }
  return (
    <Button variant="primary" icon={Copy} className={className} onClick={() => void copy()}>
      Copy reminder
    </Button>
  )
}
