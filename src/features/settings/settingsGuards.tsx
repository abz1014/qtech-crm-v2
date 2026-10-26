import type { ReactNode } from 'react'
import { NoAccessPage } from '@/app/pages/NoAccessPage'
import { useSeesPrices, useSession } from '@/app/session'

/* The route guards of Settings, apart from the Settings layout so the layout (its list, version label, install banner) is not in the first load. */
const useIsAdmin = () => {
  const s = useSession()
  return s.status === 'signed-in' && s.user.role === 'admin'
}

/** Exchange rates: admin and sales. An engineer sees the no-access page (owner decision 2026-10-22: no currency amounts). */
export function PricesOnly({ area, children }: { area: string; children: ReactNode }) {
  return useSeesPrices() ? <>{children}</> : <NoAccessPage area={area} roles={['admin', 'sales']} />
}

/** The Team screen is admin only. Anyone else sees the no-access page inside the shell, never the data (the function refuses them too). */
export function AdminOnly({ area, children }: { area: string; children: ReactNode }) {
  return useIsAdmin() ? <>{children}</> : <NoAccessPage area={area} />
}
