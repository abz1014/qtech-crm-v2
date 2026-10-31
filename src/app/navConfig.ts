// Ported from src/lib/navConfig.ts @ 7a29f3a (Q-Tech CRM v1). Rewritten for the v2 navigation (direction B, 5 items since the
// 2026-10-19 owner decision, 3 roles) with Lucide icons per DESIGN_SYSTEM section 10.
import { Briefcase, Building2, CalendarCheck, Wallet, type LucideIcon } from 'lucide-react'

export type Role = 'admin' | 'sales' | 'engineer'

export type NavKey = 'today' | 'jobs' | 'companies' | 'money'

/**
 * The keys a "need you" number can be filed under. The top bar draws only To do's; the RFQ and order shares of the same one list stay as keys
 * (the old RFQ board and Orders list that read them were removed on 2026-10-30).
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
 * Single source of truth for what each role can reach. Four destinations for the office, two for an engineer
 * (redesign phase 5, owner decision 2026-10-22: To do, Jobs, Money, Companies). The top bar,
 * the mobile tab bar, the command palette's "Jump to", the route guards and the
 * role landing all read this list.
 *
 * Money is admin and sales: engineers never see payments, expenses, costs or
 * margin (DECISIONS 2026-10-13). Sales see To collect, Invoices and Reports
 * inside Money; admin-only views are filtered inside the screen. An engineer's list is To do and Jobs only.
 * Reports is not a destination of its own: `/reports` opens Money's Reports view. RFQs and Orders are not destinations any
 * more: /rfqs and /orders open Jobs (src/app/oldAddresses.tsx).
 */
export const navItems: readonly NavItem[] = [
  { key: 'today', label: 'To do', path: '/todo', icon: CalendarCheck, roles: ['admin', 'sales', 'engineer'] },
  { key: 'jobs', label: 'Jobs', path: '/jobs', icon: Briefcase, roles: ['admin', 'sales', 'engineer'], also: ['/rfqs', '/orders'] },
  { key: 'money', label: 'Money', path: '/money', icon: Wallet, roles: ['admin', 'sales'] },
  { key: 'companies', label: 'Companies', path: '/companies', icon: Building2, roles: ['admin', 'sales'] },
]

export function navItemsForRole(role: string): NavItem[] {
  return navItems.filter(i => canAccess(role, i))
}

/** The nav item whose section contains `pathname` (`/rfqs/177` belongs to RFQs), or undefined. */
export function navItemForPath(pathname: string): NavItem | undefined {
  const on = (p: string) => pathname === p || pathname.startsWith(`${p}/`)
  return navItems.find(i => on(i.path) || (i.also ?? []).some(on))
}

export function canAccess(role: string, item: NavItem): boolean {
  return (item.roles as readonly string[]).includes(role)
}
