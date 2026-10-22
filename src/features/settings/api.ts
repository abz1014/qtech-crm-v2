import { COLS, toRow, type CompanyProfile, type ProfileValues } from '@/features/settings/companyProfile'
import { WEAK_NEW, WRONG_CURRENT } from '@/features/settings/passwordModel'
import type { Category, CategoryGroup, ExpenseGroup, PaidVia } from '@/features/settings/categoriesModel'
import type { ProgressRow, TargetRow } from '@/features/settings/targetsModel'
import { PlainError } from '@/lib/pgErrors'
import { requireSupabase, unwrap } from '@/lib/supabase'

/*
 * Settings: every server call for this area (R01), and the only file that names the admin-users
 * function or the company_profile table. Hooks (hooks.ts) wrap these in TanStack Query.
 *
 * People (A04): every call goes through the admin-users Edge Function, which checks on the server
 * that the caller is an active admin. The browser never writes the users table or Auth directly.
 * Generated passwords come back once, in the response of `create` and `reset_password`, and are
 * never stored here.
 *
 * Company profile (A06): one row (id = 1). Every staff role reads it; RLS lets only an admin update.
 */
export type Role = 'admin' | 'sales' | 'engineer'

export interface TeamMember {
  id: string
  name: string
  email: string | null
  role: Role
  job_title: string | null
  phone: string | null
  deactivated_at: string | null
  created_at: string
}

export interface CreatedUser {
  user: { id: string; name: string; email: string; role: Role; job_title: string | null }
  password: string
}

type Body =
  | { action: 'list' }
  | { action: 'create'; name: string; email: string; role: Role; job_title?: string }
  | { action: 'reset_password'; user_id: string }
  | { action: 'set_role'; user_id: string; role: Role }
  | { action: 'set_job_title'; user_id: string; job_title: string | null }
  | { action: 'deactivate'; user_id: string }
  | { action: 'reactivate'; user_id: string }

/** Plain sentences, so a person sees what is true rather than "Edge Function returned a non-2xx". */
const FALLBACK: Record<number, string> = {
  401: 'Your sign-in has expired. Sign in again.',
  403: 'Only an active admin can manage people.',
  404: 'That person does not exist.',
}

async function call<T>(body: Body): Promise<T> {
  const { data, error } = await requireSupabase().functions.invoke('admin-users', { body })
  if (!error) return data as T
  // FunctionsHttpError carries the Response; the function's own message is already plain.
  const res = (error as { context?: unknown }).context
  if (res instanceof Response) {
    let json: { error?: unknown; code?: unknown } | null = null
    try {
      json = (await res.json()) as { error?: unknown; code?: unknown }
    } catch {
      // not JSON: fall through to the generic sentence
    }
    const message = typeof json?.error === 'string' ? json.error : (FALLBACK[res.status] ?? 'Something went wrong. Nothing was changed. Try again.')
    throw new PlainError(message, typeof json?.code === 'string' ? json.code : undefined)
  }
  // The request never reached the function (offline, DNS): a TypeError makes mapPgError say so.
  throw new TypeError(error.message)
}

export const listTeam = async (): Promise<TeamMember[]> => (await call<{ users: TeamMember[] }>({ action: 'list' })).users
export const createPerson = (v: { name: string; email: string; role: Role; job_title?: string }) => call<CreatedUser>({ action: 'create', ...v })
export const resetPassword = (userId: string) => call<{ user_id: string; password: string }>({ action: 'reset_password', user_id: userId })
export const setRole = (userId: string, role: Role) => call<{ user_id: string; role: Role }>({ action: 'set_role', user_id: userId, role })
export const setJobTitle = (userId: string, jobTitle: string | null) =>
  call<{ user_id: string; job_title: string | null }>({ action: 'set_job_title', user_id: userId, job_title: jobTitle })
export const deactivatePerson = (userId: string) => call<{ user_id: string }>({ action: 'deactivate', user_id: userId })
export const reactivatePerson = (userId: string) => call<{ user_id: string }>({ action: 'reactivate', user_id: userId })

// ---------------------------------------------------------------- phone (users.phone, migration 0039)

