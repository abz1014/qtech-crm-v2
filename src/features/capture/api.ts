import { PlainError } from '@/lib/errors/plainError'
import { requireSupabase } from '@/lib/supabase'

/* Capture's note reads and writes (R22): the notes text of an RFQ or an order. */

export async function setRfqNotes(rfqId: string, notes: string | null): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('rfqs').update({ notes }).eq('id', rfqId)
  if (error) throw error
}

export async function setOrderNotes(orderId: string, notes: string | null): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('orders').update({ notes }).eq('id', orderId)
  if (error) throw error
}

/** Raised when a note could not be added because someone else kept changing the same notes. Nothing was written. */
export const NOTES_CHANGED = 'Someone else changed these notes at the same moment. Nothing was lost: try again.'

/**
 * Add to the notes of an order or an RFQ without overwriting what someone else saved in between. The notes are one text column,
 * so two people saving at once (read, add a line, write) would lose one of the lines. There is no migration: the write is
 * conditional on the row's `updated_at` as last read (a trigger moves it on every change), and when another save got in first the
 * row matches nothing, so the notes are read again and the line is added to the fresh text. One retry, then a plain message.
 * `build` gets the current notes and returns the whole new text; `before` is what was there when the write went through (for Undo).
 */
export async function appendNotesSafely(table: 'orders' | 'rfqs', id: string, build: (current: string | null) => string): Promise<{ before: string | null; after: string }> {
  const db = requireSupabase()
  for (let attempt = 0; attempt < 2; attempt++) {
    const read = await db.from(table).select('notes, updated_at').eq('id', id).maybeSingle()
    if (read.error) throw read.error
    const row = read.data as { notes: string | null; updated_at: string } | null
    if (!row) throw new PlainError('That job could not be found.')
    const after = build(row.notes ?? null)
    const write = await db.from(table).update({ notes: after }).eq('id', id).eq('updated_at', row.updated_at).select('id')
    if (write.error) throw write.error
    if ((write.data ?? []).length > 0) return { before: row.notes ?? null, after }
  }
  throw new PlainError(NOTES_CHANGED)
}
