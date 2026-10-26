/*
 * Review imported (P2-B, owner decision 1b of 2026-10-22; migration 0096). Imported orders and invoices whose money or goods are
 * still open are looked at once by the owner and become LIVE ("Still open": they follow the normal rules and stay on To do) or
 * SETTLED ("Settled, keep as history": the open balance reads 0, an order's costs are marked complete). Pure rules only.
 */
export type ReviewState = 'to_review' | 'live' | 'settled'
export type ReviewKind = 'order' | 'invoice'

export interface ReviewItem {
  kind: ReviewKind
  id: string
  /** "ORD-0022" or "Invoice 145". */
  title: string
  company: string
  /** What the books say, in one line: "Not invoiced, PKR 1,541,442 from items". */
  facts: string
  state: ReviewState
  /** Orders: the receivable gross, for sorting the biggest first. */
  amount: number
}

export interface ReviewProgress {
  decided: number
  total: number
  left: number
}

/**
 * "n of N decided". The set that needed a decision is what is still to review, what the owner kept live, and what was settled in
 * this visit (earlier settled rows leave the page and were not counted by the server's own backfill, which also writes 'settled').
 */
export function reviewProgress(items: readonly Pick<ReviewItem, 'state'>[], settledHere: number): ReviewProgress {
  const left = items.filter(i => i.state === 'to_review').length
  const live = items.filter(i => i.state === 'live').length
  const decided = live + settledHere
  return { decided, total: left + decided, left }
}

/** The ones still to decide first, the biggest amount first inside each state, then the kept-open ones. */
export function sortReview<T extends Pick<ReviewItem, 'state' | 'amount' | 'title'>>(items: readonly T[]): T[] {
  const rank = (s: ReviewState) => (s === 'to_review' ? 0 : 1)
  return [...items].sort((a, b) => rank(a.state) - rank(b.state) || b.amount - a.amount || a.title.localeCompare(b.title))
}

// ------------------------------------------------------------------ linking invoices to their orders (link_imported_invoices)

export type Confidence = 'certain' | 'likely'

export interface Proposal {
  invoiceId: string
  orderId: string
  confidence: Confidence
  reasons: string[]
}

export const proposalKey = (p: Pick<Proposal, 'invoiceId' | 'orderId'>): string => `${p.invoiceId}|${p.orderId}`

/** What is shown: the proposals the owner has not turned down with "Not this". */
export const visibleProposals = <T extends Proposal>(list: readonly T[], rejected: ReadonlySet<string>): T[] => list.filter(p => !rejected.has(proposalKey(p)))

export interface ProposalCounts {
  certain: number
  likely: number
}

export const countProposals = (list: readonly Proposal[]): ProposalCounts => ({
  certain: list.filter(p => p.confidence === 'certain').length,
  likely: list.filter(p => p.confidence === 'likely').length,
})
