// Ported from src/lib/navConfig.ts @ 7a29f3a (Q-Tech CRM v1). Rewritten for the v2 navigation (6 items, 3 roles); icons dropped (no icon dependency yet).
export type Role = 'admin' | 'sales' | 'engineer'

export interface NavItem {
  label: string
  path: string
  roles: readonly Role[]
}

/** Single source of truth for what each role can reach. */
export const navItems: readonly NavItem[] = [
  { label: 'Today', path: '/today', roles: ['admin', 'sales', 'engineer'] },
  { label: 'RFQs', path: '/rfqs', roles: ['admin', 'sales', 'engineer'] },
  { label: 'Orders', path: '/orders', roles: ['admin', 'sales', 'engineer'] },
  { label: 'Companies', path: '/companies', roles: ['admin', 'sales', 'engineer'] },
  // Sales see invoices/GST only inside Money, but the item shows for both.
  { label: 'Money', path: '/money', roles: ['admin', 'sales'] },
  { label: 'Reports', path: '/reports', roles: ['admin', 'sales'] },
]

export function navItemsForRole(role: string): NavItem[] {
  return navItems.filter(i => (i.roles as readonly string[]).includes(role))
}
