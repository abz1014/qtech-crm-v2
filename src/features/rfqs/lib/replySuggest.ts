// R07 + R08: turns what the reply parser found into suggestions on a supplier's reply row. Pure.
//
// The parser (replyParse.ts) never commits and never assumes a currency. This module decides what the row offers:
//  - the row has ONE currency, so it is the one most offers name, else the supplier's pre-filled currency;
//  - an offer that names no currency takes the row's currency (and says so);
//  - an offer in a different currency is not selectable (the row cannot hold two; enter it separately);
//  - an offer the parser is unsure of is highlighted for checking: low confidence, ambiguous separator, matched by position;
//  - a regret becomes a "can't quote" with the reason chosen from the kind of regret.
// Nothing here writes. "Accept" in the screen turns the selected suggestions into a ReplyDraft and saves it.

import type { CantQuoteReason } from './cantQuote'
import type { ParsedReply, RegretKind, ReplyItemRef, ReplyOffer } from './replyParse'
import type { ReplyDraft } from './replySave'

export interface SuggestItem extends ReplyItemRef {
  /** 1-based number on the RFQ. */
  number: number
}

export interface Suggestion {
  /** Stable key for the checkbox. */
  key: string
  itemId: string | null
  itemNumber: number | null
  unitPrice: number | null
  /** The model the supplier offers when it is not the one asked for (a replacement). */
  offeredPn: string | null
  /** The currency this price will be saved in (the offer's own, else the row's). */
  currency: string
  /** Where the currency came from: the reply text, or the supplier's pre-fill. */
  currencyFrom: 'reply' | 'supplier'
  leadTimeText: string | null
  inStock: boolean | null
  confidence: 'high' | 'medium' | 'low'
  /** Why the engineer should look at this offer before accepting. Empty: nothing to check. */
  check: string[]
  /** Can be accepted. False: no item, no price, another currency, or the item already has an offer above. */
  selectable: boolean
  /** Why it cannot be accepted. */
  blocked: string | null
  snippet: string
}

export interface RegretSuggestion {
  reason: CantQuoteReason
}

export interface DeclinedSuggestion {
  itemId: string
  itemNumber: number
  reason: CantQuoteReason
}

export interface SuggestionSet {
  suggestions: Suggestion[]
  /** The row's currency for these offers. */
  currency: string
  regret: RegretSuggestion | null
  declined: DeclinedSuggestion[]
  /** The reply only asks something: nothing to accept. */
  question: string | null
  /** Nothing usable was found in the text. */
  nothingFound: boolean
}

/** The stored "can't quote" key (lib/cantQuote.ts) for the kind of regret the parser saw. */
export function reasonForRegret(kind: RegretKind | null): CantQuoteReason {
  switch (kind) {
    case 'not_handled':
      return 'no_brand'
    case 'discontinued':
      return 'discontinued'
    case 'unavailable':
      return 'cant_source_in_time'
    default:
      return 'other'
  }
}

function checksFor(o: ReplyOffer): string[] {
  const out: string[] = []
  if (o.confidence === 'low') out.push('Low confidence: check the price and the item')
  if (o.flags.includes('ambiguous_separator')) out.push('The figure could be read two ways (1.234 or 1,234): check it')
  if (o.flags.includes('match_by_position')) out.push('Matched to the item by its position only: check it is the right item')
  if (o.flags.includes('multiple_prices')) out.push('More than one price on this line: check this is the unit price')
  if (o.flags.includes('derived_from_total')) out.push('Worked out from a total: check the unit price')
  if (o.offeredPn) out.push(`The supplier offers ${o.offeredPn} instead of the item asked for: check it will do`)
  return out
}

export function suggestFromReply(parsed: ParsedReply, items: readonly SuggestItem[], fallbackCurrency: string): SuggestionSet {
  const numberOf = new Map(items.map(i => [i.id, i.number]))

  // The row's currency: the one most offers name, else the supplier's pre-fill.
  const counts = new Map<string, number>()
  for (const o of parsed.offers) if (o.currency && o.unitPrice !== null) counts.set(o.currency, (counts.get(o.currency) ?? 0) + 1)
  let currency = fallbackCurrency
  let best = 0
  for (const [c, n] of counts) {
    if (n > best) {
      best = n
      currency = c
    }
  }

  const taken = new Set<string>()
  const suggestions: Suggestion[] = parsed.offers.map((o, i) => {
    const itemNumber = o.rfqItemId ? (numberOf.get(o.rfqItemId) ?? null) : null
    let blocked: string | null = null
    if (!o.rfqItemId || itemNumber === null) blocked = 'No matching item: enter this one by hand'
    else if (o.unitPrice === null) blocked = o.flags.includes('ambiguous_separator') ? 'The figure could be read two ways (1.234 or 1,234): enter it by hand' : 'No price found on this line'
    else if (!o.currency && !currency) blocked = 'No currency stated: pick the supplier’s currency above first'
    else if (o.currency && currency && o.currency !== currency) blocked = `${o.currency} price: this row is in ${currency}, enter it separately`
    else if (taken.has(o.rfqItemId)) blocked = 'Another price above already covers this item'
    if (!blocked && o.rfqItemId) taken.add(o.rfqItemId)
    return {
      key: `${i}:${o.rfqItemId ?? 'none'}`,
      itemId: o.rfqItemId,
      itemNumber,
      unitPrice: o.unitPrice,
      offeredPn: o.offeredPn,
      currency: o.currency ?? currency,
      currencyFrom: o.currency ? 'reply' : 'supplier',
      leadTimeText: o.leadTimeText,
      inStock: o.inStock,
      confidence: o.confidence,
      check: checksFor(o),
      selectable: blocked === null,
      blocked,
      snippet: o.snippet,
    }
  })

  const declined = parsed.declined
    .map(d => ({ itemId: d.rfqItemId, itemNumber: numberOf.get(d.rfqItemId) ?? 0, reason: reasonForRegret(d.kind) }))
    .filter(d => d.itemNumber > 0)
  const regret = parsed.regret && suggestions.every(s => !s.selectable) ? { reason: reasonForRegret(parsed.regretKind) } : null
  const question = parsed.question ? (parsed.questionSnippet ?? '') : null
  return { suggestions, currency, regret, declined, question, nothingFound: suggestions.length === 0 && !regret && declined.length === 0 && question === null }
}

/** The row's draft after accepting the selected suggestions. Currency, prices, and lead time and stock when the row had none. */
export function draftFromSuggestions(base: ReplyDraft, set: SuggestionSet, selectedKeys: ReadonlySet<string>): ReplyDraft {
  const chosen = set.suggestions.filter(s => s.selectable && selectedKeys.has(s.key) && s.itemId && s.unitPrice !== null)
  if (chosen.length === 0) return base
  const prices = { ...base.prices }
  for (const s of chosen) prices[s.itemId as string] = s.unitPrice
  const stocks = new Set(chosen.map(s => s.inStock).filter((v): v is boolean => v !== null))
  return {
    currency: set.currency,
    prices,
    leadTime: base.leadTime.trim() || (chosen.find(s => s.leadTimeText)?.leadTimeText ?? ''),
    inStock: base.inStock ?? (stocks.size === 1 ? [...stocks][0] : null),
  }
}
