// Ported from src/lib/navConfig.ts @ 7a29f3a (Q-Tech CRM v1). Rewritten for the v2 navigation (direction B, 6 items, 3 roles) with Lucide icons per DESIGN_SYSTEM section 10.
import { Building2, CalendarCheck, ChartColumn, FileText, Package, Wallet, type LucideIcon } from 'lucide-react'

export type Role = 'admin' | 'sales' | 'engineer'

export type NavKey = 'today' | 'rfqs' | 'orders' | 'companies' | 'money' | 'reports'

export interface NavItem {
  key: NavKey
  label: string
  path: string
  icon: LucideIcon
  roles: readonly Role[]
}

/**
 * Single source of truth for what each role can reach. Exactly six destinations,
 * in this order (DESIGN_SYSTEM section 12). The top bar, the mobile tab bar, the
 * route guards and the role landing all read this list.
 *
 * Money is admin and sales: engineers never see payments, expenses, costs or
 * margin (DECISIONS 2026-10-13). Sales see invoices, the GST register and each
 * order's balance inside Money; admin-only panels are filtered inside the screen.
 */
export const navItems: readonly NavItem[] = [
  { key: 'today', label: 'Today', path: '/today', icon: CalendarCheck, roles: ['admin', 'sales', 'engineer'] },
  { key: 'rfqs', label: 'RFQs', path: '/rfqs', icon: FileText, roles: ['admin', 'sales', 'engineer'] },
  { key: 'orders', label: 'Orders', path: '/orders', icon: Package, roles: ['admin', 'sales', 'engineer'] },
  { key: 'companies', label: 'Companies', path: '/companies', icon: Building2, roles: ['admin', 'sales', 'engineer'] },
  { key: 'money', label: 'Money', path: '/money', icon: Wallet, roles: ['admin', 'sales'] },
  { key: 'reports', label: 'Reports', path: '/reports', icon: ChartColumn, roles: ['admin', 'sales'] },
]

export function navItemsForRole(role: string): NavItem[] {
  return navItems.filter(i => canAccess(role, i))
}

/** The nav item whose section contains `pathname` (`/rfqs/177` belongs to RFQs), or undefined. */
export function navItemForPath(pathname: string): NavItem | undefined {
  return navItems.find(i => pathname === i.path || pathname.startsWith(`${i.path}/`))
}

export function canAccess(role: string, item: NavItem): boolean {
  return (item.roles as readonly string[]).includes(role)
}
