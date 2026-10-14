import { Route, Routes } from 'react-router-dom'
import { BoardPage } from '@/features/rfqs/board/BoardPage'
import RfqDetailScreen from '@/features/rfqs/RfqDetailScreen'
import { NotFoundPage } from '@/app/pages/NotFoundPage'

/** Everything under /rfqs. Loaded lazily by the app's route table. The detail page is R07. */
export default function RfqsScreen() {
  return (
    <Routes>
      <Route index element={<BoardPage />} />
      <Route path=":id" element={<RfqDetailScreen />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
