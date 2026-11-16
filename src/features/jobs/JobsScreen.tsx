import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { lazyWithReload as lazy } from '@/lib/importWithReload'

// The list and the job page are separate downloads (perf/lcp): the list does not bring the job page's panels.
const JobsListPage = lazy(() => import('@/features/jobs/JobsListPage'))
const JobPage = lazy(() => import('@/features/jobs/JobPage'))

/**
 * The old Comparative Statement page (/jobs/<key>/statement). The statement is now only downloaded, as Excel or PDF, from the job page
 * (owner, 2026-11-16), so an old link or bookmark lands on the job page, where the two download buttons are.
 */
function StatementRedirect() {
  const { key } = useParams()
  return <Navigate to={key ? `/jobs/${encodeURIComponent(key)}` : '/jobs'} replace />
}

/** Everything under /jobs. Loaded lazily by the app's route table (reachable by address until the navigation switch, P5-F). */
export default function JobsScreen() {
  return (
    <Routes>
      <Route index element={<JobsListPage />} />
      <Route path=":key" element={<JobPage />} />
      <Route path=":key/statement" element={<StatementRedirect />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
