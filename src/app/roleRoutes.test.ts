// Ported from src/lib/roleRoutes.ts @ 7a29f3a (Q-Tech CRM v1). New tests: visible items and home route per role, unknown role.
import { describe, expect, it } from 'vitest'
import { navItemsForRole } from '@/app/navConfig'
import { getHomeRoute } from '@/app/roleRoutes'

const paths = (r: string) => navItemsForRole(r).map(i => i.path)

describe('navItemsForRole', () => {
  it('admin sees the five destinations', () =>
    expect(paths('admin')).toEqual(['/today', '/rfqs', '/orders', '/companies', '/money']))
  it('sales sees the five destinations incl. Money (Reports lives inside Money)', () =>
    expect(paths('sales')).toEqual(['/today', '/rfqs', '/orders', '/companies', '/money']))
  it('engineer sees no Money', () =>
    expect(paths('engineer')).toEqual(['/today', '/rfqs', '/orders', '/companies']))
  it('unknown role sees nothing', () => expect(paths('hacker')).toEqual([]))
})

describe('getHomeRoute', () => {
  it.each(['admin', 'sales', 'engineer'])('%s lands on /today', role =>
    expect(getHomeRoute(role)).toBe('/today'))
  it('unknown role goes to /no-access', () => {
    expect(getHomeRoute('')).toBe('/no-access')
    expect(getHomeRoute('guest')).toBe('/no-access')
  })
})
