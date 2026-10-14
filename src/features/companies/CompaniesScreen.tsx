import { Route, Routes } from 'react-router-dom'
import { CompaniesPage } from '@/features/companies/CompaniesPage'
import { CompanyPage } from '@/features/companies/CompanyPage'
import { NotFoundPage } from '@/app/pages/NotFoundPage'

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
