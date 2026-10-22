import { fetchAll, requireSupabase, unwrap } from '@/lib/supabase'
import { orderRef } from '@/lib/refs'
import { lookupLabels } from '@/features/money/lookupLabels'

/*
 * Engineers' "I paid" claims and the office cash box (0087). Claims: an engineer adds their own and reads only their own (row
 * security); the admin reads all, approves (approve_expense_claim writes the expense) or rejects. A pending claim is in no total.
 * Cash in hand: admin only.
 */
export const CLAIM_BUCKET = 'claim-receipts'

export type ClaimStatus = 'pending' | 'approved' | 'rejected'
export type PaidHow = 'cash_back' | 'petty_cash' | 'bank'

export const PAID_HOW_LABEL: Record<PaidHow, string> = {
  cash_back: 'Cash given back',
  petty_cash: 'From petty cash',
  bank: 'Bank transfer',
}

export interface Claim {
  id: string
  createdAt: string
  createdBy: string | null
  /** The engineer's name (the admin's list). */
  byName: string
  spentOn: string
  amount: number
  note: string | null
  orderId: string | null
  /** "ORD-0042" when the claim names a job. */
  orderLabel: string | null
  status: ClaimStatus
  paidHow: PaidHow | null
  rejectReason: string | null
  decidedAt: string | null
}

type ClaimRow = {
  id: string
  created_at: string
  created_by: string | null
  spent_on: string
  amount_pkr: number
  note: string | null
  order_id: string | null
  status: string
  paid_how: string | null
  reject_reason: string | null
  decided_at: string | null
}

const COLS = 'id, created_at, created_by, spent_on, amount_pkr, note, order_id, status, paid_how, reject_reason, decided_at'

async function toClaims(rows: readonly ClaimRow[]): Promise<Claim[]> {
  const db = requireSupabase()
  const people = [...new Set(rows.map(r => r.created_by).filter((x): x is string => !!x))]
  const orders = [...new Set(rows.map(r => r.order_id).filter((x): x is string => !!x))]
  const [names, labels] = await Promise.all([
    people.length ? db.from('users').select('id, name').in('id', people).then(r => unwrap(r) ?? []) : Promise.resolve([] as { id: string; name: string }[]),
    orders.length ? lookupLabels({ orders }) : Promise.resolve(null),
  ])
  const nameOf = new Map(names.map(n => [n.id, n.name]))
  return rows.map(r => ({
    id: r.id,
    createdAt: r.created_at,
    createdBy: r.created_by,
    byName: (r.created_by && nameOf.get(r.created_by)) || 'Engineer',
    spentOn: r.spent_on,
    amount: Number(r.amount_pkr),
    note: r.note,
    orderId: r.order_id,
    orderLabel: r.order_id && labels?.orders[r.order_id] ? orderRef(Number(labels.orders[r.order_id].number)) : null,
    status: r.status as ClaimStatus,
    paidHow: (r.paid_how as PaidHow | null) ?? null,
    rejectReason: r.reject_reason,
    decidedAt: r.decided_at,
  }))
}

/** The admin's "To approve" list: every pending claim, oldest first. */
export async function listPendingClaims(): Promise<Claim[]> {
  const db = requireSupabase()
  const rows = await fetchAll<ClaimRow>((from, to) => db.from('expense_claims').select(COLS).eq('status', 'pending').order('created_at').range(from, to))
  return toClaims(rows)
}

/** An engineer's own claims (row security returns nothing else), newest first; the last 60. */
export async function listMyClaims(): Promise<Claim[]> {
  const db = requireSupabase()
  const rows = unwrap(await db.from('expense_claims').select(COLS).order('created_at', { ascending: false }).limit(60)) ?? []
  return toClaims(rows)
}

export interface NewClaim {
  id: string
  amount: number
  spentOn: string
  note: string | null
  orderId: string | null
}

/** Adds a claim under its client id; a retry of the same id adds nothing (the duplicate is ignored). */
export async function createClaim(c: NewClaim): Promise<void> {
  const db = requireSupabase()
  const { error } = await db
    .from('expense_claims')
    .upsert([{ id: c.id, amount_pkr: c.amount, spent_on: c.spentOn, note: c.note, order_id: c.orderId }], { onConflict: 'id', ignoreDuplicates: true })
  if (error) throw error
}

/** A pending claim the engineer takes back (and its photos). */
export async function withdrawClaim(id: string): Promise<void> {
  const db = requireSupabase()
  const photos = await listClaimPhotos(id).catch(() => [])
  const { error } = await db.from('expense_claims').delete().eq('id', id)
  if (error) throw error
  if (photos.length) await db.storage.from(CLAIM_BUCKET).remove(photos.map(p => p.path))
}

