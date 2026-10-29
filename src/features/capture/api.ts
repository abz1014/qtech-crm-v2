import { PlainError } from '@/lib/errors/plainError'
import { requireSupabase } from '@/lib/supabase'

/* Capture's note reads and writes (R22): the notes text of an RFQ or an order. */

/** Raised when a note could not be added because someone else kept changing the same notes. Nothing was written. */
export const NOTES_CHANGED = 'Someone else changed these notes at the same moment. Nothing was lost: try again.'

/**
 * Change the notes of an order or an RFQ without overwriting what someone else saved in between. The notes are one text column,
 * so two people saving at once (read, change, write) would lose one change. There is no migration: the write is conditional on
 * the row's `updated_at` as last read (a trigger moves it on every change), and when another save got in first the row matches
 * nothing, so the notes are read again and `build` is applied to the fresh text. One retry, then a plain message.
 * `build` gets the current notes and returns the whole new text (or null for none); it may throw a PlainError to stop.
 * Returns what was there when the write went through (`before`), what was written (`after`) and the row's new `updated_at`.
 */
export async function changeNotesSafely(
  table: 'orders' | 'rfqs',
  id: string,
  build: (current: string | null) => string | null,
): Promise<{ before: string | null; after: string | null; updatedAt: string | null }> {
  const db = requireSupabase()
  for (let attempt = 0; attempt < 2; attempt++) {
    const read = await db.from(table).select('notes, updated_at').eq('id', id).maybeSingle()
    if (read.error) throw read.error
    const row = read.data as { notes: string | null; updated_at: string } | null
    if (!row) throw new PlainError('That job could not be found.')
    const after = build(row.notes ?? null)
    const write = await db.from(table).update({ notes: after }).eq('id', id).eq('updated_at', row.updated_at).select('id, updated_at')
    if (write.error) throw write.error
    const written = (write.data ?? []) as { updated_at?: string }[]
    if (written.length > 0) return { before: row.notes ?? null, after, updatedAt: written[0].updated_at ?? null }
  }
  throw new PlainError(NOTES_CHANGED)
}

/** Add to the notes (see changeNotesSafely): `build` returns the whole new text. */
export async function appendNotesSafely(table: 'orders' | 'rfqs', id: string, build: (current: string | null) => string) {
  const out = await changeNotesSafely(table, id, build)
  return { before: out.before, after: out.after as string, updatedAt: out.updatedAt }
}

export const CANNOT_UNDO_NOTE = 'The note could not be taken back: the notes were changed after you saved it. Nothing was changed.'

/**
 * Take back the note a save appended. `before` and `after` are the notes around that save. If the notes are still exactly `after`
 * (updated_at unchanged, which the conditional write checks) they go back to `before`; if someone changed them since, only our own
 * appended text is removed from the fresh notes, and if that text is no longer there the undo stops with a plain message.
 */
export function undoAppendedNote(table: 'orders' | 'rfqs', id: string, saved: { before: string | null; after: string }) {
  const entry = saved.after.slice(saved.before?.trim() ? saved.before.trimEnd().length : 0)
  return changeNotesSafely(table, id, current => {
    if (current === saved.after) return saved.before
    const at = current === null ? -1 : current.lastIndexOf(entry)
    if (current === null || at < 0) throw new PlainError(CANNOT_UNDO_NOTE)
    const left = (current.slice(0, at) + current.slice(at + entry.length)).trimEnd()
    return left.trim() ? left : null
  })
}
