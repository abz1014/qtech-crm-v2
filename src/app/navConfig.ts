// Ported from src/lib/navConfig.ts @ 7a29f3a (Q-Tech CRM v1). Rewritten for the v2 navigation (direction B, 5 items since the
// 2026-10-19 owner decision, 3 roles) with Lucide icons per DESIGN_SYSTEM section 10. Forest lanes (gate 2, 13 Nov 2026) on top.
import { Briefcase, Building2, Camera, House, Receipt, Send, Truck, Wallet, type LucideIcon } from 'lucide-react'

export type Role = 'admin' | 'sales' | 'engineer'

export type NavKey = 'today' | 'jobs' | 'companies' | 'money'

/**
 * The keys a "need you" number can be filed under. The shell draws only Home's (the To do list); the RFQ and order shares of the same one
 * list stay as keys (the old RFQ board and Orders list that read them were removed on 2026-10-30).
 */
export type CountKey = NavKey | 'rfqs' | 'orders'

export interface NavItem {
  key: NavKey
  label: string
  path: string
  icon: LucideIcon
  roles: readonly Role[]
  /** Other address prefixes that light this item (the old RFQ and Order pages light Jobs). */
  also?: readonly string[]
}

/**
 * The destinations, as routes: what each role can reach. The route guards (routes.tsx), the role landing, the no-access page and the
 * command palette's "Jump to" read this list. The rail and the phone bar draw lanes on top of it (railLinks, tabLinks below): Sell and
 * Deliver are two views of /jobs, so the routes stay as they are and only the navigation around them changes (02-navigation.html).
 *
 * Money is admin and sales: engineers never see payments, expenses, costs or margin (DECISIONS 2026-10-13). Sales see To collect,
 * Invoices and Reports inside Money; admin-only views are filtered inside the screen. An engineer's list is Home and Jobs only.
 * Reports is not a destination of its own: `/reports` opens Money's Reports view. RFQs and Orders are not destinations any
 * more: /rfqs and /orders open Jobs (src/app/oldAddresses.tsx). /todo is the Home page (it was called "To do"; gate 2).
 */
export const navItems: readonly NavItem[] = [
  { key: 'today', label: 'Home', path: '/todo', icon: House, roles: ['admin', 'sales', 'engineer'] },
  { key: 'jobs', label: 'Jobs', path: '/jobs', icon: Briefcase, roles: ['admin', 'sales', 'engineer'], also: ['/rfqs', '/orders'] },
  { key: 'money', label: 'Money', path: '/money', icon: Wallet, roles: ['admin', 'sales'] },
  { key: 'companies', label: 'Companies', path: '/companies', icon: Building2, roles: ['admin', 'sales'] },
]

export function navItemsForRole(role: string): NavItem[] {
  return navItems.filter(i => canAccess(role, i))
}

/** The nav item whose section contains `pathname` (`/rfqs/177` belongs to Jobs), or undefined. */
export function navItemForPath(pathname: string): NavItem | undefined {
  const on = (p: string) => pathname === p || pathname.startsWith(`${p}/`)
  return navItems.find(i => on(i.path) || (i.also ?? []).some(on))
}

export function canAccess(role: string, item: NavItem): boolean {
  return (item.roles as readonly string[]).includes(role)
}

/* ---- Lanes: what the rail and the phone bar draw (gate 2) ------------------------------------------------------------------ */

/**
 * The Jobs list's lens, in the address: /jobs?lane=sell (stages 1-2: enquiry, quotation) or /jobs?lane=deliver (stages 3-5). The shell
 * only links and lights them; the Jobs list reads the lens (lane A2).
 */
export const LANE_PARAM = 'lane'
export type Lane = 'sell' | 'deliver'

export type ShellLinkId = 'home' | 'sell' | 'deliver' | 'money' | 'companies' | 'jobs' | 'ipaid' | 'camera'

export interface ShellLink {
  id: ShellLinkId
  label: string
  /** Where it goes (a lane carries its ?lane=). */
  to: string
  icon: LucideIcon
  /** Which "needs you" number or late dot it carries (Home: the To do count; Money: the late dot). */
  count?: NavKey
  /** Drawn under a divider on the rail: a directory, not a stage (Companies). */
  apart?: boolean
}

