import type { Role, TeamMember } from '@/features/settings/adminUsers'

/* Pure helpers for the Team screen (kept apart from the components so they test without a DOM). */

export const ROLE_OPTIONS: readonly { value: Role; label: string; help: string }[] = [
  { value: 'admin', label: 'Admin', help: 'Everything, including money, Team and company settings.' },
  {
    value: 'sales',
    label: 'Sales',
    help: 'RFQs, orders, companies, invoices and receivables. No payments, expenses or margins.',
  },
  { value: 'engineer', label: 'Engineer', help: 'RFQs, orders and companies. No invoices, payments or margins.' },
]

export const roleLabel = (role: Role): string => ROLE_OPTIONS.find(r => r.value === role)?.label ?? role

export type TeamFilter = 'all' | 'active' | 'deactivated'

export const isActive = (m: TeamMember): boolean => m.deactivated_at === null

export function teamCounts(members: readonly TeamMember[]) {
  const active = members.filter(isActive).length
  return { all: members.length, active, deactivated: members.length - active }
}

/** Filter by status, then by a name or email search (case-insensitive, any part of either). */
export function filterTeam(members: readonly TeamMember[], filter: TeamFilter, query: string): TeamMember[] {
  const q = query.trim().toLowerCase()
  return members.filter(m => {
    if (filter === 'active' && !isActive(m)) return false
    if (filter === 'deactivated' && isActive(m)) return false
    if (!q) return true
    return m.name.toLowerCase().includes(q) || (m.email ?? '').toLowerCase().includes(q)
  })
}

/** True when this person is the one active admin: demoting or deactivating them is refused. */
export function isOnlyActiveAdmin(m: TeamMember, members: readonly TeamMember[]): boolean {
  return m.role === 'admin' && isActive(m) && members.filter(x => x.role === 'admin' && isActive(x)).length <= 1
}

export const firstName = (name: string): string => name.trim().split(/\s+/)[0] || name

/** The password in groups of four for reading aloud. Display only: the copied value is the raw password. */
export function passwordGroups(password: string): string[] {
  return password.match(/.{1,4}/g) ?? []
}

/** The text an admin pastes into WhatsApp. Carries the password, so it is built only at the moment of copying. */
export function signInMessage(p: { name: string; email: string; password: string; signInUrl: string }): string {
  return [
    `Hi ${firstName(p.name)}, your Q-Tech CRM account is ready.`,
    `Sign in: ${p.signInUrl}`,
    `Email: ${p.email}`,
    `Password: ${p.password}`,
    'Please keep the password private.',
  ].join('\n')
}
