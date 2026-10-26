import { Banknote, FilePlus2, ReceiptText, ShoppingCart, type LucideIcon } from 'lucide-react'

/*
 * What "+ New" offers, by role (NewMenu.tsx draws it):
 *   admin     New enquiry (N) · Expense (E) · Payment received · Order without enquiry (O)
 *   sales     New enquiry (N) · Order without enquiry (O)           payments are admin only (0010): no "Payment received"
 *   engineer  none
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
  const enquiry: NewEntry = { id: 'enquiry', label: 'New enquiry', icon: FilePlus2, to: '/rfqs/new', key: 'N' }
  const order: NewEntry = { id: 'order', label: 'Order without enquiry', icon: ShoppingCart, to: '/orders?new=1', key: 'O' }
  if (role === 'admin') {
    return [
      enquiry,
      { id: 'expense', label: 'Expense', icon: ReceiptText, to: '/money/expenses', key: 'E' },
      { id: 'payment', label: 'Payment received', icon: Banknote, to: '/money/receivables' },
      order,
    ]
  }
  if (role === 'sales') return [enquiry, order]
  return []
}