const HOME: ShellLink = { id: 'home', label: 'Home', to: '/todo', icon: House, count: 'today' }
const SELL: ShellLink = { id: 'sell', label: 'Sell', to: `/jobs?${LANE_PARAM}=sell`, icon: Send }
const DELIVER: ShellLink = { id: 'deliver', label: 'Deliver', to: `/jobs?${LANE_PARAM}=deliver`, icon: Truck }
const MONEY: ShellLink = { id: 'money', label: 'Money', to: '/money', icon: Wallet, count: 'money' }
const COMPANIES: ShellLink = { id: 'companies', label: 'Companies', to: '/companies', icon: Building2, apart: true }
const JOBS: ShellLink = { id: 'jobs', label: 'Jobs', to: '/jobs', icon: Truck }
/** The engineer's own expense claims (owner decision 12 Nov 2026: on the engineer's bar; sales reach it from the account menu, admins have none). */
const I_PAID: ShellLink = { id: 'ipaid', label: 'I paid', to: '/my-expenses', icon: Receipt }
const CAMERA: ShellLink = { id: 'camera', label: 'Camera', to: '/capture', icon: Camera }

const item = (key: NavKey) => navItems.find(i => i.key === key) as NavItem
const reaches = (role: string, key: NavKey) => canAccess(role, item(key))
/** The office lanes are for the roles that see money: Sell and Deliver split one Jobs list by stage. */
const office = (role: string) => reaches(role, 'money')

/**
 * The rail (768 up), in order. Admin and sales: Home, Sell, Deliver, Money, then Companies under a divider. Engineer: Home, I paid, Jobs
 * (their camera is the lime button at the top of the rail). Unknown role: nothing.
 */
export function railLinks(role: string): ShellLink[] {
  if (!reaches(role, 'today')) return []
  if (office(role)) return [HOME, SELL, DELIVER, MONEY, ...(reaches(role, 'companies') ? [COMPANIES] : [])]
  return [HOME, I_PAID, JOBS]
}

/**
 * The phone bottom bar (below 768). Admin and sales: Home, Sell, Deliver, Money (the + for Create is drawn between Sell and Deliver;
 * Companies is reached from Home and Search, owner decision 12 Nov 2026). Engineer: Home, Camera, I paid, Jobs (gate 2 question 3).
 */
export function tabLinks(role: string): ShellLink[] {
  if (!reaches(role, 'today')) return []
  if (office(role)) return [HOME, SELL, DELIVER, MONEY]
  return [HOME, CAMERA, I_PAID, JOBS]
}

/** The lane in an address's query string, or null. */
export function laneOf(search: string): Lane | null {
  const v = new URLSearchParams(search).get(LANE_PARAM)
  return v === 'sell' || v === 'deliver' ? v : null
}

/** The lane a job page was opened from (/jobs/139?from=deliver: the Jobs list adds it to a row it opens from a lane), or null. */
export function fromLaneOf(search: string): Lane | null {
  const v = new URLSearchParams(search).get('from')
  return v === 'sell' || v === 'deliver' ? v : null
}

/**
 * Which of `links` an address belongs to. /jobs lights the lane in its ?lane= (an engineer's Jobs, whatever it says); a job's own page
 * (/jobs/139) lights the lane it was opened from (?from=), else the lane the page says the job is in (`pageLane`: the Job page passes
 * laneOfJob through the shell, so a job opened from Home or Search lights its lane too). The old RFQ and enquiry addresses light Sell,
 * the old order addresses Deliver. The bare list names no lane, so no lane is lit.
 */
export function activeLink(links: readonly ShellLink[], pathname: string, search = '', pageLane: Lane | null = null): ShellLink | undefined {
  const on = (p: string) => pathname === p || pathname.startsWith(`${p}/`)
  const find = (id: ShellLinkId) => links.find(l => l.id === id)
  if (on('/todo')) return find('home')
  if (on('/jobs') || on('/rfqs') || on('/enquiries') || on('/orders')) {
    const jobs = find('jobs')
    if (jobs) return jobs
    const list = pathname === '/jobs' || pathname === '/jobs/'
    const lane = list ? laneOf(search) : on('/jobs') ? (fromLaneOf(search) ?? pageLane) : null
    if (lane) return find(lane)
    if (on('/rfqs') || on('/enquiries')) return find('sell')
    if (on('/orders')) return find('deliver')
    return undefined
  }
  if (on('/money') || on('/reports')) return find('money')
  if (on('/companies')) return find('companies')
  if (on('/my-expenses')) return find('ipaid')
  if (on('/capture')) return find('camera')
  return undefined
}
