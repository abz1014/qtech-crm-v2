import { Route, Routes } from 'react-router-dom'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { lazyWithReload as lazy } from '@/lib/importWithReload'

// The list and the job page are separate downloads (perf/lcp): the list does not bring the job page's panels.
const JobsListPage = lazy(() => import('@/features/jobs/JobsListPage'))
const JobPage = lazy(() => import('@/features/jobs/JobPage'))

/** Everything under /jobs. Loaded lazily by the app's route table (reachable by address until the navigation switch, P5-F). */
export default function JobsScreen() {
  return (
    <Routes>
      <Route index element={<JobsListPage />} />
      <Route path=":key" element={<JobPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
