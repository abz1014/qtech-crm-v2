// The new-RFQ draft (UX audit 2026-10-19, S1 and recommendation 16): what the person has typed or pasted on New RFQ, kept on THIS
// device as they go, so a tap on a tab, a reload or a closed tab does not throw the pasted items away. One draft per person
// (`qtech.rfqs.intakeDraft.<person id>`) in localStorage, like the Capture store's other device-only data; kept for 7 days, like a
// captured item; removed once its RFQ is saved, when the person chooses Start new, and on sign-out (src/lib/capture/forget.ts,
// security review L-5). Nothing here is sent anywhere. Pure functions over a Storage, so it is tested without a browser.
//
// A draft belongs to one RFQ id (the id the RFQ will be saved under). A form never writes over, or removes, a draft for another id
// (review of ux/rfqs, item 1): that is only done by the person's own choice (Start new). With nobody signed in nothing is kept.

import type { DraftItem } from './intakeModel'

export const INTAKE_DRAFT_PREFIX = 'qtech.rfqs.intakeDraft.'
export const INTAKE_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface IntakeDraftCompany {
  id: string
  name: string
  country: string | null
  city: string | null
  role: string | null
}

export interface IntakeDraft {
  v: 1
  savedAt: number
  /** The id the RFQ will be saved under, kept so a save whose reply was lost can only ever find the same RFQ. */
  rfqId: string
  company: IntakeDraftCompany | null
  siteId: string | null
  contactId: string | null
  dueOn: string
  customerRef: string
  isPriority: boolean
  items: DraftItem[]
  /** Supplier ticks changed by hand, and the suppliers added by hand. */
  overrides: Record<string, boolean>
  manual: { id: string; name: string }[]
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const storage = (): Store | null => {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export const intakeDraftKey = (userId: string | null) => `${INTAKE_DRAFT_PREFIX}${userId ?? 'anon'}`

/** There is something worth keeping: a company, an item with a description, or a customer reference. */
export function draftHasContent(d: Pick<IntakeDraft, 'company' | 'items' | 'customerRef'>): boolean {
  return Boolean(d.company) || d.items.some(i => i.description.trim() !== '') || d.customerRef.trim() !== ''
}

export function loadIntakeDraft(userId: string | null, now = Date.now(), store: Store | null = storage()): IntakeDraft | null {
  if (!store) return null
  try {
    const raw = store.getItem(intakeDraftKey(userId))
    if (!raw) return null
    const d = JSON.parse(raw) as IntakeDraft
    if (d?.v !== 1 || !Array.isArray(d.items) || typeof d.savedAt !== 'number') return null
    if (now - d.savedAt > INTAKE_DRAFT_TTL_MS) {
      store.removeItem(intakeDraftKey(userId))
      return null
    }
    return draftHasContent(d) ? d : null
  } catch {
    return null
  }
}

/** What saveIntakeDraft did: kept it, removed this form's own draft (the form is empty), or left another RFQ's draft alone. */
export type DraftWrite = 'kept' | 'removed' | 'other' | 'none'

/**
 * Keep this form's draft. An empty form removes its own draft, so an abandoned blank screen never offers one. A draft for another
 * RFQ (started in another tab, or not yet answered with Continue or Start new) is never overwritten or removed: returns 'other'.
 * With nobody signed in (userId null, e.g. while signing out) nothing is written: 'none'.
 */
export function saveIntakeDraft(userId: string | null, d: IntakeDraft, store: Store | null = storage(), now = Date.now()): DraftWrite {
  if (!store || !userId) return 'none'
  try {
    const kept = loadIntakeDraft(userId, now, store)
    if (kept && kept.rfqId !== d.rfqId) return 'other'
    if (draftHasContent(d)) {
      store.setItem(intakeDraftKey(userId), JSON.stringify(d))
      return 'kept'
    }
    store.removeItem(intakeDraftKey(userId))
    return 'removed'
  } catch {
    /* storage full or blocked: the form still works, it is just not kept */
    return 'none'
  }
}

/**
 * Forget the draft. With `rfqId`, only when the kept draft is that RFQ's (a save clears its own draft, never one started since in
 * another tab); without it, whatever is kept (the person chose Start new on the draft they were shown).
 */
export function clearIntakeDraft(userId: string | null, rfqId?: string, store: Store | null = storage()): void {
  try {
    if (!store) return
    if (rfqId !== undefined) {
      const raw = store.getItem(intakeDraftKey(userId))
      if (!raw) return
      let kept: { rfqId?: unknown } | null = null
      try {
        kept = JSON.parse(raw) as { rfqId?: unknown }
      } catch {
        kept = null
      }
      if (kept?.rfqId !== rfqId) return
    }
    store.removeItem(intakeDraftKey(userId))
  } catch {
    /* nothing to clear */
  }
}

/** "10:42 today", "yesterday", "3 days ago" (Karachi days): when a kept draft was last changed. */
export function draftAge(savedAt: number, now = Date.now()): string {
  const day = (t: number) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
  const days = Math.round((Date.parse(day(now)) - Date.parse(day(savedAt))) / 86_400_000)
  if (days <= 0) return `${new Date(savedAt).toLocaleTimeString('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: false })} today`
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

/** "Indus Textile Mills, 4 items": what the draft holds, for the Continue offer and the leave warning. */
export function draftSummary(d: Pick<IntakeDraft, 'company' | 'items'>): string {
  const n = d.items.filter(i => i.description.trim() !== '').length
  const items = n === 0 ? 'no items yet' : `${n} ${n === 1 ? 'item' : 'items'}`
  return d.company ? `${d.company.name}, ${items}` : `No company yet, ${items}`
}
