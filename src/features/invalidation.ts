import { notifyManager, partialMatchKey, type Query, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { qk } from '@/features/queryKeys'

/*
 * The invalidation map (R01): for every write, the keys that go stale. A mutation hook does not
 * decide this itself; it names its write here, so "what refreshes after a merge" is one line you
 * can read, review and test, instead of a guess scattered through components.
 *
 * Rules:
 *  - Name the write after the verb and the thing: 'company.create', 'company.merge'.
 *  - Prefer a prefix (a whole detail, a whole area) over a list of leaves; over-refreshing is cheap,
 *    a stale screen is not.
 *  - A write that moves rows between areas (a merge moves RFQs and orders) lists every area it touches.
 *  - Realtime and cross-tab changes are out of scope; the map is for this tab's own writes.
 *
 * Timing (audit 2, performance #1): a save no longer waits for every screen to read itself again. `invalidateAfter` marks
 * every key stale at once and refetches what is on screen in the background, so Save, Snooze or Issue returns when the
 * server confirms. Two exceptions, both about money:
 *  - A money figure on screen (`isMoneyKey`) is read again before the save returns, so a dialog never closes onto, and
 *    never reopens with, the balance from before the payment.
 *  - A money read no screen is watching is dropped, so the next screen that opens on it waits for the new figure.
 * A caller that goes straight on to use fresh non-money data passes `{ wait: 'all' }` (the old behaviour).
 */
export interface WriteVars {
  'company.create': { id: string }
  'company.update': { id: string }
  'company.merge': { keepId: string; dropId: string }
  'site.add': { companyId: string }
  'contact.add': { companyId: string }
  'site.update': { companyId: string }
  'site.remove': { companyId: string }
  'contact.update': { companyId: string }
  'contact.remove': { companyId: string }
  'brand.unlink': { companyId: string }
  'brand.link': { companyId: string }
  'brand.create': Record<string, never>
  'team.create': Record<string, never>
  'team.reset-password': Record<string, never>
  'team.set-role': Record<string, never>
  'team.set-job-title': Record<string, never>
  /** users.phone, written straight to the users row (own row, or any row for an admin). */
  'team.set-phone': Record<string, never>
  'team.deactivate': Record<string, never>
  'team.reactivate': Record<string, never>
  'company-profile.update': Record<string, never>
  /** M06: setting, clearing or copying targets. Today's own tile reads the same numbers. */
  'target.save': Record<string, never>
  /** M13: any change to a category (name, group, paid via, order, active, add, delete). */
  'category.save': Record<string, never>
  /** 0084: two categories merged (every expense of one moved into the other). */
  'category.merge': Record<string, never>
  /** M12: a bank tick (or untick) of a payment, an expense or an FBR deposit group. */
  'bank.tick': Record<string, never>
  /** M10: closing a month, or reopening it. */
  'month.close': { month: string }
  'month.reopen': { month: string }
  'rfq.float': { companyId: string }
  'rfq.setFloated': { rfqId: string }
  'fx.set': Record<string, never>
  'item.add': { rfqId: string }
  'inquiry.add': { rfqId: string }
  'quote.save': { rfqId: string }
  'inquiry.cantQuote': { rfqId: string }
  'inquiry.chase': { rfqId: string }
  'rfq.markBidSent': { rfqId: string }
  'rfq.close': { rfqId: string }
  /** R22: Capture appends to, or restores, an RFQ's notes. */
  'rfq.notes': { rfqId: string }
  'clarification.add': { rfqId: string }
  'clarification.ask': { rfqId: string }
  'clarification.answer': { rfqId: string }
  'clarification.withdraw': { rfqId: string }
  'clarification.relay': { rfqId: string }
  'attachment.add': { rfqId: string }
  'attachment.delete': { rfqId: string }
  /** R22: files on an order (the Files panel on the order page, Capture's attach to order). */
  'order.files': { orderId: string }
  /** R19: issuing a quotation (or attaching its PDF) changes the RFQ page, the board and Today (quoted_on is stamped). */
  'quotation.issue': { rfqId: string }
  'quotation.pdf': { rfqId: string }
  /** O01: converting an RFQ creates an order and legs, and the RFQ becomes won. */
  'order.convert': { rfqId: string }
  /** O02: a repeat order creates an order, its lines and legs; the customer's history and Today change. */
  'order.repeat': { companyId: string }
  /** O03: any edit on the order page (items, legs, commissioning, notes). */
  'order.update': { orderId: string }
  /** O03: cancelling (or taking the cancel back) also moves the RFQ between won and open and the company role. */
  'order.cancel': { orderId: string }
  /** O07: issuing a supplier PO stamps the leg placed, writes the prices back to the order lines and moves Today's place-PO rule. */
  'po.issue': { orderId: string }
  /** O07: attaching a PO's PDF changes only the PO chips and View PO. */
  'po.pdf': { orderId: string }
  /** R11/R16: a chase stamp on Today (customer ask, supplier chase, goods chase, payment reminder) or taking it back. */
  'today.chase': Record<string, never>
  'today.snooze': Record<string, never>
  /** M03/M11: an expense added, edited, deleted, or a receipt photo added or taken off. */
  'expense.save': Record<string, never>
  'costs.save': { orderId: string }
  'expense.receipt': { expenseId: string }
  'recurring.save': Record<string, never>
  'recurring.record': Record<string, never>
  /** M01: an invoice created or edited, a step stamped (TCS, PSID, deposited) or taken back, a receipt added or removed. */
  'invoice.create': Record<string, never>
  'invoice.update': { invoiceId: string }
  'invoice.stamp': Record<string, never>
  'invoice.receipt': { invoiceId: string }
  /** M02: a payment recorded against an order. */
  'payment.record': { orderId: string }
  /** M09: a payment reminder stamped on the invoices of an order (or taken back): Receivables' "Last reminder" and Today's payment item. */
  'payment.remind': Record<string, never>
  /** 0073: a payment voided, corrected (void plus a new row) or restored (Undo of either). */
  'payment.void': { orderId: string }
  'payment.correct': { orderId: string }
  'payment.restore': { orderId: string }
}

export type WriteName = keyof WriteVars

type Keys = readonly QueryKey[]

// 0073: a void, a correction or its Undo moves every figure built on payments: balances and "who owes us", the bank tick,
// month-end, margins and exceptions (all under money), the order page and board, Today (overdue items and the target tile), the
// targets grid in Settings, and a customer's money on the company page.
const paymentChange = (): Keys => [qk.money.all, qk.orders.all, qk.today.all, qk.settings.targets(), qk.companies.all]

export const invalidates: { [N in WriteName]: (v: WriteVars[N]) => Keys } = {
  // A new company appears in every list and search. Its own page does not exist in the cache yet.
  'company.create': () => [qk.companies.lists()],
  'company.update': v => [qk.companies.lists(), qk.companies.detail(v.id)],
  // The dropped company is gone; everything that pointed at it now points at the kept one.
  'company.merge': v => [qk.companies.all, qk.rfqs.all, qk.orders.all, qk.companies.detail(v.keepId), qk.today.all, qk.intake.all, qk.memory.all, qk.purchaseOrders.all, qk.money.all],
  // Adding a site changes the page only (the roster does not show sites). A contact changes the page AND the roster: the Companies
  // search matches contact names and phone numbers (2026-10-20), so a contact just saved must be findable at once.
  'site.add': v => [qk.companies.detail(v.companyId)],
  'contact.add': v => [qk.companies.detail(v.companyId), qk.companies.lists()],
  'site.update': v => [qk.companies.detail(v.companyId)],
  'site.remove': v => [qk.companies.detail(v.companyId)],
  'contact.update': v => [qk.companies.detail(v.companyId), qk.companies.lists()],
  'contact.remove': v => [qk.companies.detail(v.companyId), qk.companies.lists()],
  // Dropping the last brand can end a supplier's role, so the roster refreshes too.
  'brand.unlink': v => [qk.companies.detail(v.companyId), qk.companies.lists()],
  // Carrying a brand makes the company a supplier, so the roster's role column can change too.
  'brand.link': v => [qk.companies.detail(v.companyId), qk.companies.lists()],
  'brand.create': () => [qk.brands.all],
  // Every change to a person is read back from the admin-users function, the source of truth for the list.
  'team.create': () => [qk.settings.team(), qk.onboarding.all],
  // A new password changes nothing the list shows; refreshing it anyway is cheap and keeps the rule simple.
  'team.reset-password': () => [qk.settings.team()],
  'team.set-role': () => [qk.settings.team()],
  'team.set-job-title': () => [qk.settings.team()],
  'team.set-phone': () => [qk.settings.team(), qk.settings.myDetails(), qk.onboarding.all],
  'team.deactivate': () => [qk.settings.team(), qk.onboarding.all],
  'team.reactivate': () => [qk.settings.team(), qk.onboarding.all],
  // The default payment terms move every due date for orders with no terms of their own.
  'company-profile.update': () => [qk.settings.profile(), qk.money.receivables.all, qk.today.all],
  'target.save': () => [qk.settings.targets(), qk.today.target()],
  // Money's own category list (new expense forms, the Expenses list) reads the same rows, so it goes stale too.
  'category.save': () => [qk.settings.categories(), qk.money.categories(), qk.money.groups()],
  // A merge re-files expenses: every expense list, the reports that split by category and the recurring templates change.
  'category.merge': () => [qk.settings.categories(), qk.money.categories(), qk.money.groups(), qk.money.expenses.all, qk.money.monthEnd.all, qk.money.recurring.all],
  // A tick changes only the bank screen (the month-end checklist counts arrive with M10 and read through this prefix too).
  'bank.tick': () => [qk.money.bank.all, qk.money.monthEnd.all],
  // Closing or reopening a month changes the checklist and closed list; a lock also changes what the expense and bank screens may write.
  'month.close': () => [qk.money.monthEnd.all, qk.money.bank.all, qk.money.expenses.all, qk.today.all],
  'month.reopen': () => [qk.money.monthEnd.all, qk.money.bank.all, qk.money.expenses.all, qk.today.all],
  // Floating creates an RFQ (and inquiries): the RFQ lists, the customer's history and every supplier's activity change.
  'rfq.float': () => [qk.rfqs.all, qk.intake.all, qk.companies.all, qk.onboarding.all],
  // Floating or un-floating moves inquiries between shortlisted and sent: the RFQ and the suppliers' counts.
  'rfq.setFloated': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists(), qk.companies.all],
  // A rate entered by hand changes every comparison (today's rate), so the RFQ pages refresh with the rate lists.
  // The Mark won dialog's ranking compares in PKR at today's rate, so it goes stale too.
  'fx.set': () => [qk.fx.all, qk.rfqs.all, qk.orders.rankedAll()],
  // A new item changes the page, the board's counts and the coverage.
  'item.add': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists(), qk.orders.rankedFor(v.rfqId)],
  // Asking another supplier adds an inquiry: the page, the board and the supplier's own counts.
  // Today offers "ask more suppliers" from a supplier-chase item, so its list changes too.
  'inquiry.add': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists(), qk.companies.all, qk.today.all],
  // A price, a "can't quote" or a chase changes the RFQ page and the board's states, and the supplier's own counts.
  // The Mark won and Split line dialogs read the ranked quotes under the orders root, so they go stale too.
  'quote.save': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists(), qk.companies.all, qk.intake.all, qk.orders.rankedFor(v.rfqId)],
  'inquiry.cantQuote': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists(), qk.companies.all, qk.intake.all, qk.orders.rankedFor(v.rfqId)],
  'inquiry.chase': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists(), qk.companies.all],
  // Bid sent only moves the RFQ itself (and the board's lists).
  'rfq.markBidSent': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists()],
  // Closing also takes the RFQ off Today (Today itself offers "Close as no reply") and changes its outcome in the customer's history.
  // Capture's RFQ list (qk.rfqs.capture, outside lists()) must stop offering a closed RFQ, so the whole RFQ root.
  'rfq.close': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.all, qk.today.all, qk.companies.all],
  'rfq.notes': v => [qk.rfqs.detail(v.rfqId)],
  // Questions and their stamps change the RFQ page, its derived clarification state (header) and the board's chips.
  'clarification.add': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists()],
  'clarification.ask': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists()],
  'clarification.answer': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists()],
  'clarification.withdraw': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists()],
  'clarification.relay': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists()],
  // Files only change this RFQ's page (the list of files, the photos under answers, the signed links).
  'attachment.add': v => [qk.rfqs.detail(v.rfqId)],
  'attachment.delete': v => [qk.rfqs.detail(v.rfqId)],
  'order.files': v => [qk.orders.part(v.orderId, 'files')],
  // Issuing also writes the quoted selling price, which the ranked quotes return as sell_net.
  'quotation.issue': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists(), qk.today.all, qk.companies.all, qk.orders.rankedFor(v.rfqId)],
  'quotation.pdf': v => [qk.rfqs.part(v.rfqId, 'quotations')],
  // A new order changes the RFQ (won), every list that shows orders or states, Today (place PO, goods late) and the customer's history.
  'order.convert': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.all, qk.orders.all, qk.today.all, qk.companies.all, qk.onboarding.all],
  'order.repeat': v => [qk.orders.all, qk.today.all, qk.companies.all, qk.companies.detail(v.companyId), qk.onboarding.all],
  // The customer's history shows each order's lifecycle and goods state, so it goes stale too.
  // An item or leg edit moves the supplier-price inputs of the Margin panel and the margins list (audit 2, performance §2.1).
  'order.update': v => [qk.orders.detail(v.orderId), qk.orders.lists(), qk.today.all, qk.companies.all, qk.money.orderCosts(v.orderId), qk.money.margins(), qk.onboarding.all],
  'order.cancel': v => [qk.orders.detail(v.orderId), qk.orders.lists(), qk.rfqs.all, qk.today.all, qk.companies.all, qk.money.receivables.all],
  // An issued PO changes the order page (leg placed, prices written back), the order lists, Today and every PO read.
  // The prices written back are the Margin panel's supplier-price inputs.
  'po.issue': v => [qk.orders.detail(v.orderId), qk.orders.lists(), qk.today.all, qk.purchaseOrders.all, qk.companies.all, qk.money.orderCosts(v.orderId), qk.money.margins()],
  'po.pdf': v => [qk.orders.part(v.orderId, 'pos'), qk.purchaseOrders.all],
  // A chase stamp changes the asked/chased fields the RFQ page, the board and the order screens read, and every Today read.
  // A supplier chase moves the supplier's activity counts; a payment reminder moves the invoice reminder fields Money shows.
  'today.chase': () => [qk.today.all, qk.rfqs.all, qk.orders.all, qk.companies.all, qk.money.invoices.all, qk.money.receivables.all],
  // A snooze is read only by Today.
  'today.snooze': () => [qk.today.all],
  // An expense changes every month list, the recent-use tally, the order's own cost panel and Today (a recurring item leaves it).
  'expense.save': () => [qk.money.expenses.all, qk.money.bank.all, qk.money.recurring.all, qk.money.margins(), qk.money.exceptions(), [...qk.money.all, 'order-costs'] as const, qk.orders.all, qk.today.all],
  // The expected cost or the costs-complete mark changes the order's margin, the margins list and the exceptions.
  'costs.save': v => [qk.money.orderCosts(v.orderId), qk.money.margins(), qk.money.exceptions(), qk.orders.detail(v.orderId), qk.today.all],
  'expense.receipt': v => [qk.money.expenses.receipts(v.expenseId)],
  'recurring.save': () => [qk.money.recurring.all, qk.today.all],
  // Recording makes an expense (and a recurring item leaves Today).
  'recurring.record': () => [qk.money.expenses.all, qk.money.bank.all, qk.money.recurring.all, qk.today.all],
  // A new invoice moves the register, the order's invoicing state and balance, receivables and Today (a payment reminder can become due).
  'invoice.create': () => [qk.money.invoices.all, qk.money.bank.all, qk.money.receivables.all, qk.orders.all, qk.today.all, qk.onboarding.all],
  'invoice.update': v => [qk.money.invoices.register(), qk.money.bank.all, qk.money.invoices.detail(v.invoiceId), qk.money.receivables.all, qk.orders.all, qk.today.all],
  // Stamps move the register's tracks and the FBR / TCS items on Today.
  'invoice.stamp': () => [qk.money.invoices.all, qk.money.bank.all, qk.today.all],
  // One receipt covers a whole PSID group (audit T1): every invoice of the group is stamped, so all invoice reads go stale.
  'invoice.receipt': () => [qk.money.invoices.all, qk.today.all],
  // A payment moves balances (receivables, the order page's panel, its payment chip) and Today's overdue items.
  'payment.record': v => [qk.money.receivables.all, qk.money.bank.all, qk.money.receivables.payments(v.orderId), qk.orders.all, qk.today.all],
  'payment.remind': () => [qk.money.receivables.all, qk.money.invoices.all, qk.today.all],
  'payment.void': paymentChange,
  'payment.correct': paymentChange,
  'payment.restore': paymentChange,
}

