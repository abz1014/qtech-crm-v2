import { Route, Routes } from 'react-router-dom'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { lazyWithReload as lazy } from '@/lib/importWithReload'

// The board and the record page are separate downloads (perf/lcp): the board does not bring the record page's dialogs.
const BoardPage = lazy(() => import('@/features/rfqs/board/BoardPage').then(m => ({ default: m.BoardPage })))
const RfqDetailScreen = lazy(() => import('@/features/rfqs/RfqDetailScreen'))

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
