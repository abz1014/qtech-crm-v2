import { Route, Routes } from 'react-router-dom'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { lazyWithReload as lazy } from '@/lib/importWithReload'

// The list and the company page are separate downloads (perf/lcp).
const CompaniesPage = lazy(() => import('@/features/companies/CompaniesPage').then(m => ({ default: m.CompaniesPage })))
const CompanyPage = lazy(() => import('@/features/companies/CompanyPage').then(m => ({ default: m.CompanyPage })))

/** Everything under /companies. Loaded lazily by the app's route table. */
export default function CompaniesScreen() {
  return (
    <Routes>
      <Route index element={<CompaniesPage />} />
      <Route path=":id" element={<CompanyPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
