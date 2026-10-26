import { Boxes, Building2, KeyRound, Receipt, RefreshCw, Target, User, Users, type LucideIcon } from 'lucide-react'
import { seesPrices } from '@/app/session'

/*
 * The Settings pages, in menu order and in their two groups (the company's settings, then yours): ONE list read by the
 * Settings menu (SettingsLayout) and by the command palette's Jump to (src/app/palette/PaletteHost.tsx), so the two can
 * never disagree about what a role may open. Team, Targets and Expense categories are admin only; Exchange rates is admin and
 * sales (an engineer sees no currency amount: owner decision 2026-10-22); everything else is for every role (the company profile
 * is read only unless admin).
 */
export interface SettingsLink {
  to: string
  label: string
  icon: LucideIcon
  adminOnly?: boolean
  /** Admin and sales only: the page shows amounts (owner decision 2026-10-22, engineers see no prices). */
  pricesOnly?: boolean
  /** Shown at the right for everyone who is not an admin ("View only"). */
  tagForOthers?: string
}

export const SETTINGS_GROUPS: readonly { title: string; links: readonly SettingsLink[] }[] = [
  {
    title: 'Company',
    links: [
      { to: '/settings/team', label: 'Team', icon: Users, adminOnly: true },
      { to: '/settings/company', label: 'Company profile', icon: Building2, tagForOthers: 'View only' },
      { to: '/settings/targets', label: 'Targets', icon: Target, adminOnly: true },
      { to: '/settings/categories', label: 'Expense categories', icon: Receipt, adminOnly: true },
      { to: '/settings/product-categories', label: 'Product categories', icon: Boxes, adminOnly: true },
      { to: '/settings/exchange-rates', label: 'Exchange rates', icon: RefreshCw, pricesOnly: true },
    ],
  },
  {
    title: 'You',
    links: [
      { to: '/settings/details', label: 'Your details', icon: User },
      { to: '/settings/password', label: 'Change password', icon: KeyRound },
    ],
  },
]

export const SETTINGS_LINKS: readonly SettingsLink[] = SETTINGS_GROUPS.flatMap(g => g.links)

/** Whether this role may open this Settings page. */
export function canOpenSettingsLink(l: SettingsLink, role: string | null | undefined): boolean {
  return (role === 'admin' || !l.adminOnly) && (!l.pricesOnly || seesPrices(role))
}

/** The Settings pages this role can open. */
export function settingsLinksFor(role: string | null | undefined): SettingsLink[] {
  return SETTINGS_LINKS.filter(l => canOpenSettingsLink(l, role))
}
