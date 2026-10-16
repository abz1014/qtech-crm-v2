import { Navigate, Route, Routes } from 'react-router-dom'
import { NoAccessPage } from '@/app/pages/NoAccessPage'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { useSession } from '@/app/session'
import { BankTickPage } from '@/features/money/bank/BankTickPage'
import { ExpensesPage } from '@/features/money/expenses/ExpensesPage'
import { GstRegisterPage } from '@/features/money/invoices/GstRegisterPage'
import { ReceivablesPage } from '@/features/money/payments/ReceivablesPage'
import { ChecklistPage } from '@/features/money/monthEnd/ChecklistPage'
import { AgingPage, CategoriesPage, GstFbrPage, OwePage, PnlPage, TeamPage } from '@/features/money/monthEnd/ReportPages'

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
      <Route path="month-end" element={isAdmin ? <ChecklistPage /> : <NoAccessPage area="Month-end" />} />
      <Route path="month-end/bank" element={isAdmin ? <BankTickPage /> : <NoAccessPage area="Bank tick" />} />
      <Route path="month-end/pnl" element={isAdmin ? <PnlPage /> : <NoAccessPage area="Month-end" />} />
      <Route path="month-end/categories" element={isAdmin ? <CategoriesPage /> : <NoAccessPage area="Month-end" />} />
      <Route path="month-end/aging" element={isAdmin ? <AgingPage /> : <NoAccessPage area="Month-end" />} />
      <Route path="month-end/owe" element={isAdmin ? <OwePage /> : <NoAccessPage area="Month-end" />} />
      <Route path="month-end/gst" element={isAdmin ? <GstFbrPage /> : <NoAccessPage area="Month-end" />} />
      <Route path="month-end/team" element={isAdmin ? <TeamPage /> : <NoAccessPage area="Month-end" />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
