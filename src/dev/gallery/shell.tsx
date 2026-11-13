// The app shell as a gallery scene (Forest): the rail and the top bar (768 up), the phone band and the bottom bar, with Home's number
// and Money's late dot, at the default text size. The lanes are a fixed list, not navConfig, so the photo only changes when the shell
// does. `?scene=shell&role=engineer` draws the engineer's rail and bar instead (e2e/gallery.visual.spec.ts).
import { useSearchParams } from 'react-router-dom'
import { Building2, Camera, House, Receipt, Send, Truck, Wallet } from 'lucide-react'
import type { NavKey, ShellLink } from '@/app/navConfig'
import type { SessionUser } from '@/app/session'
import { BottomTabs, MobileBar } from '@/app/shell/MobileChrome'
import { Rail } from '@/app/shell/Rail'
import { TopBar } from '@/app/shell/TopBar'

const HOME: ShellLink = { id: 'home', label: 'Home', to: '/dev/gallery', icon: House, count: 'today' }
const SELL: ShellLink = { id: 'sell', label: 'Sell', to: '/jobs?lane=sell', icon: Send }
const DELIVER: ShellLink = { id: 'deliver', label: 'Deliver', to: '/jobs?lane=deliver', icon: Truck }
const MONEY: ShellLink = { id: 'money', label: 'Money', to: '/money', icon: Wallet, count: 'money' }
const COMPANIES: ShellLink = { id: 'companies', label: 'Companies', to: '/companies', icon: Building2, apart: true }
const JOBS: ShellLink = { id: 'jobs', label: 'Jobs', to: '/jobs', icon: Truck }
const I_PAID: ShellLink = { id: 'ipaid', label: 'I paid', to: '/my-expenses', icon: Receipt }
const CAMERA: ShellLink = { id: 'camera', label: 'Camera', to: '/capture', icon: Camera }

const OFFICE = { rail: [HOME, SELL, DELIVER, MONEY, COMPANIES], tabs: [HOME, SELL, DELIVER, MONEY] }
const ENGINEER = { rail: [HOME, I_PAID, JOBS], tabs: [HOME, CAMERA, I_PAID, JOBS] }

// The widest realistic bar: an admin with a three-digit number on Home and Money's late dot.
const ADMIN: SessionUser = { id: 'gallery-admin', name: 'Farhan Mirza', role: 'admin' }
const ENGINEER_USER: SessionUser = { id: 'gallery-engineer', name: 'Daniyal Khan', role: 'engineer' }
const COUNTS: Partial<Record<NavKey, number>> = { today: 114 }
const DOTS: Partial<Record<NavKey, boolean>> = { money: true }

const noop = () => {}

export function ShellScene() {
  const [params] = useSearchParams()
  const engineer = params.get('role') === 'engineer'
  const user = engineer ? ENGINEER_USER : ADMIN
  const set = engineer ? ENGINEER : OFFICE
  const dots = engineer ? undefined : DOTS
  return (
    <div
      data-shell-scene=""
      className="-m-6 grid min-h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] bg-canvas md:grid-cols-[auto_minmax(0,1fr)] md:grid-rows-[auto_minmax(0,1fr)]"
    >
      <Rail user={user} counts={COUNTS} dots={dots} collapsed={false} onToggle={noop} links={set.rail} current="home" />
      <TopBar user={user} onSearch={noop} />
      <MobileBar user={user} title="Companies" onSearch={noop} />
      <div className="grid min-w-0 content-start gap-2 p-6">
        <p className="text-2xl font-semibold tracking-tight">Home</p>
        <p className="max-w-prose text-sm text-fg-2">The page draws here. The bars around it are the real shell components.</p>
      </div>
      <BottomTabs role={user.role} counts={COUNTS} dots={dots} links={set.tabs} current="home" />
    </div>
  )
}
