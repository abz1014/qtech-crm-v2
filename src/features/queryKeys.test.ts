import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { invalidateAfter, invalidates, keysFor, type WriteName } from '@/features/invalidation'
import { qk } from '@/features/queryKeys'

const isPrefix = (prefix: readonly unknown[], key: readonly unknown[]) => prefix.every((p, i) => JSON.stringify(p) === JSON.stringify(key[i]))

describe('query-key factory (R01)', () => {
  it('builds hierarchical keys: a detail key is a prefix of its parts', () => {
    expect(isPrefix(qk.companies.all, qk.companies.detail('c1'))).toBe(true)
    expect(isPrefix(qk.companies.detail('c1'), qk.companies.part('c1', 'sites'))).toBe(true)
    expect(isPrefix(qk.companies.detail('c1'), qk.companies.part('c2', 'sites'))).toBe(false)
    expect(isPrefix(qk.companies.lists(), qk.companies.list())).toBe(true)
    expect(isPrefix(qk.companies.lists(), qk.companies.search('x'))).toBe(true)
  })

  it('normalises search text so "  Karachi " and "karachi" share a cache entry', () => {
    expect(qk.companies.search('  Karachi ')).toEqual(qk.companies.search('karachi'))
  })

  it('keeps one area from colliding with another', () => {
    expect(qk.companies.all).not.toEqual(qk.rfqs.all)
    expect(qk.companies.detail('x')).not.toEqual(qk.orders.detail('x'))
  })

  it('holds only plain data (JSON-serialisable)', () => {
    const k = qk.companies.part('c1', 'supplier-stats')
    expect(JSON.parse(JSON.stringify(k))).toEqual(k)
  })
})

describe('invalidation map (R01)', () => {
  const vars: { [N in WriteName]: Parameters<(typeof invalidates)[N]>[0] } = {
    'company.create': { id: 'c1' },
    'company.update': { id: 'c1' },
    'company.merge': { keepId: 'k', dropId: 'd' },
    'site.add': { companyId: 'c1' },
    'contact.add': { companyId: 'c1' },
    'brand.link': { companyId: 'c1' },
    'brand.create': {},
    'team.create': {},
    'team.reset-password': {},
    'team.set-role': {},
    'team.set-job-title': {},
    'team.deactivate': {},
    'team.reactivate': {},
    'company-profile.update': {},
    'target.save': {},
    'category.save': {},
    'site.update': { companyId: 'c1' },
    'site.remove': { companyId: 'c1' },
    'contact.update': { companyId: 'c1' },
    'contact.remove': { companyId: 'c1' },
    'brand.unlink': { companyId: 'c1' },
    'rfq.float': { companyId: 'c1' },
    'rfq.setFloated': { rfqId: 'r1' },
    'quote.save': { rfqId: 'r1' },
    'inquiry.cantQuote': { rfqId: 'r1' },
    'inquiry.chase': { rfqId: 'r1' },
    'rfq.markBidSent': { rfqId: 'r1' },
    'rfq.close': { rfqId: 'r1' },
    'rfq.notes': { rfqId: 'r1' },
    'clarification.add': { rfqId: 'r1' },
    'clarification.ask': { rfqId: 'r1' },
    'clarification.answer': { rfqId: 'r1' },
    'clarification.withdraw': { rfqId: 'r1' },
    'clarification.relay': { rfqId: 'r1' },
    'attachment.add': { rfqId: 'r1' },
    'attachment.delete': { rfqId: 'r1' },
    'order.files': { orderId: 'o1' },
    'quotation.issue': { rfqId: 'r1' },
    'quotation.pdf': { rfqId: 'r1' },
    'order.convert': { rfqId: 'r1' },
    'order.update': { orderId: 'o1' },
    'order.cancel': { orderId: 'o1' },
    'today.chase': {},
    'today.snooze': {},
    'expense.save': {},
    'expense.receipt': { expenseId: 'e1' },
    'recurring.save': {},
    'recurring.record': {},
  }

  it('names at least one key for every write', () => {
    for (const name of Object.keys(invalidates) as WriteName[]) {
      expect(keysFor(name, vars[name] as never).length, name).toBeGreaterThan(0)
    }
  })

  it('a new company refreshes every list but not any one detail', () => {
    expect(keysFor('company.create', { id: 'c1' })).toEqual([qk.companies.lists()])
  })

  it('a merge refreshes everything that pointed at the dropped company', () => {
    const keys = keysFor('company.merge', { keepId: 'k', dropId: 'd' })
    expect(keys).toContainEqual(qk.companies.all)
    expect(keys).toContainEqual(qk.rfqs.all)
    expect(keys).toContainEqual(qk.orders.all)
  })

  it('every change to a person re-reads the team list, and a profile save re-reads the profile', () => {
    for (const n of ['team.create', 'team.reset-password', 'team.set-role', 'team.set-job-title', 'team.deactivate', 'team.reactivate'] as const) {
      expect(keysFor(n, {})).toEqual([qk.settings.team()])
    }
    expect(keysFor('company-profile.update', {})).toEqual([qk.settings.profile()])
  })

  it('a target write refreshes the admin grid and the signed-in person\'s own Today tile; a category write refreshes the category list', () => {
    expect(keysFor('target.save', {})).toEqual([qk.settings.targets(), qk.today.target()])
    expect(keysFor('category.save', {})).toEqual([qk.settings.categories()])
    // the grid's two reads sit under the one prefix that is invalidated
    expect(qk.settings.targetRows(2026).slice(0, 2)).toEqual(qk.settings.targets())
    expect(qk.settings.targetProgress(2026).slice(0, 2)).toEqual(qk.settings.targets())
  })

  it('editing or removing a site or contact refreshes that company only; unlinking a brand also refreshes the roster', () => {
    for (const w of ['site.update', 'site.remove', 'contact.update', 'contact.remove'] as const) {
      expect(keysFor(w, { companyId: 'c1' })).toEqual([qk.companies.detail('c1')])
    }
    expect(keysFor('brand.unlink', { companyId: 'c1' })).toEqual([qk.companies.detail('c1'), qk.companies.lists()])
  })

  it('adding a site or contact refreshes that company only', () => {
    expect(keysFor('site.add', { companyId: 'c1' })).toEqual([qk.companies.detail('c1')])
    expect(keysFor('contact.add', { companyId: 'c1' })).toEqual([qk.companies.detail('c1')])
  })

  it('invalidateAfter marks exactly those keys stale', async () => {
    const client = new QueryClient()
    const spy = vi.spyOn(client, 'invalidateQueries')
    client.setQueryData(qk.companies.part('c1', 'sites'), [])
    client.setQueryData(qk.companies.part('c2', 'sites'), [])
    await invalidateAfter(client, 'site.add', { companyId: 'c1' })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(client.getQueryState(qk.companies.part('c1', 'sites'))?.isInvalidated).toBe(true)
    expect(client.getQueryState(qk.companies.part('c2', 'sites'))?.isInvalidated).toBe(false)
  })
})
