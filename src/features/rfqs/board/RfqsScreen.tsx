import { Route, Routes } from 'react-router-dom'
import { BoardPage } from '@/features/rfqs/board/BoardPage'
import { RfqDetailPlaceholder } from '@/features/rfqs/board/RfqDetailPlaceholder'
import { NotFoundPage } from '@/app/pages/NotFoundPage'

/** Everything under /rfqs. Loaded lazily by the app's route table. R07 replaces the detail placeholder. */
export default function RfqsScreen() {
  return (
    <Routes>
      <Route index element={<BoardPage />} />
      <Route path=":id" element={<RfqDetailPlaceholder />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