/**
 * Phone is the one users column a browser may write (column grant plus policy users_update_phone: own row,
 * or any row for an admin). It is a plain table update, not the admin-users function. select() after the
 * update: a row RLS hides affects nothing and returns no error, which must not look like success.
 */
export async function setPhone(userId: string, phone: string | null): Promise<string | null> {
  const rows = unwrap(await requireSupabase().from('users').update({ phone }).eq('id', userId).select('id, phone'))
  if (!rows || rows.length === 0) throw new PlainError('You can only change your own phone number.')
  return (rows[0] as unknown as { phone: string | null }).phone
}

export interface MyDetails {
  id: string
  name: string
  email: string | null
  job_title: string | null
  phone: string | null
}

/** The signed-in person's own row. The email is the sign-in address (Auth), not a users column. */
export async function getMyDetails(userId: string): Promise<MyDetails> {
  const db = requireSupabase()
  const row = unwrap(await db.from('users').select('id, name, job_title, phone').eq('id', userId).single()) as unknown as Omit<MyDetails, 'email'>
  const email = (await db.auth.getSession()).data.session?.user.email ?? null
  return { id: String(row.id), name: String(row.name), job_title: row.job_title ?? null, phone: row.phone ?? null, email }
}

// ---------------------------------------------------------------- company profile

export async function getCompanyProfile(): Promise<CompanyProfile> {
  const res = await requireSupabase().from('company_profile').select(COLS).eq('id', 1).single()
  return unwrap(res) as unknown as CompanyProfile
}

export async function saveCompanyProfile(values: ProfileValues): Promise<CompanyProfile> {
  // select() after update: an update RLS refuses affects no row and returns no error, which must not look like success.
  const rows = unwrap(await requireSupabase().from('company_profile').update(toRow(values)).eq('id', 1).select(COLS))
  if (!rows || rows.length === 0) throw new PlainError('Only an admin can change the company profile.')
  return rows[0] as unknown as CompanyProfile
}

// ---------------------------------------------------------------- own password

/**
 * Changes the signed-in person's own password: re-checks the current one by signing in again with it
 * (the same account, so the session simply refreshes), then sets the new one. Neither password is
 * stored, logged or put in an error message. There is no audit row: audit_log is written only by the
 * service role, and a browser session cannot (and should not) insert into it.
 */
export async function changeOwnPassword(current: string, next: string): Promise<void> {
  const db = requireSupabase()
  const email = (await db.auth.getSession()).data.session?.user.email
  if (!email) throw new PlainError('You are signed out. Sign in again, then change your password.')

  const check = await db.auth.signInWithPassword({ email, password: current })
  if (check.error) {
    if (check.error.name === 'AuthRetryableFetchError') throw new TypeError(check.error.message)
    throw new PlainError(WRONG_CURRENT, 'wrong_current')
  }
  const res = await db.auth.updateUser({ password: next })
  if (res.error) {
    if (res.error.name === 'AuthRetryableFetchError') throw new TypeError(res.error.message)
    if (res.error.code === 'weak_password') throw new PlainError(WEAK_NEW, 'weak_new')
    if (res.error.code === 'same_password') throw new PlainError('Choose a password different from your current one.', 'weak_new')
    throw new PlainError('Could not change the password. Nothing was changed. Try again.')
  }
}

// ---------------------------------------------------------------- targets (M06, admin only)

const TARGET_COLS = 'id, user_id, year, quarter, target_net_pkr'
const toTarget = (r: Record<string, unknown>): TargetRow => ({
  id: String(r.id),
  user_id: String(r.user_id),
  year: Number(r.year),
  quarter: Number(r.quarter),
  target_net_pkr: Number(r.target_net_pkr),
})

/** The year and the one before it, so "copy last quarter" can reach back from Q1 into last year's Q4. RLS lets only an admin see other people's rows. */
export async function listTargets(year: number): Promise<TargetRow[]> {
  const rows = unwrap(await requireSupabase().from('targets').select(TARGET_COLS).gte('year', year - 1).lte('year', year)) ?? []
  return (rows as unknown as Record<string, unknown>[]).map(toTarget)
}

