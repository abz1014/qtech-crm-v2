import { Navigate, Route, Routes } from 'react-router-dom'
import { DestinationPage } from '@/app/pages/DestinationPage'
import { NoAccessPage } from '@/app/pages/NoAccessPage'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { useSession } from '@/app/session'
import { BankTickPage } from '@/features/money/bank/BankTickPage'
import { ExpensesPage } from '@/features/money/expenses/ExpensesPage'

/**
 * Everything under /money. Admin and sales may enter Money (invoices, the GST register and balances arrive with M01/M02);
 * Expenses is admin only, so sales see the no-access page there and engineers never reach Money at all (RequireRole).
 */
export default function MoneyScreen() {
  const session = useSession()
  const isAdmin = session.status === 'signed-in' && session.user.role === 'admin'
  return (
    <Routes>
      <Route index element={isAdmin ? <Navigate to="expenses" replace /> : <DestinationPage navKey="money" />} />
      <Route path="expenses" element={isAdmin ? <ExpensesPage /> : <NoAccessPage area="Expenses" />} />
      <Route path="month-end" element={isAdmin ? <Navigate to="bank" replace /> : <NoAccessPage area="Month-end" />} />
      <Route path="month-end/bank" element={isAdmin ? <BankTickPage /> : <NoAccessPage area="Bank tick" />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
