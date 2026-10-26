// Ported from src/lib/roleRoutes.ts @ 7a29f3a (Q-Tech CRM v1). New tests: visible items and home route per role, unknown role.
import { describe, expect, it } from 'vitest'
import { navItemsForRole } from '@/app/navConfig'
import { getHomeRoute } from '@/app/roleRoutes'

const paths = (r: string) => navItemsForRole(r).map(i => i.path)

describe('navItemsForRole', () => {
  it('admin sees four destinations: To do, Jobs, Money, Companies', () =>
    expect(paths('admin')).toEqual(['/todo', '/jobs', '/money', '/companies']))
  it('sales sees the same four (Reports lives inside Money)', () =>
    expect(paths('sales')).toEqual(['/todo', '/jobs', '/money', '/companies']))
  it('an engineer sees To do and Jobs only', () =>
    expect(paths('engineer')).toEqual(['/todo', '/jobs']))
  it('unknown role sees nothing', () => expect(paths('hacker')).toEqual([]))
})

describe('getHomeRoute', () => {
  it.each(['admin', 'sales', 'engineer'])('%s lands on /todo', role =>
    expect(getHomeRoute(role)).toBe('/todo'))
  it('unknown role goes to /no-access', () => {
    expect(getHomeRoute('')).toBe('/no-access')
    expect(getHomeRoute('guest')).toBe('/no-access')
  })
})
