import { describe, expect, it } from 'vitest'
import { HandCoins, Receipt } from 'lucide-react'
import { activeLink, laneOfStage, railLinks, tabLinks } from '@/app/navConfig'

/* Which lane the rail and the phone bar light (Forest, gate 2): a job's page lights the lane it was opened from, else the job's own lane. */
const lit = (pathname: string, search = '', lane: 'sell' | 'deliver' | null = null, role = 'admin') => activeLink(railLinks(role), pathname, search, lane)?.id

describe('activeLink', () => {
  it('the lists light their lane from ?lane=; the bare list lights none', () => {
    expect(lit('/jobs', '?lane=sell')).toBe('sell')
    expect(lit('/jobs', '?lane=deliver&chip=open')).toBe('deliver')
    expect(lit('/jobs')).toBeUndefined()
  })

  it('the old /rfqs and /orders lists light a lane (screen review 14): /rfqs lands on Sell, /orders on the Orders stage, which is Deliver', () => {
    expect(lit('/jobs', '?lane=sell')).toBe('sell')
    expect(lit('/jobs', '?stage=orders')).toBe('deliver')
    expect(lit('/jobs', '?chip=history&stage=orders')).toBe('deliver')
    expect(lit('/jobs', '?stage=quotation')).toBe('sell')
    // ?lane= wins over the stage
    expect(lit('/jobs', '?lane=sell&stage=orders')).toBe('sell')
    expect(laneOfStage('?stage=nonsense')).toBeNull()
    expect(laneOfStage('')).toBeNull()
    // an engineer has Jobs, whatever the stage
    expect(lit('/jobs', '?stage=orders', null, 'engineer')).toBe('jobs')
  })

  it('a job page lights the lane in ?from=, which wins over the job\'s own lane', () => {
    expect(lit('/jobs/139', '?from=deliver')).toBe('deliver')
    expect(lit('/jobs/139', '?from=sell', 'deliver')).toBe('sell')
  })

  it('a job page opened without ?from= (Home, Search) lights the lane the page names, and none when it names none', () => {
    expect(lit('/jobs/139', '', 'deliver')).toBe('deliver')
    expect(lit('/jobs/O-45', '?stage=payment', 'sell')).toBe('sell')
    expect(lit('/jobs/139')).toBeUndefined()
    // ?lane= on a job page is not the list's lens
    expect(lit('/jobs/139', '?lane=sell')).toBeUndefined()
  })

  it('an engineer has Jobs, whatever the address says', () => {
    expect(lit('/jobs/139', '?from=sell', 'sell', 'engineer')).toBe('jobs')
  })

  it('the phone bar lights the same lane', () => {
    expect(activeLink(tabLinks('sales'), '/jobs/139', '', 'deliver')?.id).toBe('deliver')
  })
})

describe('I paid', () => {
  it('uses a neutral icon, not the receipt with a dollar sign: the currency is PKR (screen review 12)', () => {
    const ipaid = railLinks('engineer').find(l => l.id === 'ipaid')
    expect(ipaid?.icon).toBe(HandCoins)
    expect(ipaid?.icon).not.toBe(Receipt)
  })
})
