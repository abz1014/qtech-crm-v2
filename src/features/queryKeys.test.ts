import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { invalidateAfter, invalidates, isMoneyKey, keysFor, type WriteName } from '@/features/invalidation'
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
    'team.set-phone': {},
    'team.deactivate': {},
    'team.reactivate': {},
    'company-profile.update': {},
    'target.save': {},
    'category.save': {},
    'bank.tick': {},
    'month.close': { month: '2026-10' },
    'month.reopen': { month: '2026-10' },
    'site.update': { companyId: 'c1' },
    'site.remove': { companyId: 'c1' },
    'contact.update': { companyId: 'c1' },
    'contact.remove': { companyId: 'c1' },
    'brand.unlink': { companyId: 'c1' },
    'rfq.float': { companyId: 'c1' },
    'rfq.setFloated': { rfqId: 'r1' },
    'fx.set': {},
    'item.add': { rfqId: 'r1' },
    'inquiry.add': { rfqId: 'r1' },
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
    'order.repeat': { companyId: 'c1' },
    'order.update': { orderId: 'o1' },
    'order.cancel': { orderId: 'o1' },
    'po.issue': { orderId: 'o1' },
    'po.pdf': { orderId: 'o1' },
    'today.chase': {},
    'today.snooze': {},
    'expense.save': {},
    'costs.save': { orderId: 'o1' },
    'expense.receipt': { expenseId: 'e1' },
    'recurring.save': {},
    'recurring.record': {},
    'invoice.create': {},
    'invoice.update': { invoiceId: 'i1' },
    'invoice.stamp': {},
    'invoice.receipt': { invoiceId: 'i1' },
    'payment.record': { orderId: 'o1' },
    'payment.remind': {},
    'payment.void': { orderId: 'o1' },
    'payment.correct': { orderId: 'o1' },
    'payment.restore': { orderId: 'o1' },
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
    expect(keysFor('company-profile.update', {})).toEqual([qk.settings.profile(), qk.money.receivables.all, qk.today.all])
  })

  it('a receipt covers a whole PSID group, so it re-reads every invoice read and Today', () => {
    expect(keysFor('invoice.receipt', { invoiceId: 'i1' })).toEqual([qk.money.invoices.all, qk.today.all])
  })

  it('a target write refreshes the admin grid and the signed-in person\'s own Today tile; a category write refreshes the category list', () => {
    expect(keysFor('target.save', {})).toEqual([qk.settings.targets(), qk.today.target()])
    expect(keysFor('category.save', {})).toEqual([qk.settings.categories(), qk.money.categories()])
    expect(keysFor('bank.tick', {})).toEqual([qk.money.bank.all, qk.money.monthEnd.all])
    // the grid's two reads sit under the one prefix that is invalidated
    expect(qk.settings.targetRows(2026).slice(0, 2)).toEqual(qk.settings.targets())
    expect(qk.settings.targetProgress(2026).slice(0, 2)).toEqual(qk.settings.targets())
  })

  it('editing or removing a site refreshes that company only; a contact or an unlinked brand also refreshes the roster (its search)', () => {
    for (const w of ['site.update', 'site.remove'] as const) {
      expect(keysFor(w, { companyId: 'c1' })).toEqual([qk.companies.detail('c1')])
    }
    // the Companies search matches contact names and phones, so a saved contact is found at once
    for (const w of ['contact.update', 'contact.remove'] as const) {
      expect(keysFor(w, { companyId: 'c1' })).toEqual([qk.companies.detail('c1'), qk.companies.lists()])
    }
    expect(keysFor('brand.unlink', { companyId: 'c1' })).toEqual([qk.companies.detail('c1'), qk.companies.lists()])
  })

  it('adding a site refreshes that company only; adding a contact also refreshes the roster', () => {
    expect(keysFor('site.add', { companyId: 'c1' })).toEqual([qk.companies.detail('c1')])
    expect(keysFor('contact.add', { companyId: 'c1' })).toEqual([qk.companies.detail('c1'), qk.companies.lists()])
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

// Code review (p9): writes whose stale screens were reachable in one or two clicks.
describe('invalidation map: stale screens found in review', () => {
  async function staleAfter<N extends WriteName>(name: N, vars: Parameters<typeof keysFor<N>>[1], key: readonly unknown[]) {
    const client = new QueryClient()
    client.setQueryData(key, [])
    await invalidateAfter(client, name, vars)
    // Money that no screen watches is dropped rather than marked (invalidation.ts): stronger than stale, the old figure is gone.
    const state = client.getQueryState(key)
    return state === undefined ? isMoneyKey(key) : state.isInvalidated
  }

  it('closing an RFQ from Today ("Close as no reply") takes it off the Today list', async () => {
    expect(await staleAfter('rfq.close', { rfqId: 'r1' }, qk.today.board())).toBe(true)
  })

  it('closing an RFQ refreshes the customer history, which shows its outcome', async () => {
    expect(await staleAfter('rfq.close', { rfqId: 'r1' }, [...qk.companies.part('c1', 'history'), false])).toBe(true)
  })

  it('asking more suppliers from a Today item refreshes the Today list', async () => {
    expect(await staleAfter('inquiry.add', { rfqId: 'r1' }, qk.today.board())).toBe(true)
  })

  it('saving a supplier price refreshes the Mark won ranking of that RFQ (and only that RFQ)', async () => {
    expect(await staleAfter('quote.save', { rfqId: 'r1' }, qk.orders.ranked('r1', 'admin'))).toBe(true)
    expect(await staleAfter('quote.save', { rfqId: 'r1' }, qk.orders.ranked('r2', 'admin'))).toBe(false)
    expect(await staleAfter('inquiry.cantQuote', { rfqId: 'r1' }, qk.orders.ranked('r1', 'sales'))).toBe(true)
    expect(await staleAfter('item.add', { rfqId: 'r1' }, qk.orders.ranked('r1', 'engineer'))).toBe(true)
  })

  it('a hand-entered rate refreshes every Mark won ranking (they compare in PKR)', async () => {
    expect(await staleAfter('fx.set', {}, qk.orders.ranked('r9', 'admin'))).toBe(true)
  })

  it('an order edit refreshes the customer history, which shows the order state', async () => {
    expect(await staleAfter('order.update', { orderId: 'o1' }, [...qk.companies.part('c1', 'history'), true])).toBe(true)
  })

  it('issuing a quotation refreshes the ranked quotes (they show the quoted selling price)', async () => {
    expect(await staleAfter('quotation.issue', { rfqId: 'r1' }, qk.orders.ranked('r1', 'admin'))).toBe(true)
  })

  it('a merge refreshes every read that shows the dropped company: Today, intake suppliers, memory, POs, money', async () => {
    const v = { keepId: 'k', dropId: 'd' }
    for (const key of [qk.today.board(), qk.intake.suppliers(), qk.memory.rfq('r1', 's'), qk.purchaseOrders.lastToSupplier('d'), qk.money.margins()]) {
      expect(await staleAfter('company.merge', v, key)).toBe(true)
    }
  })

  it('closing an RFQ stops Capture offering it', async () => {
    expect(await staleAfter('rfq.close', { rfqId: 'r1' }, qk.rfqs.capture('u1'))).toBe(true)
  })

  it('a chase from Today refreshes the supplier record and the invoice reminders Money shows', async () => {
    expect(await staleAfter('today.chase', {}, qk.companies.part('s1', 'supplier-activity'))).toBe(true)
    expect(await staleAfter('today.chase', {}, qk.money.invoices.register())).toBe(true)
  })

  it('a payment void, correction or Undo (0073) refreshes every figure built on payments', async () => {
    const keys = [
      qk.money.receivables.list(),
      qk.money.receivables.order('o1'),
      qk.money.receivables.payments('o1'),
      qk.money.bank.month('2026-10'),
      qk.money.monthEnd.status('2026-10'),
      qk.money.monthEnd.aging('2026-10-31'),
      qk.money.margins(),
      qk.money.exceptions(),
      qk.orders.part('o1', 'money'),
      qk.orders.board('admin'),
      qk.today.board(),
      qk.today.target(),
      qk.settings.targetProgress(2026),
      qk.companies.part('c1', 'money'),
    ]
    for (const w of ['payment.void', 'payment.correct', 'payment.restore'] as const) {
      for (const key of keys) expect(await staleAfter(w, { orderId: 'o1' }, key), `${w} ${JSON.stringify(key)}`).toBe(true)
    }
  })

  it('issuing a PO refreshes the supplier record (it shows the leg PO and placed date)', async () => {
    expect(await staleAfter('po.issue', { orderId: 'o1' }, qk.companies.part('s1', 'supplier-record'))).toBe(true)
  })
})
