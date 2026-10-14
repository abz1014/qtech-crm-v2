import { COLS, toRow, type CompanyProfile, type ProfileValues } from '@/features/settings/companyProfile'
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