/** v_target_progress is admin only. Achieved and on pace are computed by the database; nothing is stored. */
export async function listTargetProgress(year: number): Promise<ProgressRow[]> {
  const rows =
    unwrap(
      await requireSupabase()
        .from('v_target_progress')
        .select('user_id, year, quarter, target_net, achieved_net, on_pace_net, behind_pace, excluded_count')
        .eq('year', year),
    ) ?? []
  return (rows as unknown as Record<string, unknown>[]).map(r => ({
    user_id: String(r.user_id),
    year: Number(r.year),
    quarter: Number(r.quarter),
    target_net: r.target_net == null ? null : Number(r.target_net),
    achieved_net: Number(r.achieved_net ?? 0),
    on_pace_net: r.on_pace_net == null ? null : Number(r.on_pace_net),
    behind_pace: r.behind_pace == null ? null : Number(r.behind_pace),
    excluded_count: Number(r.excluded_count ?? 0),
  }))
}

/** Set or change one cell. One statement, keyed on (person, year, quarter), so a second tap cannot make a second row. */
export async function saveTarget(v: { userId: string; year: number; quarter: number; amount: number }): Promise<TargetRow> {
  const rows = unwrap(
    await requireSupabase()
      .from('targets')
      .upsert({ user_id: v.userId, year: v.year, quarter: v.quarter, target_net_pkr: v.amount }, { onConflict: 'user_id,year,quarter' })
      .select(TARGET_COLS),
  )
  if (!rows || rows.length === 0) throw new PlainError('Only an admin can set targets.')
  return toTarget(rows[0] as unknown as Record<string, unknown>)
}

/** Remove targets by id. Throws when nothing went, so a refused delete (no admin rights) is not mistaken for success. */
export async function removeTargets(ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0
  const rows = unwrap(await requireSupabase().from('targets').delete().in('id', [...ids]).select('id'))
  if (!rows || rows.length === 0) throw new PlainError('Only an admin can remove targets.')
  return rows.length
}

/** Add targets in one statement; a cell that already has one is skipped, never overwritten. Returns the rows added. */
export async function addTargets(rows: readonly { user_id: string; year: number; quarter: number; target_net_pkr: number }[]): Promise<TargetRow[]> {
  if (rows.length === 0) return []
  const out = unwrap(
    await requireSupabase()
      .from('targets')
      .upsert([...rows], { onConflict: 'user_id,year,quarter', ignoreDuplicates: true })
      .select(TARGET_COLS),
  )
  return ((out ?? []) as unknown as Record<string, unknown>[]).map(toTarget)
}

// ---------------------------------------------------------------- expense categories (M13, admin only)

const CATEGORY_COLS = 'id, name, grp, group_id, monthly_budget_pkr, default_paid_via, sort, active'

/** Every category with how many expenses and recurring templates use it (embedded counts, one request). */
export async function listCategories(): Promise<Category[]> {
  const rows =
    unwrap(
      await requireSupabase()
        .from('expense_categories')
        .select(`${CATEGORY_COLS}, expenses(count), recurring_expenses(count)`)
        .order('sort', { ascending: true })
        .order('name', { ascending: true }),
    ) ?? []
  const count = (x: unknown) => (Array.isArray(x) && x[0] && typeof x[0] === 'object' ? Number((x[0] as { count?: unknown }).count ?? 0) : 0)
  return (rows as unknown as Record<string, unknown>[]).map(r => ({
    id: String(r.id),
    name: String(r.name),
    grp: r.grp as CategoryGroup,
    default_paid_via: r.default_paid_via as PaidVia,
    sort: Number(r.sort),
    active: Boolean(r.active),
    used: count(r.expenses) + count(r.recurring_expenses),
    group_id: String(r.group_id),
    monthly_budget_pkr: r.monthly_budget_pkr === null || r.monthly_budget_pkr === undefined ? null : Number(r.monthly_budget_pkr),
  }))
}

/** What each category has had paid this month so far ("2026-10"), gross, by category id (v_month_cash_out_detail, 0079). */
export async function categoryMonthTotals(month: string): Promise<Record<string, number>> {
  const rows = unwrap(await requireSupabase().from('v_month_cash_out_detail').select('category_id, gross_paid').eq('month', `${month}-01`)) ?? []
  const out: Record<string, number> = {}
  for (const r of rows) if (r.category_id) out[r.category_id] = Math.round(((out[r.category_id] ?? 0) + Number(r.gross_paid ?? 0)) * 100) / 100
  return out
}

