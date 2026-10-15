import { Route, Routes } from 'react-router-dom'
import { DestinationPage } from '@/app/pages/DestinationPage'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import OrderDetailScreen from '@/features/orders/OrderDetailScreen'

/** Everything under /orders. Loaded lazily by the app's route table. The list is O04; the detail page is O03. */
export default function OrdersScreen() {
  return (
    <Routes>
      <Route index element={<DestinationPage navKey="orders" />} />
      <Route path=":id" element={<OrderDetailScreen />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
