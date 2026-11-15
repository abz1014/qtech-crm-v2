import { Banknote, FilePlus2, ReceiptText, ShoppingCart, type LucideIcon } from 'lucide-react'

/*
 * What "+ Create" offers, by role (NewMenu.tsx draws it), in the live words (TONE-REVIEW):
 *   admin     New RFQ (N) · Expense (E) · Payment received · Order without RFQ (O)
 *   sales     New RFQ (N) · Order without RFQ (O)           payments are admin only (0010): no "Payment received"
 *   engineer  none
 * Payment received opens To collect with ?pay=1: "Which order?" first, then Record payment for that order (ReceivablesPage).
 */
export interface NewEntry {
  id: 'enquiry' | 'expense' | 'payment' | 'order'
  label: string
  icon: LucideIcon
  to: string
  key?: string
}

/** What the person may start. Pure, so a test can pin each role's list. */
export function newEntries(role: string): NewEntry[] {
  const enquiry: NewEntry = { id: 'enquiry', label: 'New RFQ', icon: FilePlus2, to: '/enquiries/new', key: 'N' }
  const order: NewEntry = { id: 'order', label: 'Order without RFQ', icon: ShoppingCart, to: '/orders?new=1', key: 'O' }
  if (role === 'admin') {
    return [
      enquiry,
      { id: 'expense', label: 'Expense', icon: ReceiptText, to: '/money/expenses', key: 'E' },
      { id: 'payment', label: 'Payment received', icon: Banknote, to: '/money/receivables?pay=1' },
      order,
    ]
  }
  if (role === 'sales') return [enquiry, order]
  return []
}

