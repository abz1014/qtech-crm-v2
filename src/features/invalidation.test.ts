import { MutationObserver, QueryClient, QueryObserver, onlineManager, type QueryKey } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MONEY_WAIT_CEILING_MS, invalidateAfter, isMoneyKey, keysFor, type InvalidateOptions, type WriteName, type WriteVars } from '@/features/invalidation'
import { qk } from '@/features/queryKeys'

/*
 * Audit 2, performance #1: a save returns when the server confirms; the screens read themselves again in the background.
 * These tests pin what must still hold: every key of the map goes stale, a read sent before the write can never land as
 * current, and no money figure from before a save is shown after it.
 */

const vars: { [N in WriteName]: WriteVars[N] } = {
  'company.create': { id: 'c1' },
  'company.update': { id: 'c1' },
  'company.merge': { keepId: 'k', dropId: 'd' },
  'site.add': { companyId: 'c1' },
  'contact.add': { companyId: 'c1' },
  'site.update': { companyId: 'c1' },
  'site.remove': { companyId: 'c1' },
  'contact.update': { companyId: 'c1' },
  'contact.remove': { companyId: 'c1' },
  'brand.unlink': { companyId: 'c1' },
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
const writes = Object.keys(vars) as WriteName[]
const run = (client: QueryClient, name: WriteName, options?: InvalidateOptions) => invalidateAfter(client, name, vars[name] as never, options)

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, gcTime: 300_000 } } })
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

/**
 * A fake database row with a fake network in front of it. A read sees the row as it is when the request is SENT and
 * answers only when the test says so, so a reply can be made to arrive after a write that committed later.
 */
function backend(initial: string) {
  const db = { value: initial }
  const inFlight: Array<{ sent: string; reply: () => void }> = []
  let reads = 0
  const read = () =>
    new Promise<string>(resolve => {
      reads += 1
      const sent = db.value
      inFlight.push({ sent, reply: () => resolve(sent) })
    })
  return {
    db,
    read,
    get reads() {
      return reads
    },
    /** Answer the oldest (or the n-th) request still waiting. */
    reply: (n = 0) => inFlight.splice(n, 1)[0]?.reply(),
    replyAll: () => inFlight.splice(0).forEach(r => r.reply()),
    get waiting() {
      return inFlight.length
    },
  }
}

/** A mounted screen reading `key`: what it rendered, in order. */
function screen(client: QueryClient, key: QueryKey, read: () => Promise<string>) {
  const observer = new QueryObserver<string>(client, { queryKey: key, queryFn: read })
  const shown: Array<string | undefined> = []
  const stop = observer.subscribe(r => shown.push(r.data))
  return { observer, shown, stop, data: () => observer.getCurrentResult().data }
}

function saveWith(client: QueryClient, write: () => void, name: WriteName, options?: InvalidateOptions) {
  const m = new MutationObserver(client, {
    mutationFn: async () => {
      write()
    },
    onSuccess: () => run(client, name, options),
  })
  const state = { done: false }
  const promise = m.mutate().then(() => {
    state.done = true
  })
  return { state, promise }
}

afterEach(() => {
  vi.useRealTimers()
  onlineManager.setOnline(true)
})

describe('isMoneyKey', () => {
  it('names the money root and the money slice of an order or a company, nothing else', () => {
    expect(isMoneyKey(qk.money.receivables.list())).toBe(true)
    expect(isMoneyKey(qk.money.orderCosts('o1'))).toBe(true)
    expect(isMoneyKey(qk.orders.part('o1', 'money'))).toBe(true)
    expect(isMoneyKey(qk.companies.part('c1', 'money'))).toBe(true)
    expect(isMoneyKey(qk.orders.part('o1', 'header'))).toBe(false)
    expect(isMoneyKey(qk.orders.detail('o1'))).toBe(false)
    expect(isMoneyKey(qk.today.board())).toBe(false)
    expect(isMoneyKey(qk.rfqs.values())).toBe(false)
  })
})