export async function approveClaim(v: { id: string; categoryId: string; paidHow: PaidHow }): Promise<string> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('approve_expense_claim', { p_claim: v.id, p_category: v.categoryId, p_paid_how: v.paidHow })
  if (error) throw error
  return data as string
}

export async function rejectClaim(v: { id: string; reason: string | null }): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('expense_claims').update({ status: 'rejected', reject_reason: v.reason }).eq('id', v.id).eq('status', 'pending')
  if (error) throw error
}

// ------------------------------------------------------------------ photos: claim-receipts/<claim id>/<uuid>.<ext>

export interface ClaimPhoto {
  path: string
  name: string
}

export async function uploadClaimPhoto(claimId: string, file: File): Promise<void> {
  const db = requireSupabase()
  const ext = (/\.([a-z0-9]{1,5})$/i.exec(file.name)?.[1] ?? (file.type === 'image/png' ? 'png' : 'jpg')).toLowerCase()
  const up = await db.storage.from(CLAIM_BUCKET).upload(`${claimId}/${crypto.randomUUID()}.${ext}`, file, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (up.error) throw up.error
}

export async function listClaimPhotos(claimId: string): Promise<ClaimPhoto[]> {
  const db = requireSupabase()
  const { data, error } = await db.storage.from(CLAIM_BUCKET).list(claimId)
  if (error) throw error
  return (data ?? []).filter(o => o.name && !o.name.startsWith('.')).map(o => ({ path: `${claimId}/${o.name}`, name: o.name }))
}

export async function signClaimPhoto(path: string, seconds = 600): Promise<string> {
  const db = requireSupabase()
  const { data, error } = await db.storage.from(CLAIM_BUCKET).createSignedUrl(path, seconds)
  if (error) throw error
  return data.signedUrl
}

// ------------------------------------------------------------------ cash in hand (admin)

export interface CashInHand {
  kind: 'none' | 'opening' | 'count'
  baseOn: string | null
  baseAt: string | null
  base: number
  topups: number
  topupCount: number
  cashOut: number
  cashOutCount: number
  /** null until an opening balance is set. */
  expected: number | null
  /** The difference found at the last count (counted - expected), or null. */
  lastDifference: number | null
}

export async function loadCashInHand(): Promise<CashInHand | null> {
  const db = requireSupabase()
  const rows = unwrap(await db.rpc('cash_in_hand')) ?? []
  const r = rows[0]
  if (!r) return null
  const n = (v: number | null | undefined) => (v === null || v === undefined ? 0 : Number(v))
  return {
    kind: (r.base_kind as CashInHand['kind']) ?? 'none',
    baseOn: r.base_on ?? null,
    baseAt: r.base_at ?? null,
    base: n(r.base_pkr),
    topups: n(r.topups_pkr),
    topupCount: r.topup_count ?? 0,
    cashOut: n(r.cash_out_pkr),
    cashOutCount: r.cash_out_count ?? 0,
    expected: r.expected_pkr === null || r.expected_pkr === undefined ? null : Number(r.expected_pkr),
    lastDifference: r.last_difference_pkr === null || r.last_difference_pkr === undefined ? null : Number(r.last_difference_pkr),
  }
}

/** Records a count (the database stores what it expected and the difference) or, the first time, the opening balance. */
export async function recordCashCount(v: { id: string; counted: number; note: string | null; opening?: { on: string } }): Promise<{ expected: number | null; difference: number | null }> {
  const db = requireSupabase()
  const row: { id: string; counted_pkr: number; note: string | null; is_opening?: boolean; counted_on?: string } = { id: v.id, counted_pkr: v.counted, note: v.note }
  if (v.opening) {
    row.is_opening = true
    row.counted_on = v.opening.on
  }
  const res = await db.from('cash_counts').insert(row).select('expected_pkr, difference_pkr').maybeSingle()
  if (res.error) {
    // the same count sent twice (a retry after a dropped reply): already recorded
    if (res.error.code === '23505') return { expected: null, difference: null }
    throw res.error
  }
  return {
    expected: res.data?.expected_pkr === null || res.data?.expected_pkr === undefined ? null : Number(res.data.expected_pkr),
    difference: res.data?.difference_pkr === null || res.data?.difference_pkr === undefined ? null : Number(res.data.difference_pkr),
  }
}

/** Cash drawn from the bank into the office box. Not an expense. */
export async function addCashTopup(v: { id: string; amount: number; drawnOn: string; note: string | null }): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('cash_topups').upsert([{ id: v.id, amount_pkr: v.amount, drawn_on: v.drawnOn, note: v.note }], { onConflict: 'id', ignoreDuplicates: true })
  if (error) throw error
}
