// The one main action on the RFQ page (owner decision 2026-10-19, step 2: one green button per screen, chosen by state), and the
// one "stage" chip that says where the RFQ stands. Pure, so the rules are tested without a screen.

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
  if (quotationSent(i)) return 'won'
  if (i.hasPrices) return 'issue'
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

export interface StageChip {
  label: string
  tone: 'warning' | 'info' | 'success' | 'neutral'
}

/** The stage chip in the header, in the same words as the board's Next step. */
export function stageChip(i: Pick<PrimaryInput, 'outcome' | 'hasOrder' | 'sourcingState' | 'bidState' | 'quotationCount'>): StageChip {
  if (i.outcome === 'won' || i.hasOrder) return { label: 'Won', tone: 'success' }
  if (i.outcome === 'closed') return { label: 'Closed', tone: 'neutral' }
  if (i.bidState === 'quotation_expired') return { label: 'Quotation expired', tone: 'warning' }
  if (quotationSent(i)) return { label: 'Quotation sent', tone: 'neutral' }
  switch (i.sourcingState) {
    case 'covered':
      return { label: 'Ready to quote', tone: 'success' }
    case 'floated_awaiting':
    case 'partly_covered':
      return { label: 'Waiting for prices', tone: 'info' }
    default:
      return { label: 'Needs suppliers', tone: 'warning' }
  }
}
