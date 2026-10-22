// The one main action on the RFQ page (owner decision 2026-10-19, step 2: one green button per screen, chosen by state), and the
// one "stage" chip that says where the RFQ stands (a registry key: the words and tone come from src/lib/status.ts). Pure, so the
// rules are tested without a screen.

export type RfqPrimary = 'ask' | 'issue' | 'won' | 'chase' | 'none'

export interface PrimaryInput {
  outcome: 'open' | 'won' | 'closed' | string
  /** A live (not cancelled) order exists: the page links to it instead. */
  hasOrder: boolean
  sourcingState: string | null | undefined
  bidState: string | null | undefined
  /** At least one supplier price is on the RFQ. */
  hasPrices: boolean
  /** Quotations issued so far. */
  quotationCount: number
  itemCount: number
  /** Suppliers who were asked and still owe a price (canChaseInquiry). */
  chaseable: number
  /**
   * The person sees prices (admin, sales). False for an engineer (owner decision 2026-10-22): Issue quotation and Mark won are
   * never their green button; they get the ask or the chase, else none. Default true.
   */
  prices?: boolean
}

/** A quotation exists: one was issued, or the quotation was marked sent without a PDF (a verbal one). */
export function quotationSent(i: Pick<PrimaryInput, 'bidState' | 'quotationCount'>): boolean {
  return i.quotationCount > 0 || (Boolean(i.bidState) && i.bidState !== 'to_bid')
}

/**
 * Which action is the green one:
 *   quotation sent                              Mark won
 *   a supplier price is in                      Issue quotation
 *   nobody asked yet, or nobody could offer     Ask suppliers
 *   asked, waiting, a supplier can be chased    the chase (the green button is the chase in the side column)
 *   otherwise (closed, won, no items)           none: no green button
 */
export function primaryAction(i: PrimaryInput): RfqPrimary {
  if (i.outcome !== 'open' || i.hasOrder || i.itemCount === 0) return 'none'
  const prices = i.prices ?? true
  if (prices && quotationSent(i)) return 'won'
  if (prices && i.hasPrices) return 'issue'
  if (!prices && (quotationSent(i) || i.hasPrices)) return i.chaseable > 0 ? 'chase' : 'none'
  if (i.sourcingState === 'not_floated' || i.sourcingState === 'no_offer_anywhere' || !i.sourcingState) return 'ask'
  if (i.chaseable > 0) return 'chase'
  return 'none'
}

export interface NextStepInput {
  primary: RfqPrimary
  sourcingState: string | null | undefined
  bidState: string | null | undefined
  itemCount: number
  /** Suppliers asked who have not replied (no price, no "cannot quote"). */
  awaiting: number
}

/**
 * The sentence in the "Next step" box under the title (coordinator decision 2026-10-20, the pattern ux/orders built: every detail
 * page shows its one green action in a labelled Next step box). What to do now, or what the RFQ is waiting for when there is
 * nothing to do. A closed or won RFQ says so with its date, reason or order (RfqHeaderBlock).
 */
export function nextStepSentence(i: NextStepInput): string {
  const n = i.awaiting
  const who = `${n} ${n === 1 ? 'supplier' : 'suppliers'}`
  switch (i.primary) {
    case 'ask':
      return i.sourcingState === 'no_offer_anywhere' ? 'No supplier asked could quote. Ask other suppliers.' : 'Nobody has been asked for prices yet.'
    case 'issue':
      return 'Supplier prices are in. Send the customer a quotation.'
    case 'won':
      return i.bidState === 'quotation_expired'
        ? 'The quotation has expired. Mark it won if they ordered, or revise it from More.'
        : 'Quotation sent. Mark it won when the customer orders.'
    case 'chase':
      return `Waiting for prices from ${who}. Chase them.`
    default:
      if (i.itemCount === 0) return 'No items yet. Add what the customer asked for under Items.'
      if (n > 0) return `Waiting for prices from ${who}. Chased recently: nothing to do until they reply.`
      return 'Nothing to do now.'
  }
}

/** The registry key of the header's stage chip: an `rfq-stage` while open, else the outcome. Words and tones live in src/lib/status.ts. */
export type StageKey =
  | 'rfq-stage:suppliers'
  | 'rfq-stage:prices'
  | 'rfq-stage:ready'
  | 'rfq-stage:sent'
  | 'rfq-stage:expired'
  | 'rfq-outcome:won'
  | 'rfq-outcome:closed'

/** The stage chip in the header, as a registry key, so it reads in the same words and tone as the board's Next step. */
export function stageKey(i: Pick<PrimaryInput, 'outcome' | 'hasOrder' | 'sourcingState' | 'bidState' | 'quotationCount'>): StageKey {
  if (i.outcome === 'won' || i.hasOrder) return 'rfq-outcome:won'
  if (i.outcome === 'closed') return 'rfq-outcome:closed'
  if (i.bidState === 'quotation_expired') return 'rfq-stage:expired'
  if (quotationSent(i)) return 'rfq-stage:sent'
  switch (i.sourcingState) {
    case 'covered':
      return 'rfq-stage:ready'
    case 'floated_awaiting':
    case 'partly_covered':
      return 'rfq-stage:prices'
    default:
      return 'rfq-stage:suppliers'
  }
}
