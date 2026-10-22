import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { NoAccessPage } from '@/app/pages/NoAccessPage'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { useSession } from '@/app/session'
import { lazyWithReload as lazy } from '@/lib/importWithReload'
import { MONTH_REPORT_KEYS } from '@/features/money/monthEnd/reportList'

// One download per page (perf/lcp): opening Who owes us does not bring the month-end reports, the expense sheet and the rest.
const ReceivablesPage = lazy(() => import('@/features/money/payments/ReceivablesPage').then(m => ({ default: m.ReceivablesPage })))
const GstRegisterPage = lazy(() => import('@/features/money/invoices/GstRegisterPage').then(m => ({ default: m.GstRegisterPage })))
const ExpensesPage = lazy(() => import('@/features/money/expenses/ExpensesPage').then(m => ({ default: m.ExpensesPage })))
const ChecklistPage = lazy(() => import('@/features/money/monthEnd/ChecklistPage').then(m => ({ default: m.ChecklistPage })))
const BankTickPage = lazy(() => import('@/features/money/bank/BankTickPage').then(m => ({ default: m.BankTickPage })))
const ExceptionsPage = lazy(() => import('@/features/money/exceptions/ExceptionsPage').then(m => ({ default: m.ExceptionsPage })))
const MarginsPage = lazy(() => import('@/features/money/margins/MarginsPage').then(m => ({ default: m.MarginsPage })))
const InOutPage = lazy(() => import('@/features/money/inOut/InOutPage').then(m => ({ default: m.InOutPage })))
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage').then(m => ({ default: m.ReportsPage })))
const PnlPage = lazy(() => import('@/features/money/monthEnd/ReportPages').then(m => ({ default: m.PnlPage })))
const CategoriesPage = lazy(() => import('@/features/money/monthEnd/ReportPages').then(m => ({ default: m.CategoriesPage })))
const AgingPage = lazy(() => import('@/features/money/monthEnd/ReportPages').then(m => ({ default: m.AgingPage })))
const OwePage = lazy(() => import('@/features/money/monthEnd/ReportPages').then(m => ({ default: m.OwePage })))
const GstFbrPage = lazy(() => import('@/features/money/monthEnd/ReportPages').then(m => ({ default: m.GstFbrPage })))
const TeamPage = lazy(() => import('@/features/money/monthEnd/ReportPages').then(m => ({ default: m.TeamPage })))
const EnquiriesReportPage = lazy(() => import('@/features/reports/ReportsPage').then(m => ({ default: m.EnquiriesReportPage })))

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
  if (report === 'enquiries') return <EnquiriesReportPage />
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
    case 'in-out':
      return <InOutPage />
    case 'team':
      return <TeamPage />
    default:
      return <NotFoundPage />
  }
}
