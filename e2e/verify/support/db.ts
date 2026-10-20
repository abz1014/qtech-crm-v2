import { expect } from '@playwright/test'
import { API_URL, ANON_KEY, must, rest, type RestResult, type Role } from '../../support/stack'

/*
 * The database side of a workflow check. Every verify test asserts twice: what the screen shows, and what the database holds.
 *
 *   db.*     reads and writes as the LOCAL stack's service role (SERVICE_ROLE_KEY from `supabase status -o env`, exported by
 *            scripts/ci/e2e-run.sh). It bypasses Row Level Security, so a read is the plain truth of what is stored, whatever the
 *            role on screen may see. Used to ASSERT outcomes and to set up or back-date fixtures. Without the key (a developer
 *            machine that did not export it) it falls back to the admin fixture user, which is enough for every table the tests read.
 *   as(role) a PostgREST call as a fixture user (admin, sales, engineer), so Row Level Security answers: use it to prove a refusal.
 *
 * Only API_URL (the local stack) is ever called. There is no remote URL or key in this repository.
 */
export const SERVICE_KEY = process.env.SERVICE_ROLE_KEY ?? ''

export const USER = {
  admin: 'a0000000-0000-4000-8000-000000000001',
  sales: 'a0000000-0000-4000-8000-000000000002',
  engineer: 'a0000000-0000-4000-8000-000000000003',
  deactivated: 'a0000000-0000-4000-8000-000000000004',
} as const

interface Init {
  method?: string
  body?: unknown
  prefer?: string
}

/** A PostgREST call as the service role. Returns status and body (never throws), like `rest`. */
export async function service<T = unknown>(path: string, init: Init = {}): Promise<RestResult<T>> {
  if (!SERVICE_KEY) return rest<T>('admin', path, init)
  const res = await fetch(`${API_URL}/rest/v1/${path}`, {
    method: init.method ?? 'GET',
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
      prefer: init.prefer ?? 'return=representation',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const text = await res.text()
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T }
}

export const db = {
  /** Rows of a table or view: `db.rows('invoices?order_id=eq.X&select=net_amount,gst_amount')`. Throws on a non-2xx answer. */
  rows: <T = Record<string, unknown>>(path: string) => must(service<T[]>(path)),
  /** Exactly one row (asserted), for "the record this test made". */
  one: async <T = Record<string, unknown>>(path: string): Promise<T> => {
    const r = await must(service<T[]>(path))
    expect(r, `exactly one row for ${path}`).toHaveLength(1)
    return r[0]
  },
  /** How many rows match. */
  count: async (path: string): Promise<number> => (await must(service<unknown[]>(path))).length,
  insert: async <T = { id: string }>(table: string, body: unknown): Promise<T[]> => must(service<T[]>(table, { method: 'POST', body })),
  /** Insert one row and return it. */
  add: async <T = { id: string }>(table: string, body: Record<string, unknown>): Promise<T> => (await must(service<T[]>(table, { method: 'POST', body })))[0],
  patch: async (path: string, body: Record<string, unknown>): Promise<void> => {
    await must(service(path, { method: 'PATCH', body, prefer: 'return=minimal' }))
  },
  del: async (path: string): Promise<void> => {
    await must(service(path, { method: 'DELETE', prefer: 'return=minimal' }))
  },
  /** An RPC as the service role. Note: functions that check current_user_role() refuse the service role; call those with as(role). */
  rpc: <T = unknown>(fn: string, args: Record<string, unknown> = {}) => must(service<T>(`rpc/${fn}`, { method: 'POST', body: args })),
  /**
   * Rows of a VIEW (v_order_state, v_order_money, v_month_pnl, ...) or a role-checking function, read as the admin fixture user. The
   * views are security_invoker and filter on current_user_role(), which is null for the service role (and not granted to it), so
   * they must be read as a signed-in person. Admin sees every row.
   */
  view: <T = Record<string, unknown>>(path: string) => must(rest<T[]>('admin', path)),
  /** A role-checking RPC as the admin (order_receivables, month_end_status, aging_as_of, rank_item_quotes, ...). */
  adminRpc: <T = unknown>(fn: string, args: Record<string, unknown> = {}) => must(rest<T>('admin', `rpc/${fn}`, { method: 'POST', body: args })),
}

/** A PostgREST call as a fixture user; Row Level Security and the functions' own role checks answer. Never throws. */
export function as<T = unknown>(role: Role, path: string, init: Init = {}): Promise<RestResult<T>> {
  return rest<T>(role, path, init)
}

/** An RPC as a fixture user. Never throws: assert on `.status` (a refusal is 4xx, usually 401/403 with code 42501). */
export function rpcAs<T = unknown>(role: Role, fn: string, args: Record<string, unknown> = {}): Promise<RestResult<T>> {
  return rest<T>(role, `rpc/${fn}`, { method: 'POST', body: args })
}

/** Numeric columns arrive as numbers or decimal strings; compare as numbers. */
export const num = (v: unknown): number => (v === null || v === undefined ? NaN : Number(v))

/** Poll the database until `read()` returns `expected` (a write the screen made may land a moment after its toast). */
export async function eventually<T>(read: () => Promise<T>, expected: T, message?: string, timeout = 10_000): Promise<void> {
  await expect.poll(read, { message, timeout }).toEqual(expected)
}

export { API_URL, ANON_KEY }
