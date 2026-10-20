import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { NoAccessPage } from '@/app/pages/NoAccessPage'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { useSession } from '@/app/session'
import { BankTickPage } from '@/features/money/bank/BankTickPage'
import { ExpensesPage } from '@/features/money/expenses/ExpensesPage'
import { GstRegisterPage } from '@/features/money/invoices/GstRegisterPage'
import { ReceivablesPage } from '@/features/money/payments/ReceivablesPage'
import { ChecklistPage } from '@/features/money/monthEnd/ChecklistPage'
import { AgingPage, CategoriesPage, GstFbrPage, OwePage, PnlPage, TeamPage } from '@/features/money/monthEnd/ReportPages'
import { MONTH_REPORT_KEYS } from '@/features/money/monthEnd/reportList'
import { ExceptionsPage } from '@/features/money/exceptions/ExceptionsPage'
import { MarginsPage } from '@/features/money/margins/MarginsPage'
import { ReportsPage } from '@/features/reports/ReportsPage'

/**
 * Everything under /money (owner decision 2026-10-19: four tabs, two levels).
 *   receivables      Who owes us: admin and sales; where Money opens for everyone
 *   gst-register     Invoices & GST: admin and sales (sales get the simpler list)
 *   expenses         admin only
 *   month-end        the checklist, admin only; from it: month-end/bank (Match bank statement), margins, exceptions (Things to check)
 *   reports          the one Reports view: admin and sales (each sees the reports their role may read); reports/<key> opens one
 * The old addresses keep working: /money/month-end/{pnl,categories,aging,owe,gst,team} open the same report under Reports, with
 * the month kept. Sales see the no-access page on admin views; engineers never reach Money at all (RequireRole).
 */
export default function MoneyScreen() {
  const session = useSession()
  const isAdmin = session.status === 'signed-in' && session.user.role === 'admin'
  const adminOnly = (el: JSX.Element, area: string) => (isAdmin ? el : <NoAccessPage area={area} />)
  return (
    <Routes>
      <Route index element={<Navigate to="receivables" replace />} />
      <Route path="receivables" element={<ReceivablesPage />} />
      <Route path="gst-register" element={<GstRegisterPage />} />
      <Route path="expenses" element={adminOnly(<ExpensesPage />, 'Expenses')} />
      <Route path="month-end" element={adminOnly(<ChecklistPage />, 'Month end')} />
      <Route path="month-end/bank" element={adminOnly(<BankTickPage />, 'Match bank statement')} />
      {MONTH_REPORT_KEYS.map(key => (
        <Route key={key} path={`month-end/${key}`} element={<OldReportAddress report={key} />} />
      ))}
      <Route path="margins" element={adminOnly(<MarginsPage />, 'Margins')} />
      <Route path="exceptions" element={adminOnly(<ExceptionsPage />, 'Things to check')} />
      <Route path="reports" element={<ReportsPage />} />
      <Route path="reports/:report" element={<ReportRoute isAdmin={isAdmin} />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

/** /money/month-end/pnl?month=2026-09 (the old third strip) opens /money/reports/pnl?month=2026-09. */
function OldReportAddress({ report }: { report: string }) {
  const { search } = useLocation()
  return <Navigate to={{ pathname: `/money/reports/${report}`, search }} replace />
}

function ReportRoute({ isAdmin }: { isAdmin: boolean }) {
  const { report } = useParams()
  if (!isAdmin) return <NoAccessPage area="Money reports" />
  switch (report) {
    case 'pnl':
      return <PnlPage />
    case 'categories':
      return <CategoriesPage />
    case 'aging':
      return <AgingPage />
    case 'owe':
      return <OwePage />
    case 'gst':
      return <GstFbrPage />
    case 'team':
      return <TeamPage />
    default:
      return <NotFoundPage />
  }
}
