import { describe, expect, it } from 'vitest'
import { activeLink, railLinks, tabLinks } from '@/app/navConfig'

/* Which lane the rail and the phone bar light (Forest, gate 2): a job's page lights the lane it was opened from, else the job's own lane. */
const lit = (pathname: string, search = '', lane: 'sell' | 'deliver' | null = null, role = 'admin') => activeLink(railLinks(role), pathname, search, lane)?.id

describe('activeLink', () => {
  it('the lists light their lane from ?lane=; the bare list lights none', () => {
    expect(lit('/jobs', '?lane=sell')).toBe('sell')
    expect(lit('/jobs', '?lane=deliver&chip=open')).toBe('deliver')
    expect(lit('/jobs')).toBeUndefined()
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
