import { lazy, Suspense } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { DestinationPage } from '@/app/pages/DestinationPage'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { Icon } from '@/ui/Icon'

const IntakeScreen = lazy(() => import('@/features/rfqs/IntakeScreen'))

/**
 * Everything under /rfqs. R05 owns `new` (intake and float). The board (R06) and the RFQ page (R07) replace the two
 * stand-ins below; until then the list says so and offers the one thing that works.
 */
export default function RfqsScreen() {
  return (
    <Routes>
      <Route
        index
        element={
          <>
            <DestinationPage navKey="rfqs" />
            <div className="mx-auto flex max-w-list px-4 pb-12 md:px-8">
              <Link
                to="/rfqs/new"
                className="inline-flex h-control items-center justify-center gap-2 rounded border border-primary bg-primary px-3 text-sm font-medium leading-none text-primary-foreground transition-colors duration-fast ease-out hover:border-primary-hover hover:bg-primary-hover"
              >
                <Icon icon={Plus} />
                New RFQ
              </Link>
            </div>
          </>
        }
      />
      <Route
        path="new"
        element={
          <Suspense fallback={null}>
            <IntakeScreen />
          </Suspense>
        }
      />
      <Route path=":id" element={<DestinationPage navKey="rfqs" />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
