import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { NoAccessPage } from '@/app/pages/NoAccessPage'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { useSession } from '@/app/session'
import { lazyWithReload as lazy } from '@/lib/importWithReload'
import { MONTH_REPORT_KEYS } from '@/features/money/monthEnd/reportList'
import { defaultMonthEndMonth, isMonthKey } from '@/features/money/monthEnd/model'
import { businessToday } from '@/lib/dates'

// One download per page (perf/lcp): opening Who owes us does not bring the month-end reports, the expense sheet and the rest.
const ReviewImportedPage = lazy(() => import('@/features/money/review/ReviewImportedPage').then(m => ({ default: m.ReviewImportedPage })))
const MoneyHome = lazy(() => import('@/features/money/home/MoneyHome').then(m => ({ default: m.MoneyHome })))
const GstToFbrPage = lazy(() => import('@/features/money/accounts/GstToFbrPage').then(m => ({ default: m.GstToFbrPage })))
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
const AgingPage = lazy(() => import('@/features/money/monthEnd/ReportPages').then(m => ({ default: m.AgingPage })))
const OwePage = lazy(() => import('@/features/money/monthEnd/ReportPages').then(m => ({ default: m.OwePage })))
const GstFbrPage = lazy(() => import('@/features/money/monthEnd/ReportPages').then(m => ({ default: m.GstFbrPage })))
const TeamPage = lazy(() => import('@/features/money/monthEnd/ReportPages').then(m => ({ default: m.TeamPage })))
const ExpenseReportPage = lazy(() => import('@/features/money/expenseReport/ExpenseReportPage').then(m => ({ default: m.ExpenseReportPage })))
const EnquiriesReportPage = lazy(() => import('@/features/reports/ReportsPage').then(m => ({ default: m.EnquiriesReportPage })))

/**
 * Everything under /money (owner decision 2026-10-19: four tabs, two levels).
 *   (index)          Money home, admin only (P6-A: four numbers); sales open on receivables
 *   receivables      Who owes us: admin and sales
 *   gst-register     Invoices & GST: admin and sales (sales get the simpler list)
 *   expenses         admin only
 *   month-end        the checklist, admin only; from it: month-end/bank (Match bank statement), margins, exceptions (Mistakes to fix)
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
      <Route path="review-imported" element={adminOnly(<ReviewImportedPage />, 'Review imported')} />
      <Route index element={isAdmin ? <MoneyHome /> : <Navigate to="receivables" replace />} />
      <Route path="accounts" element={<Navigate to="/money" replace />} />
      <Route path="accounts/gst" element={adminOnly(<GstToFbrPage />, 'GST to FBR')} />
      <Route path="receivables" element={<ReceivablesPage />} />
      <Route path="gst-register" element={<GstRegisterPage />} />
      <Route path="expenses" element={adminOnly(<ExpensesPage />, 'Expenses')} />
      <Route path="month-end" element={adminOnly(<ChecklistPage />, 'Month end')} />
      <Route path="month-end/bank" element={adminOnly(<BankTickPage />, 'Match bank statement')} />
      {MONTH_REPORT_KEYS.map(key => (
        <Route key={key} path={`month-end/${key}`} element={<OldReportAddress report={key} />} />
      ))}
      <Route path="margins" element={adminOnly(<MarginsPage />, 'Margins')} />
      <Route path="exceptions" element={adminOnly(<ExceptionsPage />, 'Mistakes to fix')} />
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

/**
 * /money/reports/categories?month=2026-09 (the old "Expenses by category", replaced by the Expenses report on 2026-10-22) opens
 * /money/reports/expenses?by=month&period=2026-09; with no month, the month Month end shows (the one that just ended).
 */
function OldCategoriesAddress() {
  const { search } = useLocation()
  const asked = new URLSearchParams(search).get('month')
  const month = isMonthKey(asked) ? asked : defaultMonthEndMonth(businessToday())
  return <Navigate to={{ pathname: '/money/reports/expenses', search: `?by=month&period=${month}` }} replace />
}

function ReportRoute({ isAdmin }: { isAdmin: boolean }) {
  const { report } = useParams()
  if (report === 'enquiries') return <EnquiriesReportPage />
  if (!isAdmin) return <NoAccessPage area="Money reports" />
  switch (report) {
    case 'pnl':
      return <PnlPage />
    case 'categories':
      return <OldCategoriesAddress />
    case 'aging':
      return <AgingPage />
    case 'owe':
      return <OwePage />
    case 'gst':
      return <GstFbrPage />
    case 'in-out':
      return <InOutPage />
    case 'expenses':
      return <ExpenseReportPage />
    case 'team':
      return <TeamPage />
    default:
      return <NotFoundPage />
  }
}
