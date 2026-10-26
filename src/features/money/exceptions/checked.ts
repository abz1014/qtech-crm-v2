import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReconciliationException } from '@/lib/reconciliation'
import { requireSupabase, unwrap } from '@/lib/supabase'
import { qk } from '@/features/queryKeys'
import { sha256Hex } from '@/features/money/exceptions/sha256'

/*
 * "Mark as checked" for Mistakes to fix (P6-C, 0102 checked_findings). An admin looked at a finding and it is fine (a deliberate
 * overpayment, a cost known to be higher). Until now that lived in this browser's localStorage, so it was per person and per
 * device. Now one row per (finding key, digest of its message) in the database, for everyone: when the figures behind a finding
 * change, its message changes, the digest no longer matches and the finding comes back by itself. Un-tick deletes the row.
 * What an earlier version kept in localStorage is carried over once, for the findings that are still there, then removed.
 */
const LEGACY_PREFIX = 'qtech.checked.'

export interface CheckedRow {
  finding_key: string
  message_hash: string
}

/** The pair a tick is stored under: the finding's key and the digest of its message. */
export const findingRow = (e: Pick<ReconciliationException, 'key' | 'message'>): CheckedRow => ({ finding_key: e.key, message_hash: sha256Hex(e.message) })

const idOf = (r: CheckedRow): string => `${r.finding_key}\u0000${r.message_hash}`

export const checkedSet = (rows: readonly CheckedRow[]): ReadonlySet<string> => new Set(rows.map(idOf))

export const isChecked = (set: ReadonlySet<string>, e: Pick<ReconciliationException, 'key' | 'message'>): boolean => set.has(idOf(findingRow(e)))

/** The findings nobody has marked as checked. While the ticks are not loaded (null) every finding counts, so nothing is hidden by mistake. */
export const openFindings = (set: ReadonlySet<string> | null, list: readonly ReconciliationException[]): ReconciliationException[] =>
  set ? list.filter(e => !isChecked(set, e)) : [...list]

// ------------------------------------------------------------------ the database

const KEY = [...qk.money.all, 'checked-findings'] as const

async function listChecked(): Promise<CheckedRow[]> {
  const db = requireSupabase()
  return unwrap(await db.from('checked_findings').select('finding_key, message_hash')) ?? []
}

async function addChecked(rows: readonly CheckedRow[]): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('checked_findings').upsert([...rows], { onConflict: 'finding_key,message_hash', ignoreDuplicates: true })
  if (error) throw error
}

async function removeChecked(row: CheckedRow): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('checked_findings').delete().eq('finding_key', row.finding_key).eq('message_hash', row.message_hash)
  if (error) throw error
}

/** Every tick for the company (admin only: `enabled` is the admin check; row security answers for anyone else). */
export function useCheckedSet(enabled = true): ReadonlySet<string> | null {
  const q = useQuery({ queryKey: KEY, queryFn: listChecked, enabled, staleTime: 30_000 })
  return useMemo(() => (q.data ? checkedSet(q.data) : null), [q.data])
}

/**
 * The findings still open, the ones marked as checked, and `mark`. A tick shows at once (the list is updated before the request
 * returns) and is put back if the request fails.
 */
export function useUnchecked(
  list: readonly ReconciliationException[],
  enabled = true,
): { open: ReconciliationException[]; checked: ReconciliationException[]; mark: (e: ReconciliationException, checked: boolean) => void; error: string | null } {
  const client = useQueryClient()
  const set = useCheckedSet(enabled)
  const mutation = useMutation({
    mutationFn: async ({ row, on }: { row: CheckedRow; on: boolean }) => (on ? addChecked([row]) : removeChecked(row)),
    onMutate: async ({ row, on }) => {
      await client.cancelQueries({ queryKey: KEY })
      const before = client.getQueryData<CheckedRow[]>(KEY) ?? []
      const next = on ? [...before.filter(r => idOf(r) !== idOf(row)), row] : before.filter(r => idOf(r) !== idOf(row))
      client.setQueryData(KEY, next)
      return { before }
    },
    onError: (_e, _v, ctx) => {
      if (ctx) client.setQueryData(KEY, ctx.before)
    },
    onSettled: () => void client.invalidateQueries({ queryKey: KEY }),
  })
  const mark = useCallback((e: ReconciliationException, on: boolean) => mutation.mutate({ row: findingRow(e), on }), [mutation])
  const open: ReconciliationException[] = []
  const checked: ReconciliationException[] = []
  for (const e of list) (set && isChecked(set, e) ? checked : open).push(e)
  return { open, checked, mark, error: mutation.isError ? 'That tick was not saved. Try again.' : null }
}

// ------------------------------------------------------------------ what this browser kept before

/** The ticks an earlier version kept in this browser for this person: [storage key, finding key, message]. */
function legacyTicks(userId: string): { storageKey: string; key: string; message: string }[] {
  const out: { storageKey: string; key: string; message: string }[] = []
  try {
    const prefix = `${LEGACY_PREFIX}${userId}.`
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (!k || !k.startsWith(prefix) || window.localStorage.getItem(k) !== '1') continue
      // the stored key is "<prefix><finding key>.<message>"; a finding key holds no dot, a message may
      const rest = k.slice(prefix.length)
      const dot = rest.indexOf('.')
      if (dot < 1) continue
      out.push({ storageKey: k, key: rest.slice(0, dot), message: rest.slice(dot + 1) })
    }
  } catch {
    /* storage missing or refused: nothing to carry over */
  }
  return out
}

/**
 * Once per page load, for an admin: ticks kept in this browser for findings that are still listed are saved to the database and
 * removed from the browser. Ticks for findings that are gone are dropped quietly.
 */
export function useCarryOverLocalTicks(userId: string | null, list: readonly ReconciliationException[], enabled: boolean): void {
  const client = useQueryClient()
  const done = useRef(false)
  useEffect(() => {
    if (!enabled || !userId || done.current || list.length === 0) return
    done.current = true
    const ticks = legacyTicks(userId)
    if (ticks.length === 0) return
    const rows = list.filter(e => ticks.some(t => t.key === e.key && t.message === e.message)).map(findingRow)
    const clear = () => {
      try {
        for (const t of ticks) window.localStorage.removeItem(t.storageKey)
      } catch {
        /* nothing to remove */
      }
    }
    if (rows.length === 0) {
      clear()
      return
    }
    addChecked(rows).then(
      () => {
        clear()
        void client.invalidateQueries({ queryKey: KEY })
      },
      () => {
        done.current = false // the browser keeps its ticks; try again next time
      },
    )
  }, [enabled, userId, list, client])
}
