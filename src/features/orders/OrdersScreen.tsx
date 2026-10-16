import { Route, Routes } from 'react-router-dom'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import OrderDetailScreen from '@/features/orders/OrderDetailScreen'
import OrdersListPage from '@/features/orders/OrdersListPage'

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
