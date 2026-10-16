import { Navigate, Route, Routes } from 'react-router-dom'
import { NoAccessPage } from '@/app/pages/NoAccessPage'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { useSession } from '@/app/session'
import { ExpensesPage } from '@/features/money/expenses/ExpensesPage'
import { ExceptionsPage } from '@/features/money/exceptions/ExceptionsPage'
import { MarginsPage } from '@/features/money/margins/MarginsPage'
import { GstRegisterPage } from '@/features/money/invoices/GstRegisterPage'
import { ReceivablesPage } from '@/features/money/payments/ReceivablesPage'

/**
 * Everything under /money. Admin and sales may enter Money: the GST register (M01) and Receivables / Order balances (M02) are
 * for both; Expenses is admin only, so sales see the no-access page there and engineers never reach Money at all (RequireRole).
 */
export default function MoneyScreen() {
  const session = useSession()
  const isAdmin = session.status === 'signed-in' && session.user.role === 'admin'
  return (
    <Routes>
      <Route index element={<Navigate to="gst-register" replace />} />
      <Route path="gst-register" element={<GstRegisterPage />} />
      <Route path="receivables" element={<ReceivablesPage />} />
      <Route path="expenses" element={isAdmin ? <ExpensesPage /> : <NoAccessPage area="Expenses" />} />
      <Route path="margins" element={isAdmin ? <MarginsPage /> : <NoAccessPage area="Margins" />} />
      <Route path="exceptions" element={isAdmin ? <ExceptionsPage /> : <NoAccessPage area="Exceptions" />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
