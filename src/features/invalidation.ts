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
  'rfq.float': { companyId: string }
  'rfq.setFloated': { rfqId: string }
  'quote.save': { rfqId: string }
  'inquiry.cantQuote': { rfqId: string }
  'inquiry.chase': { rfqId: string }
  'rfq.markBidSent': { rfqId: string }
  'rfq.close': { rfqId: string }
  'clarification.add': { rfqId: string }
  'clarification.ask': { rfqId: string }
  'clarification.answer': { rfqId: string }
  'clarification.withdraw': { rfqId: string }
  'clarification.relay': { rfqId: string }
  'attachment.add': { rfqId: string }
  'attachment.delete': { rfqId: string }
  /** R19: issuing a quotation (or attaching its PDF) changes the RFQ page, the board and Today (quoted_on is stamped). */
  'quotation.issue': { rfqId: string }
  'quotation.pdf': { rfqId: string }
  /** R11/R16: a chase stamp on Today (customer ask, supplier chase, goods chase, payment reminder) or taking it back. */
  'today.chase': Record<string, never>
  'today.snooze': Record<string, never>
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
  'category.save': () => [qk.settings.categories()],
  // Floating creates an RFQ (and inquiries): the RFQ lists, the customer's history and every supplier's activity change.
  'rfq.float': () => [qk.rfqs.all, qk.intake.all, qk.companies.all],
  // Floating or un-floating moves inquiries between shortlisted and sent: the RFQ and the suppliers' counts.
  'rfq.setFloated': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists(), qk.companies.all],
  // A price, a "can't quote" or a chase changes the RFQ page and the board's states, and the supplier's own counts.
  'quote.save': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists(), qk.companies.all, qk.intake.all],
  'inquiry.cantQuote': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists(), qk.companies.all, qk.intake.all],
  'inquiry.chase': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists(), qk.companies.all],
  // Bid sent, closed and re-opened only move the RFQ itself (and the board's lists).
  'rfq.markBidSent': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists()],
  'rfq.close': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists()],
  // Questions and their stamps change the RFQ page, its derived clarification state (header) and the board's chips.
  'clarification.add': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists()],
  'clarification.ask': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists()],
  'clarification.answer': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists()],
  'clarification.withdraw': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists()],
  'clarification.relay': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists()],
  // Files only change this RFQ's page (the list of files, the photos under answers, the signed links).
  'attachment.add': v => [qk.rfqs.detail(v.rfqId)],
  'attachment.delete': v => [qk.rfqs.detail(v.rfqId)],
  'quotation.issue': v => [qk.rfqs.detail(v.rfqId), qk.rfqs.lists(), qk.today.all, qk.companies.all],
  'quotation.pdf': v => [qk.rfqs.part(v.rfqId, 'quotations')],
  // A chase stamp changes the asked/chased fields the RFQ page, the board and the order screens read, and every Today read.
  'today.chase': () => [qk.today.all, qk.rfqs.all, qk.orders.all],
  // A snooze is read only by Today.
  'today.snooze': () => [qk.today.all],
}

/** The keys a write makes stale. Pure, so it can be tested without a QueryClient. */
export function keysFor<N extends WriteName>(name: N, vars: WriteVars[N]): Keys {
  return invalidates[name](vars)
}

/** Invalidate every key a write makes stale. Call from a mutation's onSuccess; returns when the refetches settle. */
export function invalidateAfter<N extends WriteName>(client: QueryClient, name: N, vars: WriteVars[N]): Promise<unknown> {
  return Promise.all(keysFor(name, vars).map(queryKey => client.invalidateQueries({ queryKey })))
}
