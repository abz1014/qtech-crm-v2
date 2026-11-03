import { DEFAULT_VISIT_TYPE, isVisitType, type VisitType } from '@/features/orders/lib/visit'

/*
 * Several visits per order (migration 0130). A visit has a type, a date (no time of day), one engineer, a few words of notes and a done
 * date. The order keeps the next open visit as its planned date and the last done one as its done date (the database does that).
 */
export interface VisitRow {
  id: string
  orderId: string
  type: VisitType
  /** YYYY-MM-DD, or null while not planned. */
  on: string | null
  engineerId: string | null
  engineerName: string | null
  notes: string | null
  /** YYYY-MM-DD, or null while not done. */
  doneOn: string | null
}

/** What the visit form holds. Empty strings mean "not set". */
export interface VisitDraft {
  type: VisitType
  on: string
  engineerId: string
  notes: string
}

export const NOTES_MAX = 2000

export const emptyDraft = (): VisitDraft => ({ type: DEFAULT_VISIT_TYPE, on: '', engineerId: '', notes: '' })

export const draftOf = (v: VisitRow): VisitDraft => ({ type: v.type, on: v.on ?? '', engineerId: v.engineerId ?? '', notes: v.notes ?? '' })

export const draftChanged = (a: VisitDraft, b: VisitDraft): boolean => a.type !== b.type || a.on !== b.on || a.engineerId !== b.engineerId || a.notes.trim() !== b.notes.trim()

/** The columns a draft writes. */
export function draftPatch(d: VisitDraft) {
  return { visit_type: d.type, visit_on: d.on || null, engineer_id: d.engineerId || null, notes: d.notes.trim() || null }
}

/** The database row as the screen holds it. An unknown type (it cannot happen: a check constraint) falls back to the default. */
export function toVisit(
  r: { id: string; order_id: string; visit_type: string; visit_on: string | null; engineer_id: string | null; notes: string | null; done_on: string | null },
  names: ReadonlyMap<string, string>,
): VisitRow {
  return {
    id: r.id,
    orderId: r.order_id,
    type: isVisitType(r.visit_type) ? r.visit_type : DEFAULT_VISIT_TYPE,
    on: r.visit_on,
    engineerId: r.engineer_id,
    engineerName: r.engineer_id ? (names.get(r.engineer_id) ?? null) : null,
    notes: r.notes,
    doneOn: r.done_on,
  }
}

/** Oldest first; a visit with no date goes last. */
export function sortVisits(rows: readonly VisitRow[]): VisitRow[] {
  return [...rows].sort((a, b) => (a.on ?? '9999-12-31').localeCompare(b.on ?? '9999-12-31') || a.id.localeCompare(b.id))
}

export type VisitState = 'done' | 'late' | 'planned' | 'unplanned'

export function visitState(v: VisitRow, today: string): VisitState {
  if (v.doneOn) return 'done'
  if (!v.on) return 'unplanned'
  return v.on < today ? 'late' : 'planned'
}

export const VISIT_STATE_LABEL: Record<VisitState, string> = { done: 'Done', late: 'Late', planned: 'Planned', unplanned: 'No date yet' }

/**
 * Who may change a visit (the database says the same, 0130): admin and sales any visit; an engineer one that is theirs, or one with no
 * engineer on an order they are on.
 */
export function canEditVisit(v: VisitRow, who: { role: string; id: string }, onOrder: boolean): boolean {
  if (who.role === 'admin' || who.role === 'sales') return true
  if (who.role !== 'engineer') return false
  return v.engineerId === who.id || (v.engineerId === null && onOrder)
}
