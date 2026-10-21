/*
 * The Issue quotation dialog's draft (HW-9). What was typed (prices, ticks, GST, lead times, the text fields) is kept in
 * sessionStorage per RFQ, so the browser's Back, a reload or a closed-by-accident dialog does not lose it: opening the
 * dialog again in the same tab brings it back. It is dropped when the quotation is issued or the dialog is closed on
 * purpose (Cancel, Esc). Per tab, so a second tab on the same RFQ starts from the database, not from this tab's typing.
 * Storage can be missing or refuse (private mode, quota): then there is simply no draft.
 */
export interface IssueDraft {
  prices: Record<string, number | null>
  included: Record<string, boolean>
  rateOf: Record<string, string>
  leads: Record<string, string>
  validUntil: string
  contactId: string
  delivery: string
  payment: string
  terms: string
}

const key = (rfqId: string) => `qtech.issueDraft.${rfqId}`

function store(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function readIssueDraft(rfqId: string): IssueDraft | null {
  try {
    const raw = store()?.getItem(key(rfqId))
    if (!raw) return null
    const d: unknown = JSON.parse(raw)
    if (!isRecord(d) || !isRecord(d.prices) || !isRecord(d.included) || !isRecord(d.rateOf) || !isRecord(d.leads)) return null
    const prices: Record<string, number | null> = {}
    for (const [id, v] of Object.entries(d.prices)) if (v === null || (typeof v === 'number' && Number.isFinite(v))) prices[id] = v
    const text = (v: unknown) => (typeof v === 'string' ? v : '')
    return {
      prices,
      included: Object.fromEntries(Object.entries(d.included).filter(([, v]) => typeof v === 'boolean')) as Record<string, boolean>,
      rateOf: Object.fromEntries(Object.entries(d.rateOf).filter(([, v]) => v === '18' || v === '0')) as Record<string, string>,
      leads: Object.fromEntries(Object.entries(d.leads).filter(([, v]) => typeof v === 'string')) as Record<string, string>,
      validUntil: text(d.validUntil),
      contactId: text(d.contactId),
      delivery: text(d.delivery),
      payment: text(d.payment),
      terms: text(d.terms),
    }
  } catch {
    return null
  }
}

export function writeIssueDraft(rfqId: string, draft: IssueDraft): void {
  try {
    store()?.setItem(key(rfqId), JSON.stringify(draft))
  } catch {
    // no storage: no draft
  }
}

export function clearIssueDraft(rfqId: string): void {
  try {
    store()?.removeItem(key(rfqId))
  } catch {
    // nothing to clear
  }
}

/** The defaults with the draft laid over them, item by item, for the items the RFQ still has. */
export function applyIssueDraft(defaults: IssueDraft, draft: IssueDraft | null, itemIds: readonly string[]): IssueDraft {
  if (!draft) return defaults
  const pick = <T>(base: Record<string, T>, over: Record<string, T>) =>
    Object.fromEntries(itemIds.map(id => [id, Object.prototype.hasOwnProperty.call(over, id) ? over[id] : base[id]])) as Record<string, T>
  return {
    prices: pick(defaults.prices, draft.prices),
    included: pick(defaults.included, draft.included),
    rateOf: pick(defaults.rateOf, draft.rateOf),
    leads: pick(defaults.leads, draft.leads),
    validUntil: draft.validUntil || defaults.validUntil,
    contactId: draft.contactId,
    delivery: draft.delivery,
    payment: draft.payment,
    terms: draft.terms,
  }
}
