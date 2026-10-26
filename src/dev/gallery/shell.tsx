// The app shell as a gallery scene: the top bar (tablet and desktop), the phone bar and the phone tabs, with counts,
// at the default text size. The destinations are a fixed list, not navConfig, so the photo only changes when the shell
// does. `?scene=shell&tabs=6` adds Reports, to prove the layout holds for five and for six (e2e/gallery.visual.spec.ts).
import { useSearchParams } from 'react-router-dom'
import { Building2, CalendarCheck, ChartColumn, FileText, Package, Wallet } from 'lucide-react'
import type { NavItem, NavKey } from '@/app/navConfig'
import type { SessionUser } from '@/app/session'
import { BottomTabs, MobileBar } from '@/app/shell/MobileChrome'
import { TopBar } from '@/app/shell/TopBar'

const ALL = ['admin', 'sales', 'engineer'] as const
// Today points at the gallery itself, so it is the active destination in the photo.
const FIVE: NavItem[] = [
  { key: 'today', label: 'Today', path: '/dev/gallery', icon: CalendarCheck, roles: ALL },
  { key: 'rfqs', label: 'RFQs', path: '/rfqs', icon: FileText, roles: ALL },
  { key: 'orders', label: 'Orders', path: '/orders', icon: Package, roles: ALL },
  { key: 'companies', label: 'Companies', path: '/companies', icon: Building2, roles: ALL },
  { key: 'money', label: 'Money', path: '/money', icon: Wallet, roles: ['admin', 'sales'] },
]
const SIX: NavItem[] = [...FIVE, { key: 'reports' as NavKey, label: 'Reports', path: '/reports', icon: ChartColumn, roles: ['admin', 'sales'] }]

// The widest realistic bar: an admin, every count, three-digit RFQs.
const USER: SessionUser = { id: 'gallery-admin', name: 'Farhan Mirza', role: 'admin' }
const COUNTS: Partial<Record<NavKey, number>> = { today: 9, rfqs: 114, orders: 27, money: 3 }

const noop = () => {}

export function ShellScene() {
  const [params] = useSearchParams()
  const items = params.get('tabs') === '6' ? SIX : FIVE
  return (
    <div data-shell-scene="" className="-m-6 grid min-h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] bg-canvas">
      <TopBar user={USER} counts={COUNTS} items={items} onSearch={noop} />
      <MobileBar user={USER} title="Companies" onSearch={noop} />
      <div className="grid content-start gap-2 p-6">
        <p className="text-2xl font-semibold tracking-tight">Today</p>
        <p className="max-w-prose text-sm text-fg-2">The page draws here. The bars above and below are the real shell components.</p>
      </div>
      <BottomTabs role={USER.role} counts={COUNTS} items={items} />
    </div>
  )
}
