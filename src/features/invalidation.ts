import type { QueryClient, QueryKey } from '@tanstack/react-query'
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
  /** M12: a bank tick (or untick) of a payment, an expense or an FBR deposit group. */
  'bank.tick': Record<string, never>
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
}

export type WriteName = keyof WriteVars

type Keys = readonly QueryKey[]

export const invalidates: { [N in WriteName]: (v: WriteVars[N]) => Keys } = {
  // A new company appears in every list and search. Its own page does not exist in the cache yet.
  'company.create': () => [qk.companies.lists()],
  'company.update': v => [qk.companies.lists(), qk.companies.detail(v.id)],
  // The dropped company is gone; everything that pointed at it now points at the kept one.
  'company.merge': v => [qk.companies.all, qk.rfqs.all, qk.orders.all, qk.companies.detail(v.keepId)],
  // Adding a site or contact changes the page, and the roster does not show them, so only the detail.
  'site.add': v => [qk.companies.detail(v.companyId)],
  'contact.add': v => [qk.companies.detail(v.companyId)],
  'site.update': v => [qk.companies.detail(v.companyId)],
  'site.remove': v => [qk.companies.detail(v.companyId)],
  'contact.update': v => [qk.companies.detail(v.companyId)],
  'contact.remove': v => [qk.companies.detail(v.companyId)],
  // Dropping the last brand can end a supplier's role, so the roster refreshes too.
  'brand.unlink': v => [qk.companies.detail(v.companyId), qk.companies.lists()],
  // Carrying a brand makes the company a supplier, so the roster's role column can change too.
  'brand.link': v => [qk.companies.detail(v.companyId), qk.companies.lists()],
  'brand.create': () => [qk.brands.all],
  // Every change to a person is read back from the admin-users function, the source of truth for the list.
  'team.create': () => [qk.settings.team()],
  // A new password changes nothing the list shows; refreshing it anyway is cheap and keeps the rule simple.
  'team.reset-password': () => [qk.settings.team()],
  'team.set-role': () => [qk.settings.team()],
  'team.set-job-title': () => [qk.settings.team()],
  'team.set-phone': () => [qk.settings.team(), qk.settings.myDetails()],
  'team.deactivate': () => [qk.settings.team()],
  'team.reactivate': () => [qk.settings.team()],
  'company-profile.update': () => [qk.settings.profile()],
  'target.save': () => [qk.settings.targets(), qk.today.target()],
  // Money's own category list (new expense forms, the Expenses list) reads the same rows, so it goes stale too.
  'category.save': () => [qk.settings.categories(), qk.money.categories()],
  // A tick changes only the bank screen (the month-end checklist counts arrive with M10 and read through this prefix too).
  'bank.tick': () => [qk.money.bank.all],
  // Floating creates an RFQ (and inquiries): the RFQ lists, the customer's history and every supplier's activity change.
  'rfq.float': () => [qk.rfqs.all, qk.intake.all, qk.companies.all],
  // Floating or un-floating moves inquiries between shortlisted and sent: the RFQ and the suppliers' counts.
  'rfq.setFloated': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists(), qk.companies.all],
  // A rate entered by hand changes every comparison (today's rate), so the RFQ pages refresh with the rate lists.
  'fx.set': () => [qk.fx.all, qk.rfqs.all],
  // A new item changes the page, the board's counts and the coverage.
  'item.add': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists()],
  // Asking another supplier adds an inquiry: the page, the board and the supplier's own counts.
  'inquiry.add': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists(), qk.companies.all],
  // A price, a "can't quote" or a chase changes the RFQ page and the board's states, and the supplier's own counts.
  'quote.save': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists(), qk.companies.all, qk.intake.all],
  'inquiry.cantQuote': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists(), qk.companies.all, qk.intake.all],
  'inquiry.chase': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists(), qk.companies.all],
  // Bid sent, closed and re-opened only move the RFQ itself (and the board's lists).
  'rfq.markBidSent': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists()],
  'rfq.close': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists()],
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
  'quotation.issue': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists(), qk.today.all, qk.companies.all],
  'quotation.pdf': v => [qk.rfqs.part(v.rfqId, 'quotations')],
  // A new order changes the RFQ (won), every list that shows orders or states, Today (place PO, goods late) and the customer's history.
  'order.convert': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.all, qk.orders.all, qk.today.all, qk.companies.all],
  'order.repeat': v => [qk.orders.all, qk.today.all, qk.companies.all, qk.companies.detail(v.companyId)],
  'order.update': v => [qk.orders.detail(v.orderId), qk.orders.lists(), qk.today.all],
  'order.cancel': v => [qk.orders.detail(v.orderId), qk.orders.lists(), qk.rfqs.all, qk.today.all, qk.companies.all],
  // An issued PO changes the order page (leg placed, prices written back), the order lists, Today and every PO read.
  'po.issue': v => [qk.orders.detail(v.orderId), qk.orders.lists(), qk.today.all, qk.purchaseOrders.all],
  'po.pdf': v => [qk.orders.part(v.orderId, 'pos'), qk.purchaseOrders.all],
  // A chase stamp changes the asked/chased fields the RFQ page, the board and the order screens read, and every Today read.
  'today.chase': () => [qk.today.all, qk.rfqs.all, qk.orders.all],
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
  'invoice.create': () => [qk.money.invoices.all, qk.money.bank.all, qk.money.receivables.all, qk.orders.all, qk.today.all],
  'invoice.update': v => [qk.money.invoices.register(), qk.money.bank.all, qk.money.invoices.detail(v.invoiceId), qk.money.receivables.all, qk.orders.all, qk.today.all],
  // Stamps move the register's tracks and the FBR / TCS items on Today.
  'invoice.stamp': () => [qk.money.invoices.all, qk.money.bank.all, qk.today.all],
  'invoice.receipt': v => [qk.money.invoices.receipts(v.invoiceId), qk.money.invoices.detail(v.invoiceId), qk.money.invoices.register(), qk.today.all],
  // A payment moves balances (receivables, the order page's panel, its payment chip) and Today's overdue items.
  'payment.record': v => [qk.money.receivables.all, qk.money.bank.all, qk.money.receivables.payments(v.orderId), qk.orders.all, qk.today.all],
}

/** The keys a write makes stale. Pure, so it can be tested without a QueryClient. */
export function keysFor<N extends WriteName>(name: N, vars: WriteVars[N]): Keys {
  return invalidates[name](vars)
}

/** Invalidate every key a write makes stale. Call from a mutation's onSuccess; returns when the refetches settle. */
export function invalidateAfter<N extends WriteName>(client: QueryClient, name: N, vars: WriteVars[N]): Promise<unknown> {
  return Promise.all(keysFor(name, vars).map(queryKey => client.invalidateQueries({ queryKey })))
}