/** The keys a write makes stale. Pure, so it can be tested without a QueryClient. */
export function keysFor<N extends WriteName>(name: N, vars: WriteVars[N]): Keys {
  return invalidates[name](vars)
}

/**
 * A read that shows money: everything under the money root, and the money slice of an order or a company page.
 * After a write these are never shown from before it (see `invalidateAfter`).
 */
export function isMoneyKey(key: QueryKey): boolean {
  const [root, kind, , part] = key
  if (root === 'money') return true
  return (root === 'orders' || root === 'companies') && kind === 'detail' && part === 'money'
}

export interface InvalidateOptions {
  /**
   * What the returned promise waits for.
   *  - 'money' (the default): the money reads on screen. Everything else refreshes in the background.
   *  - 'all': every read on screen (the old behaviour). For a caller that goes straight on to use fresh data, such as a
   *    double-tap guard held until the list it reads has caught up.
   */
  wait?: 'money' | 'all'
}

/** The longest a save waits for its on-screen money reads. A read that is slower than this is left to finish in the background. */
export const MONEY_WAIT_CEILING_MS = 10_000

/** Drops a key that another key of the same write already covers (a prefix), so no query is refetched twice. */
function withoutCovered(keys: Keys): Keys {
  return keys.filter((key, i) => !keys.some((other, j) => j !== i && partialMatchKey(key, other) && (!partialMatchKey(other, key) || j < i)))
}