describe('every key in the invalidation map still goes stale', () => {
  it.each(writes)('%s: each key and the reads under it are stale (or, for money nobody watches, gone)', async name => {
    const client = newClient()
    const keys = keysFor(name, vars[name] as never)
    const seeded = keys.flatMap(k => [k, [...k, 'leaf']])
    for (const k of seeded) client.setQueryData(k, 'before')
    await run(client, name)
    for (const k of seeded) {
      const state = client.getQueryState(k)
      if (state === undefined) expect(isMoneyKey(k), `${name}: ${JSON.stringify(k)} was dropped but is not money`).toBe(true)
      else expect(state.isInvalidated, `${name}: ${JSON.stringify(k)}`).toBe(true)
    }
  })

  it.each(writes)('%s: each key on screen is read again', async name => {
    const client = newClient()
    const keys = keysFor(name, vars[name] as never)
    const screens = keys.map(k => {
      const b = backend('before')
      client.setQueryData(k, 'before')
      return { b, s: screen(client, k, b.read) }
    })
    for (const { b } of screens) b.db.value = 'after' // the write commits
    const saved = run(client, name)
    for (const { b } of screens) {
      expect(b.waiting).toBe(1)
      b.replyAll()
    }
    await saved
    await flush()
    for (const { s } of screens) expect(s.data()).toBe('after')
    screens.forEach(x => x.s.stop())
  })

  it('order.update and po.issue make the Margin panel and the margins list stale (they move its supplier-price inputs)', () => {
    for (const name of ['order.update', 'po.issue'] as const) {
      expect(keysFor(name, { orderId: 'o1' })).toContainEqual(qk.money.orderCosts('o1'))
      expect(keysFor(name, { orderId: 'o1' })).toContainEqual(qk.money.margins())
    }
  })
})

describe('a save returns when the server confirms, not when every screen has caught up', () => {
  it('a slow refetch of a non-money screen (Today) does not hold the save', async () => {
    const client = newClient()
    const today = backend('item due')
    client.setQueryData(qk.today.board(), 'item due')
    const s = screen(client, qk.today.board(), today.read)
    const save = saveWith(client, () => (today.db.value = 'item snoozed'), 'today.snooze')
    await save.promise
    // Returned while Today is still reading; Today is already marked stale and fetching.
    expect(today.waiting).toBe(1)
    expect(client.getQueryState(qk.today.board())).toMatchObject({ isInvalidated: true, fetchStatus: 'fetching' })
    today.replyAll()
    await flush()
    expect(s.data()).toBe('item snoozed')
    s.stop()
  })

  it("wait: 'all' keeps the old behaviour: the save returns once every screen has its new data", async () => {
    const client = newClient()
    const today = backend('item due')
    client.setQueryData(qk.today.board(), 'item due')
    const s = screen(client, qk.today.board(), today.read)
    const save = saveWith(client, () => (today.db.value = 'item chased'), 'today.chase', { wait: 'all' })
    await flush()
    await flush()
    expect(save.state.done).toBe(false)
    today.replyAll()
    await save.promise
    expect(s.data()).toBe('item chased')
    s.stop()
  })

  it('a query under two keys of one write is read once (payment.record names receivables and that order\'s payments)', async () => {
    const client = newClient()
    const payments = backend('none')
    client.setQueryData(qk.money.receivables.payments('o1'), 'none')
    const s = screen(client, qk.money.receivables.payments('o1'), payments.read)
    const saved = run(client, 'payment.record')
    expect(payments.reads).toBe(1)
    payments.replyAll()
    await saved
    s.stop()
  })
})

describe('no money figure from before a save is shown after it', () => {
  it('money on screen: the save returns only once the new balance is showing, and nothing after shows the old one', async () => {
    const client = newClient()
    const balance = backend('100')
    client.setQueryData(qk.money.receivables.list(), '100')
    const s = screen(client, qk.money.receivables.list(), balance.read)
    const save = saveWith(client, () => (balance.db.value = '60'), 'payment.record')
    await flush()
    await flush()
    expect(save.state.done).toBe(false)
    const shownBeforeReply = s.shown.length
    balance.replyAll()
    await save.promise
    expect(s.data()).toBe('60')
    expect(s.shown.slice(shownBeforeReply).filter(v => v !== undefined)).not.toContain('100')
    s.stop()
  })

  it('a dialog reopened right after Record payment prefills the new outstanding, never the old one', async () => {
    const client = newClient()
    const outstanding = backend('100')
    client.setQueryData(qk.money.receivables.order('o1'), '100')
    const dialog = screen(client, qk.money.receivables.order('o1'), outstanding.read)
    const save = saveWith(client, () => (outstanding.db.value = '0'), 'payment.record')
    await flush()
    outstanding.replyAll()
    await save.promise
    dialog.stop() // the dialog closes
    const reopened = screen(client, qk.money.receivables.order('o1'), outstanding.read)
    expect(reopened.data()).toBe('0')
    reopened.stop()
  })

  it('money nobody is watching is dropped: the next screen waits for the new figure instead of painting the old one', async () => {
    const client = newClient()
    const list = backend('100')
    client.setQueryData(qk.money.receivables.list(), '100') // Receivables was visited earlier; nobody shows it now
    await run(client, 'payment.record')
    list.db.value = '60'
    const later = screen(client, qk.money.receivables.list(), list.read)
    expect(later.data()).toBeUndefined()
    list.replyAll()
    await flush()
    expect(later.data()).toBe('60')
    expect(later.shown).not.toContain('100')
    later.stop()
  })

  it('offline: a paused money read does not hold the save', async () => {
    const client = newClient()
    const balance = backend('100')
    client.setQueryData(qk.money.receivables.list(), '100')
    const s = screen(client, qk.money.receivables.list(), balance.read)
    onlineManager.setOnline(false)
    await expect(run(client, 'payment.record')).resolves.toBeUndefined()
    expect(client.getQueryState(qk.money.receivables.list())).toMatchObject({ isInvalidated: true, fetchStatus: 'paused' })
    s.stop()
  })

  it('a money read that never answers holds the save for the ceiling at most', async () => {
    vi.useFakeTimers()
    const client = newClient()
    const balance = backend('100')
    client.setQueryData(qk.money.receivables.list(), '100')
    const s = screen(client, qk.money.receivables.list(), balance.read)
    let done = false
    void run(client, 'payment.record').then(() => (done = true))
    await vi.advanceTimersByTimeAsync(MONEY_WAIT_CEILING_MS - 1)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)
    s.stop()
  })
})

