import { daysBetween, dueTextFromNotes, parseLegacyDate } from '../lib/dates'
import { legacyId } from '../lib/ids'
import { clean, normName, num, str } from '../lib/text'
import type { Row } from '../lib/text'
import type { NewRow } from '../types'
import type { CompanyBook, CustomerRef } from './companies'
import type { Ctx } from './context'

// I03: RFQs, items, supplier inquiries, quote lines. DATA_MODEL section 7, "rfqs rules".

export interface RfqOutput {
  rfqs: NewRow[]
  rfq_items: NewRow[]
  supplier_inquiries: NewRow[]
  supplier_quote_lines: NewRow[]
  /** old rfq id -> new id, for the RFQs that were imported */
  rfqIds: Map<string, string>
  /** old rfq id -> its company and site, so an order without a client can take the RFQ's */
  rfqRefs: Map<string, CustomerRef>
}

const STALE_DAYS = 180

const LOSS_REASONS: Record<string, string> = {
  price: 'price',
  competitor_won: 'competitor',
  poor_follow_up: 'we_were_late',
  other: 'other',
}

/** The customer's own RFQ number, as opposed to one Q-Tech's old system made up. */
export function looksCustomerIssued(rfqNumber: string): boolean {
  return !/^(rfq|qt|qtech)[-_ ]?\d{1,6}$/i.test(rfqNumber)
}

