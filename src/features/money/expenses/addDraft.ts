// The Add expense draft (HW-23): what was typed in an open Add expense dialog, kept in this tab's sessionStorage so a reload (or a
// phone reloading the tab) brings the dialog back with the amount still there. Only while the dialog is open: closing it in any way
// (Save, Cancel, Discard, leaving the page) removes the draft, and sign-out forgets it too (src/lib/capture/forget.ts). One draft
// per opening context (plain, or from an order or a supplier order). Nothing here is sent anywhere.

export const EXPENSE_DRAFT_PREFIX = 'qtech.expenses.addDraft.'

export interface ExpenseDraft {
  amount?: number
  categoryId?: string
  paidOn?: string
  note?: string
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const storage = (): Store | null => {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export const expenseDraftKey = (orderId?: string | null, legId?: string | null) => `${EXPENSE_DRAFT_PREFIX}${orderId ?? ''}.${legId ?? ''}`

export function loadExpenseDraft(key: string, store: Store | null = storage()): ExpenseDraft | null {
  try {
    const raw = store?.getItem(key)
    if (!raw) return null
    const d = JSON.parse(raw) as ExpenseDraft
    if (!d || typeof d !== 'object') return null
    const out: ExpenseDraft = {}
    if (typeof d.amount === 'number' && Number.isFinite(d.amount)) out.amount = d.amount
    if (typeof d.categoryId === 'string' && d.categoryId) out.categoryId = d.categoryId
    if (typeof d.paidOn === 'string' && d.paidOn) out.paidOn = d.paidOn
    if (typeof d.note === 'string' && d.note.trim()) out.note = d.note
    return Object.keys(out).length ? out : null
  } catch {
    return null
  }
}

/** Keep what was typed; an empty draft removes the key. */
export function saveExpenseDraft(key: string, d: ExpenseDraft, store: Store | null = storage()): void {
  try {
    if (!store) return
    if (Object.values(d).some(v => v !== undefined && v !== '')) store.setItem(key, JSON.stringify(d))
    else store.removeItem(key)
  } catch {
    /* storage full or blocked: the form still works, it is just not kept */
  }
}

export function clearExpenseDraft(key: string, store: Store | null = storage()): void {
  try {
    store?.removeItem(key)
  } catch {
    /* nothing to clear */
  }
}