describe('ordering: a read sent before the write can never land as current', () => {
  it('a refetch already in flight on screen is replaced; its late reply does not overwrite the fresh one', async () => {
    const client = newClient()
    const header = backend('v1')
    client.setQueryData(qk.orders.part('o1', 'header'), 'v1')
    const s = screen(client, qk.orders.part('o1', 'header'), header.read)
    void s.observer.refetch() // sent before the write commits
    header.db.value = 'v2' // the write commits
    const saved = run(client, 'order.update', { wait: 'all' })
    expect(header.waiting).toBe(2)
    header.reply(1) // the fresh read answers first
    header.reply(0) // then the stale one, late
    await saved
    await flush()
    expect(s.data()).toBe('v2')
    s.stop()
  })

  it('a first load still in flight (no data yet) is restarted, so the pre-write rows never show', async () => {
    const client = newClient()
    const balance = backend('100')
    const s = screen(client, qk.orders.part('o1', 'money'), balance.read) // the order page opens; its money read is on its way
    expect(balance.waiting).toBe(1)
    balance.db.value = '60' // a payment commits meanwhile
    const saved = run(client, 'payment.record')
    expect(balance.waiting).toBe(2)
    balance.reply(0) // the stale first load answers
    await flush()
    expect(s.data()).toBeUndefined()
    balance.reply(0)
    await saved
    expect(s.data()).toBe('60')
    expect(s.shown).not.toContain('100')
    s.stop()
  })

  it('a prefetch in flight that nobody watches cannot land as fresh', async () => {
    const client = newClient()
    const items = backend('no price')
    void client.prefetchQuery({ queryKey: qk.rfqs.part('r1', 'items'), queryFn: items.read })
    items.db.value = 'priced'
    await run(client, 'quote.save')
    items.replyAll() // the prefetch answers with the rows from before the save
    await flush()
    const state = client.getQueryState(qk.rfqs.part('r1', 'items'))
    expect(state?.data === undefined || state.isInvalidated).toBe(true)
    const s = screen(client, qk.rfqs.part('r1', 'items'), items.read)
    items.replyAll()
    await flush()
    expect(s.data()).toBe('priced')
    s.stop()
  })

  it('two saves in a row: the later one wins whatever order the replies come in, and neither save returns on old money', async () => {
    const client = newClient()
    const balance = backend('100')
    client.setQueryData(qk.money.receivables.list(), '100')
    const s = screen(client, qk.money.receivables.list(), balance.read)
    const first = saveWith(client, () => (balance.db.value = '60'), 'payment.record')
    await flush()
    const second = saveWith(client, () => (balance.db.value = '30'), 'payment.record')
    await flush()
    // The first refetch (sees 60) was cancelled by the second save; the second (sees 30) is current. The first save must
    // not return in the gap between the cancel and the new read: the screen still shows 100.
    expect(balance.waiting).toBe(2)
    expect(first.state.done).toBe(false)
    expect(second.state.done).toBe(false)
    balance.reply(1) // 30 arrives first
    balance.reply(0) // the cancelled 60 arrives late and is ignored
    await Promise.all([first.promise, second.promise])
    await flush()
    expect(s.data()).toBe('30')
    s.stop()
  })

  it("wait: 'all' also holds when a later save replaces this save's refetch", async () => {
    const client = newClient()
    const today = backend('due')
    client.setQueryData(qk.today.board(), 'due')
    const s = screen(client, qk.today.board(), today.read)
    const first = saveWith(client, () => (today.db.value = 'chased'), 'today.chase', { wait: 'all' })
    await flush()
    const second = saveWith(client, () => (today.db.value = 'snoozed'), 'today.snooze')
    await flush()
    await flush()
    expect(first.state.done).toBe(false)
    today.reply(1)
    today.reply(0)
    await first.promise
    await second.promise
    expect(s.data()).toBe('snoozed')
    s.stop()
  })
})