const NO_OFFER_PHRASE = /(could\s*n[o']?t find|couldn'?t find|no offer|not able to (find|source)|unable to (find|source)|can'?t source|no quote from)/i

function stamp(row: Row): string | null {
  const p = parseLegacyDate(row['created_at'])
  const raw = clean(row['created_at'])
  return p.status === 'ok' && raw !== null ? raw : null
}

export function transformRfqs(ctx: Ctx, book: CompanyBook): RfqOutput {
  const rfqs: NewRow[] = []
  const rfqIds = new Map<string, string>()
  const rfqRefs = new Map<string, CustomerRef>()
  const seenRef = new Set<string>()

  const dateOf = (r: Row, col: string, table: string, label: string, flags: string[]): string | null => {
    const p = parseLegacyDate(r[col])
    if (p.status === 'invalid') {
      flags.push('invalid_date')
      ctx.addReview('unparseable_dates', table, String(r['id']), label, `${col} = "${String(r[col])}"`)
    }
    return p.date
  }

  for (const r of ctx.rows('rfqs')) {
    const oldId = String(r['id'])
    const label = str(r, 'rfq_number') ?? str(r, 'company_name') ?? oldId
    const flags: string[] = []

    let ref: CustomerRef | null = null
    const clientId = str(r, 'client_id')
    if (clientId !== null && book.clients.has(clientId)) ref = book.clients.get(clientId)!
    else if (str(r, 'company_name') !== null) ref = book.byCustomerName(str(r, 'company_name')!)
    if (ref === null) {
      ctx.drop('rfqs', oldId, label, 'no client and no company name')
      continue
    }

    const status = str(r, 'status') ?? 'new'

    // received_on
    let received = dateOf(r, 'rfq_date', 'rfqs', label, flags)
    if (received === null) {
      received = parseLegacyDate(r['created_at']).date ?? ctx.opts.asOf
      flags.push('received_date_estimated')
    }

    // due_on: quote_deadline, else "Due: dd/mm/yyyy" in the notes
    let due = dateOf(r, 'quote_deadline', 'rfqs', label, flags)
    if (due === null) {
      const text = dueTextFromNotes(r['notes'])
      if (text !== null) {
        const p = parseLegacyDate(text)
        if (p.status === 'ok') {
          due = p.date
          flags.push('due_date_parsed')
        } else {
          flags.push('invalid_date')
          ctx.addReview('unparseable_dates', 'rfqs', oldId, label, `notes say "Due: ${text}"`)
        }
      }
    }
    if (due !== null && due < received) {
      flags.push('due_before_received')
      ctx.addReview('unparseable_dates', 'rfqs', oldId, label, `due ${due} is before received ${received}: check the year`)
    }

    // quoted_on
    let quoted = dateOf(r, 'quote_sent_date', 'rfqs', label, flags)
    if (quoted === null && (status === 'quoted' || status === 'converted')) {
      quoted = received
      flags.push('quoted_date_estimated')
    }

    // closed
    let closedOn: string | null = null
    let closeReason: string | null = null
    if (status === 'lost') {
      closedOn =
        parseLegacyDate(r['quote_sent_date']).date ??
        parseLegacyDate(r['quote_deadline']).date ??
        parseLegacyDate(r['rfq_date']).date ??
        parseLegacyDate(r['created_at']).date ??
        ctx.opts.asOf
      closeReason = LOSS_REASONS[(str(r, 'loss_reason') ?? '').toLowerCase()] ?? 'other'
      flags.push('closed_date_estimated')
    }

    // customer_ref
    let customerRef: string | null = null
    const number = str(r, 'rfq_number')
    if (number !== null && looksCustomerIssued(number)) {
      const key = `${ref.companyId}|${normName(number)}`
      if (seenRef.has(key)) flags.push('customer_ref_duplicate')
      else {
        seenRef.add(key)
        customerRef = number
      }
    }

    const owner = ctx.ownerFields(r['assigned_to'], flags)
    const id = legacyId('rfq', oldId)
    rfqIds.set(oldId, id)
    rfqRefs.set(oldId, ref)

    // Surfaced for manual tagging; never auto-classified.
    const notes = str(r, 'notes')
    if (notes !== null && NO_OFFER_PHRASE.test(notes)) {
      ctx.addReview('no_offer_phrases', 'rfqs', oldId, label, `notes: ${notes.slice(0, 200)}`)
    }
    if (quoted !== null && status !== 'lost' && status !== 'converted' && daysBetween(quoted, ctx.opts.asOf) > STALE_DAYS) {
      ctx.addReview('stale_rfqs', 'rfqs', oldId, label, `still open; quoted ${quoted}, ${daysBetween(quoted, ctx.opts.asOf)} days before ${ctx.opts.asOf}`)
    }

    rfqs.push({
      id,
      ...(stamp(r) ? { created_at: stamp(r) } : {}),
      company_id: ref.companyId,
      site_id: ref.siteId,
      contact_id: book.contactForRfq(ref, r, oldId),
      customer_ref: customerRef,
      received_on: received,
      due_on: due,
      owner_id: owner,
      is_priority: (str(r, 'priority') ?? '').toLowerCase() === 'high',
      quoted_on: quoted,
      closed_on: closedOn,
      close_reason: closeReason,
      close_note: status === 'lost' ? str(r, 'loss_notes') : null,
      notes,
      legacy_flags: [...new Set(flags)].sort(),
      legacy_source: { table: 'rfqs', row: r },
    })
  }

  // ------------------------------------------------------------------ items
  const rfq_items: NewRow[] = []
  const itemsByRfq = new Map<string, string[]>()
  const positions = new Map<string, number>()
  for (const li of ctx.rows('rfq_line_items')) {
    const oldId = String(li['id'])
    const rfqId = rfqIds.get(String(li['rfq_id']))
    if (!rfqId) {
      ctx.drop('rfq_line_items', oldId, str(li, 'specification') ?? oldId, 'its RFQ was not imported')
      continue
    }
    const flags: string[] = []
    const q = num(li['quantity'])
    if (q === null || q <= 0) flags.push('qty_defaulted')
    const pos = positions.get(rfqId) ?? 0
    positions.set(rfqId, pos + 1)
    const id = legacyId('rfq_item', oldId)
    itemsByRfq.set(rfqId, [...(itemsByRfq.get(rfqId) ?? []), id])
    rfq_items.push({
      id,
      ...(stamp(li) ? { created_at: stamp(li) } : {}),
      rfq_id: rfqId,
      position: pos,
      description: str(li, 'specification') ?? str(li, 'product_type') ?? 'Item (no description)',
      brand_id: null,
      family_id: book.family(str(li, 'product_type')),
      qty: q !== null && q > 0 ? q : 1,
      unit: null,
      gst_rate: 18,
      legacy_flags: flags,
      legacy_source: { table: 'rfq_line_items', row: li },
    })
  }

  // ------------------------------------------------------------------ supplier inquiries
  const supplier_inquiries: NewRow[] = []
  const inquiryIds = new Map<string, string>() // old inquiry id -> new id
  const inquiryByPair = new Map<string, NewRow>() // rfq|supplier -> row
  for (const si of ctx.rows('supplier_inquiries')) {
    const oldId = String(si['id'])
    const rfqId = rfqIds.get(String(si['rfq_id']))
    const supplier = book.vendors.get(String(si['vendor_id']))
    if (!rfqId || !supplier) {
      ctx.drop('supplier_inquiries', oldId, oldId, !rfqId ? 'its RFQ was not imported' : 'its vendor was not imported')
      continue
    }
    const flags: string[] = []
    const p = parseLegacyDate(si['sent_at'])
    if (p.status === 'invalid') {
      flags.push('invalid_date')
      ctx.addReview('unparseable_dates', 'supplier_inquiries', oldId, oldId, `sent_at = "${String(si['sent_at'])}"`)
    }
    const pair = `${rfqId}|${supplier}`
    const existing = inquiryByPair.get(pair)
    if (existing) {
      // One inquiry per (RFQ, supplier): keep the first, with the earliest send date.
      inquiryIds.set(oldId, String(existing['id']))
      const flagsOf = existing['legacy_flags'] as string[]
      if (!flagsOf.includes('inquiry_duplicate')) flagsOf.push('inquiry_duplicate')
      if (p.date !== null && (existing['sent_on'] === null || p.date < String(existing['sent_on']))) existing['sent_on'] = p.date
      const src = existing['legacy_source'] as { rows: Row[] }
      src.rows.push(si)
      ctx.addReview('dropped_rows', 'supplier_inquiries', oldId, oldId, 'merged into the earlier inquiry to the same supplier on this RFQ')
      continue
    }
    const id = legacyId('inquiry', oldId)
    inquiryIds.set(oldId, id)
    const row: NewRow = {
      id,
      ...(stamp(si) ? { created_at: stamp(si) } : {}),
      rfq_id: rfqId,
      supplier_id: supplier,
      sent_on: p.date,
      legacy_flags: flags,
      legacy_source: { table: 'supplier_inquiries', rows: [si] },
    }
    supplier_inquiries.push(row)
    inquiryByPair.set(pair, row)
  }

  // ------------------------------------------------------------------ quote lines
  const lineByKey = new Map<string, { row: NewRow; stamp: string }>()
  const quotes = [...ctx.rows('supplier_quotes')]
  for (const q of quotes) {
    const oldId = String(q['id'])
    const rfqId = rfqIds.get(String(q['rfq_id']))
    const label = `quote ${oldId}`
    if (!rfqId) {
      ctx.drop('supplier_quotes', oldId, label, 'its RFQ was not imported')
      continue
    }
    const items = itemsByRfq.get(rfqId) ?? []
    if (items.length === 0) {
      ctx.drop('supplier_quotes', oldId, label, 'its RFQ has no items to attach the price to')
      continue
    }
    const price = num(q['unit_price'])
    if (price === null || price <= 0) {
      ctx.drop('supplier_quotes', oldId, label, `unit_price is ${String(q['unit_price'])} (must be above zero)`)
      continue
    }

    const flags = ['currency_unverified']
    const supplier = book.vendors.get(String(q['vendor_id']))
    let inquiryId = inquiryIds.get(String(q['inquiry_id']))
    if (!inquiryId && supplier) inquiryId = (inquiryByPair.get(`${rfqId}|${supplier}`)?.['id'] as string | undefined) ?? undefined
    if (!inquiryId) {
      if (!supplier) {
        ctx.drop('supplier_quotes', oldId, label, 'its vendor was not imported')
        continue
      }
      inquiryId = legacyId('inquiry-for-quote', oldId)
      const row: NewRow = {
        id: inquiryId,
        rfq_id: rfqId,
        supplier_id: supplier,
        sent_on: null,
        legacy_flags: ['inquiry_created_for_quote'],
        legacy_source: { table: 'supplier_quotes', rows: [q] },
      }
      supplier_inquiries.push(row)
      inquiryByPair.set(`${rfqId}|${supplier}`, row)
    }

    if (items.length > 1) flags.push('item_guessed')
    const cur = (str(q, 'currency') ?? '').toUpperCase()
    let currency = cur
    if (!/^[A-Z]{3}$/.test(cur)) {
      currency = 'PKR'
      flags.push('currency_invalid')
    }
    const days = num(q['lead_time_days'])
    const itemId = items[0]!
    const key = `${inquiryId}|${itemId}`
    const ts = `${String(q['received_at'] ?? '')}|${String(q['created_at'] ?? '')}|${oldId}`
    const row: NewRow = {
      id: legacyId('quote_line', oldId),
      ...(stamp(q) ? { created_at: stamp(q) } : {}),
      inquiry_id: inquiryId,
      rfq_item_id: itemId,
      unit_price: price,
      currency,
      lead_time: days !== null && days > 0 ? `${days} days` : null,
      notes: str(q, 'notes'),
      legacy_flags: [...new Set(flags)].sort(),
      legacy_source: { table: 'supplier_quotes', row: q },
    }
    const prev = lineByKey.get(key)
    if (prev) {
      // One line per (inquiry, item). The most recent price wins; the other is listed.
      if (ts > prev.stamp) {
        ctx.drop('supplier_quotes', String((prev.row['legacy_source'] as { row: Row }).row['id']), label, 'replaced by a newer quote for the same supplier and item')
        lineByKey.set(key, { row, stamp: ts })
      } else {
        ctx.drop('supplier_quotes', oldId, label, 'replaced by a newer quote for the same supplier and item')
      }
    } else lineByKey.set(key, { row, stamp: ts })
  }
  const supplier_quote_lines = [...lineByKey.values()].map(v => v.row)

  return { rfqs, rfq_items, supplier_inquiries, supplier_quote_lines, rfqIds, rfqRefs }
}
