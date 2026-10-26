import { describe, expect, it } from 'vitest'
import { addDays } from '@/features/rfqs/lib/dateText'
import type { TodayData } from './api'
import { FIXTURE_ADMIN, FIXTURE_TODAY, importedStyleInputs } from './importedFixture'
import { buildToday } from './rules'
import { buildTeam } from './teamModel'
import type { RfqFact } from './types'

/*
 * To do, Team view (P3-B): per person, the same rules over the same facts. A person's late count is their own Late block; work older
 * than 30 days is listed under their name, grey, "since <date>", and is in neither number.
 */
const SALES = 'u-sales'
const ago = (n: number) => addDays(FIXTURE_TODAY, -n) as string
const rfq = (n: number, o: Partial<RfqFact>): RfqFact => ({
  id: `team-rfq-${n}`, number: n, ownerId: SALES, companyName: `Team Customer ${n}`, customerRef: null, receivedOn: FIXTURE_TODAY, dueOn: null, dueTime: null,
  quotedOn: null, isPriority: false, bidState: 'to_bid', sourcingState: 'not_floated', quotationValidUntil: null, ...o,
})

function data(): TodayData {
  const base = importedStyleInputs()
  return {
    ...base,
    clarifications: [],
    legs: [],
    jobs: [],
    snoozes: [],
    monthEnd: null,
    costs: [],
    invoices: [],
    recurring: [],
    receivables: [],
    orders: [],
    inquiries: [],
    rfqs: [rfq(1, { receivedOn: ago(4) }), rfq(2, { receivedOn: ago(3) }), rfq(3, { receivedOn: FIXTURE_TODAY }), rfq(4, { receivedOn: ago(200) })],
    roles: { [FIXTURE_ADMIN]: 'admin', [SALES]: 'sales' },
    names: { [FIXTURE_ADMIN]: 'Admin Person', [SALES]: 'Sales Person' },
    jobTitle: null,
    phone: null,
  }
}

describe('the Team view', () => {
  it('lists everyone but the admin, with their own late count', () => {
    const team = buildTeam(data(), FIXTURE_TODAY, FIXTURE_ADMIN)
    expect(team.map(p => p.id)).toEqual([SALES])
    expect(team[0].name).toBe('Sales Person')
    expect(team[0].late).toBe(2) // received 4 and 3 days ago: not floated, late
    expect(team[0].needsYou).toBe(3) // plus the one received today
  })

  it('a person\'s numbers are the numbers their own list would show', () => {
    const d = data()
    const own = buildToday({ ...importedStyleInputs(), rfqs: d.rfqs, inquiries: [], orders: [], receivables: [], costs: [], invoices: [], monthEnd: null, user: { id: SALES, role: 'sales' }, roleOf: id => d.roles[id ?? ''] ?? null })
    const p = buildTeam(d, FIXTURE_TODAY, FIXTURE_ADMIN)[0]
    expect(p.needsYou).toBe(own.now.length)
    expect(p.stale.map(i => i.key)).toEqual(own.stale.map(i => i.key))
  })

  it('work older than 30 days is greyed under its owner, with its date, and counted nowhere', () => {
    const p = buildTeam(data(), FIXTURE_TODAY, FIXTURE_ADMIN)[0]
    expect(p.stale).toHaveLength(1)
    expect(p.stale[0].badge.text).toMatch(/^since \d{1,2} [A-Z][a-z]{2} \d{4}$/)
    expect(p.stale[0].badge.tone).toBe('neutral')
    expect(p.rows.some(i => i.key === p.stale[0].key)).toBe(false)
  })

  it('shows at most five rows and says how many more', () => {
    const d = data()
    d.rfqs = Array.from({ length: 9 }, (_, i) => rfq(10 + i, { receivedOn: ago(3) }))
    const p = buildTeam(d, FIXTURE_TODAY, FIXTURE_ADMIN)[0]
    expect(p.rows).toHaveLength(5)
    expect(p.more).toBe(4)
  })

  it('puts the person with the most late work first', () => {
    const d = data()
    d.roles['u-other'] = 'sales'
    d.names['u-other'] = 'Another Person'
    d.rfqs = [...d.rfqs, rfq(30, { ownerId: 'u-other', receivedOn: ago(3) })]
    expect(buildTeam(d, FIXTURE_TODAY, FIXTURE_ADMIN).map(p => p.id)).toEqual([SALES, 'u-other'])
  })
})
