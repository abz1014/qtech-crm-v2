import { Route, Routes } from 'react-router-dom'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { lazyWithReload as lazy } from '@/lib/importWithReload'

// The list and the order page are separate downloads (perf/lcp): the list does not bring the order page's panels and dialogs.
const OrdersListPage = lazy(() => import('@/features/orders/OrdersListPage'))
const OrderDetailScreen = lazy(() => import('@/features/orders/OrderDetailScreen'))

/** Everything under /orders. Loaded lazily by the app's route table. The list is O04 (with O02's "New order"); the detail page is O03. */
export default function OrdersScreen() {
  return (
    <Routes>
      <Route index element={<OrdersListPage />} />
      <Route path=":id" element={<OrderDetailScreen />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