/**
 * Resolves once none of `queries` is still fetching for a screen (or after the ceiling). Offline (paused) counts as done.
 * Each check runs after the notification batch has flushed, not inside the cache event: a later save cancels this save's
 * refetch and starts its own in one step, and the gap between the two must not count as done (the screen still shows the
 * figure from before both saves).
 */
function settled(client: QueryClient, queries: Query[]): Promise<void> {
  const cache = client.getQueryCache()
  const busy = () => queries.some(q => cache.get(q.queryHash) === q && q.isActive() && q.state.fetchStatus === 'fetching')
  if (!busy()) return Promise.resolve()
  return new Promise(resolve => {
    let finished = false
    const done = () => {
      if (finished) return
      finished = true
      unsubscribe()
      clearTimeout(timer)
      resolve()
    }
    const unsubscribe = cache.subscribe(() =>
      notifyManager.schedule(() => {
        if (!busy()) done()
      }),
    )
    const timer = setTimeout(done, MONEY_WAIT_CEILING_MS)
  })
}

/**
 * Invalidate every key a write makes stale. Call from a mutation's onSuccess, after the server has confirmed the write.
 *
 *  1. A read already in flight may have left before the write committed. It is cancelled (its state put back), so its
 *     rows can never land as current; the screens that need it fetch again below.
 *  2. Money no screen is watching is dropped from the cache.
 *  3. Every key is marked stale and every query on screen refetches, in the background.
 *  4. The promise resolves once the on-screen money reads have their new figures (`wait: 'all'`: once every on-screen
 *     read has). Usually there are none, and it resolves at once.
 */
export function invalidateAfter<N extends WriteName>(client: QueryClient, name: N, vars: WriteVars[N], options: InvalidateOptions = {}): Promise<void> {
  const keys = withoutCovered(keysFor(name, vars))
  const cache = client.getQueryCache()
  const matched = new Set<Query>()
  for (const queryKey of keys) for (const q of cache.findAll({ queryKey })) matched.add(q)
  const money = [...matched].filter(q => isMoneyKey(q.queryKey))
  const refetched = notifyManager.batch(() => {
    for (const q of matched) if (q.state.fetchStatus === 'fetching') void q.cancel({ revert: true })
    const unwatched = money.filter(q => q.getObserversCount() === 0)
    if (unwatched.length > 0) client.removeQueries({ predicate: q => unwatched.includes(q) })
    return Promise.all(keys.map(queryKey => client.invalidateQueries({ queryKey })))
  })
  // `settled` as well as the refetch promises: a later save that cancels one of these refetches resolves its promise early.
  if (options.wait === 'all') return Promise.all([refetched, settled(client, [...matched].filter(q => q.isActive()))]).then(() => undefined)
  return settled(client, money.filter(q => q.isActive()))
}
