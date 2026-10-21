import { Navigate, useLocation } from 'react-router-dom'
import { useSession } from '@/app/session'
import { reportOptionsFor } from '@/features/money/monthEnd/reportList'
import { ReportsFrame } from '@/features/reports/ReportsFrame'
import { SalesReports } from '@/features/reports/SalesReports'

/*
 * Money > Reports (owner decision 2026-10-19; round 3: one report at a time). /money/reports opens the first report the person
 * may see: Profit and loss for admin, Enquiries and customers for sales; the month in the address is kept. `/reports` and
 * `/money/month-end/<report>` lead here. Every report page sits in <ReportsFrame> (the report select, its period, Export CSV).
 */
export function ReportsPage() {
  const session = useSession()
  const { search } = useLocation()
  const isAdmin = session.status === 'signed-in' && session.user.role === 'admin'
  const first = reportOptionsFor(isAdmin)[0]
  return <Navigate to={{ pathname: `/money/reports/${first.key}`, search }} replace />
}

/** The enquiry and customer reports (counts only, never money): admin and sales. */
export function EnquiriesReportPage() {
  return (
    <ReportsFrame report="enquiries">
      <SalesReports />
    </ReportsFrame>
  )
}
