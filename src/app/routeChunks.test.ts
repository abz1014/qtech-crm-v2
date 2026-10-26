import { describe, expect, it } from 'vitest'
import { chunksForPath } from '@/app/routeChunks'

/*
 * perf/lcp: the pages fetched ahead at start-up (and their first reads) must be exactly the pages the address draws, so nothing
 * is read for a screen that does not show it (e2e/verify-roles: an engineer's answers are checked screen by screen).
 */
describe('chunksForPath', () => {
  it('maps each main screen to its screen and page', () => {
    expect(chunksForPath('/today')).toEqual(['today'])
    // the old addresses open Jobs, so they fetch the Jobs pages
    expect(chunksForPath('/rfqs')).toEqual(['jobs', 'jobsList'])
    expect(chunksForPath('/rfqs/abc')).toEqual(['jobs', 'job'])
    expect(chunksForPath('/rfqs/new')).toEqual(['rfqNew'])
    expect(chunksForPath('/orders')).toEqual(['jobs', 'jobsList'])
    expect(chunksForPath('/orders/abc')).toEqual(['jobs', 'job'])
    expect(chunksForPath('/companies/abc')).toEqual(['companies', 'company'])
    expect(chunksForPath('/money')).toEqual(['money', 'moneyReceivables'])
    expect(chunksForPath('/money/receivables')).toEqual(['money', 'moneyReceivables'])
    expect(chunksForPath('/money/month-end/bank')).toEqual(['money', 'moneyBank'])
    expect(chunksForPath('/money/reports/in-out')).toEqual(['money', 'moneyInOut'])
    expect(chunksForPath('/login')).toEqual(['signIn'])
  })

  it('an address no page owns gets its screen only (it draws Not found), so no page data is read ahead', () => {
    expect(chunksForPath('/rfqs/abc/extra')).toEqual(['jobs'])
    expect(chunksForPath('/orders/abc/extra')).toEqual(['jobs'])
    expect(chunksForPath('/money/nowhere')).toEqual(['money'])
    expect(chunksForPath('/settings')).toEqual([])
    expect(chunksForPath('/')).toEqual([])
  })
})