/**
 * What a new expense may choose from: active categories only, in the saved order. The expense forms (M11) read this,
 * and the database refuses an expense that names an inactive category anyway (migration 0025).
 */
export async function listActiveCategories(): Promise<Omit<Category, 'used'>[]> {
  const rows =
    unwrap(
      await requireSupabase()
        .from('expense_categories')
        .select(CATEGORY_COLS)
        .eq('active', true)
        .order('sort', { ascending: true })
        .order('name', { ascending: true }),
    ) ?? []
  return rows as unknown as Omit<Category, 'used'>[]
}

export type CategoryPatch = Partial<Pick<Category, 'name' | 'group_id' | 'default_paid_via' | 'active' | 'monthly_budget_pkr' | 'sort'>>

export async function updateCategory(id: string, patch: CategoryPatch): Promise<void> {
  const rows = unwrap(await requireSupabase().from('expense_categories').update(patch).eq('id', id).select('id'))
  if (!rows || rows.length === 0) throw new PlainError('Only an admin can change categories.')
}

/** Adds a category and returns its id (an expense form that creates one inline selects it straight away). */
export async function createCategory(v: {
  name: string
  group_id: string
  /** The group's kind; the database sets it from the group anyway (0084). */
  grp: CategoryGroup
  default_paid_via: PaidVia
  sort: number
  monthly_budget_pkr?: number | null
}): Promise<string> {
  const rows = unwrap(await requireSupabase().from('expense_categories').insert(v).select('id'))
  if (!rows?.[0]) throw new PlainError('Only an admin can add categories.')
  return rows[0].id
}

/** Writes the new order: one statement per changed row, run together; each sets only `sort`. */
export async function reorderCategories(changes: readonly { id: string; sort: number }[]): Promise<void> {
  const db = requireSupabase()
  const results = await Promise.all(changes.map(c => db.from('expense_categories').update({ sort: c.sort }).eq('id', c.id).select('id')))
  results.forEach(r => unwrap(r))
}

/** A category nothing uses can go. If something does, the foreign key refuses (23503) and mapPgError says so in words. */
export async function deleteCategory(id: string): Promise<void> {
  const rows = unwrap(await requireSupabase().from('expense_categories').delete().eq('id', id).select('id'))
  if (!rows || rows.length === 0) throw new PlainError('Only an admin can delete categories.')
}

/** Moves every expense and recurring template of `from` into `into`, then removes `from` (0084). Returns how many expenses moved. */
export async function mergeCategories(from: string, into: string): Promise<number> {
  const n = unwrap(await requireSupabase().rpc('merge_expense_categories', { p_from: from, p_into: into }))
  return Number(n ?? 0)
}

// ---------------------------------------------------------------- expense groups (0084, admin only)

/** The expense groups in their saved order (the same read as the expense screens, under the same query key). */
export async function listGroups(): Promise<ExpenseGroup[]> {
  const rows = unwrap(await requireSupabase().from('expense_groups').select('id, name, kind, sort').order('sort').order('name')) ?? []
  return rows.map(r => ({ id: r.id, name: r.name, kind: r.kind as CategoryGroup, sort: r.sort }))
}

export async function createGroup(v: { name: string; kind: CategoryGroup; sort: number }): Promise<string> {
  const rows = unwrap(await requireSupabase().from('expense_groups').insert(v).select('id'))
  if (!rows?.[0]) throw new PlainError('Only an admin can add groups.')
  return rows[0].id
}

export async function updateGroup(id: string, patch: { name?: string; sort?: number }): Promise<void> {
  const rows = unwrap(await requireSupabase().from('expense_groups').update(patch).eq('id', id).select('id'))
  if (!rows || rows.length === 0) throw new PlainError('Only an admin can change groups.')
}

/** An empty group can go; one that still lists a category is refused by the foreign key (23503). */
export async function deleteGroup(id: string): Promise<void> {
  const rows = unwrap(await requireSupabase().from('expense_groups').delete().eq('id', id).select('id'))
  if (!rows || rows.length === 0) throw new PlainError('Only an admin can delete groups.')
}
