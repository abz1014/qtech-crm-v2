import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { API_URL, ANON_KEY } from '../support/stack'

/*
 * Shared by the verify-roles suite (branch test/roles-verify). Everything here talks to the LOCAL CI stack only (API_URL from
 * `supabase status`), with the seed's fixture users and test users it creates itself (@test.invalid). Nothing reaches a remote
 * project: there is no remote URL or key in this repository.
 *
 * Personas:
 *   admin, sales, engineer   the seed's staff users
 *   deactivated              the seed's deactivated user (a users row with deactivated_at)
 *   norole                   an Auth user with NO public.users row, created here with the service role
 *   ghost                    a token whose Auth user was deleted after signing in (the token is still a valid JWT)
 *   anon                     the publishable/anon key only
 */
export const SERVICE_KEY = process.env.SERVICE_ROLE_KEY ?? ''
export const FIXTURE_PASSWORD = 'fixture-only-password'
export const STAFF_EMAIL = {
  admin: 'admin@test.invalid',
  sales: 'sales@test.invalid',
  engineer: 'engineer@test.invalid',
  deactivated: 'deactivated@test.invalid',
} as const

export type Staff = keyof typeof STAFF_EMAIL
export type Persona = Staff | 'norole' | 'ghost' | 'anon'

export interface Tokens {
  access_token: string
  user_id: string
}

const tokens = new Map<Persona, Tokens>()
const created = new Map<'norole' | 'ghost', { email: string; password: string; id: string }>()

export async function signIn(email: string, password: string): Promise<Tokens> {
  const res = await fetch(`${API_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error(`sign-in failed for ${email}: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { access_token: string; user: { id: string } }
  return { access_token: body.access_token, user_id: body.user.id }
}

export async function service(path: string, init: { method?: string; body?: unknown; prefer?: string; headers?: Record<string, string> } = {}): Promise<Response> {
  if (!SERVICE_KEY) throw new Error('SERVICE_ROLE_KEY is not set (supabase status -o env)')
  return fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
      ...(init.prefer ? { prefer: init.prefer } : {}),
      ...(init.headers ?? {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
}

/** A CI-local Auth user with a random password and no users row. */
export async function createAuthOnlyUser(tag: string): Promise<{ email: string; password: string; id: string }> {
  const email = `${tag}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@test.invalid`
  const password = `T${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}!9`
  const res = await service('/auth/v1/admin/users', { method: 'POST', body: { email, password, email_confirm: true } })
  if (res.status !== 200) throw new Error(`could not create ${tag}: ${res.status} ${await res.text()}`)
  const { id } = (await res.json()) as { id: string }
  return { email, password, id }
}

/** The norole user (created once per worker): can sign in, has no users row. */
export async function norole(): Promise<{ email: string; password: string; id: string }> {
  const hit = created.get('norole')
  if (hit) return hit
  const u = await createAuthOnlyUser('norole')
  created.set('norole', u)
  return u
}

export async function tokenFor(p: Persona): Promise<Tokens | null> {
  if (p === 'anon') return null
  const hit = tokens.get(p)
  if (hit) return hit
  let t: Tokens
  if (p === 'norole') {
    const u = await norole()
    t = await signIn(u.email, u.password)
  } else if (p === 'ghost') {
    const u = await createAuthOnlyUser('ghost')
    t = await signIn(u.email, u.password)
    const del = await service(`/auth/v1/admin/users/${u.id}`, { method: 'DELETE' })
    if (del.status !== 200) throw new Error(`could not delete the ghost user: ${del.status} ${await del.text()}`)
    created.set('ghost', u)
  } else {
    t = await signIn(STAFF_EMAIL[p], FIXTURE_PASSWORD)
  }
  tokens.set(p, t)
  return t
}

export interface Answer {
  status: number
  body: unknown
  text: string
  headers: Headers
}

/** A REST or RPC call as a persona. Never throws on an HTTP error, so a refusal can be asserted. */
export async function api(p: Persona, path: string, init: { method?: string; body?: unknown; prefer?: string; headers?: Record<string, string> } = {}): Promise<Answer> {
  const t = await tokenFor(p)
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      apikey: ANON_KEY,
      ...(t ? { authorization: `Bearer ${t.access_token}` } : {}),
      'content-type': 'application/json',
      ...(init.prefer ? { prefer: init.prefer } : {}),
      ...(init.headers ?? {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: res.status, body, text, headers: res.headers }
}

export async function adminPost<T = { id: string }>(table: string, body: unknown): Promise<T> {
  const r = await api('admin', `/rest/v1/${table}`, { method: 'POST', body, prefer: 'return=representation' })
  if (r.status >= 300) throw new Error(`POST ${table} as admin: ${r.status} ${r.text}`)
  return (r.body as T[])[0]
}

export async function servicePost<T = { id: string }>(table: string, body: unknown): Promise<T> {
  const res = await service(`/rest/v1/${table}`, { method: 'POST', body, prefer: 'return=representation' })
  const text = await res.text()
  if (res.status >= 300) throw new Error(`POST ${table} as service: ${res.status} ${text}`)
  return (JSON.parse(text) as T[])[0]
}

// ------------------------------------------------------------------------------------------------ the schema, from database.ts
/*
 * The tables, views and functions are read from src/types/database.ts (generated from the database; CI's db.yml fails when it
 * drifts), so a new object is swept without editing this suite.
 */
export interface Schema {
  tables: string[]
  views: string[]
  functions: { name: string; args: string[] }[]
}

export function readSchema(): Schema {
  const src = readFileSync(join(process.cwd(), 'src/types/database.ts'), 'utf8')
  const pub = src.slice(src.indexOf('"public": {'))
  const section = (from: string, to: string) => pub.slice(pub.indexOf(from), pub.indexOf(to))
  const names = (sec: string) => [...sec.matchAll(/"([a-z_0-9]+)": \{\s*Row: \{/g)].map(m => m[1])
  const fnSec = section('Functions: {', 'Enums: {')
  const functions = [...fnSec.matchAll(/"([a-z_0-9]+)":\s*\n\{ Args: ([^;]*);/g)].map(m => ({
    name: m[1],
    args: [...m[2].matchAll(/"([a-z_0-9]+)"\??:/g)].map(a => a[1]),
  }))
  return { tables: names(section('Tables: {', 'Views: {')), views: names(section('Views: {', 'Functions: {')), functions }
}

// ------------------------------------------------------------------------------------------------ money classification
/*
 * The same classification as supabase/tests/0902_verify_engineer_money.test.sql (keep the two in step): for each table, view
 * or function, the money columns and their rule for an engineer.
 *   hidden    must never reach an engineer (a value here is a failure)
 *   m3        selling price. Since 0081 (owner decision 2026-10-22) the database refuses it to an engineer (role qtech_engineer):
 *             a value reaching an engineer, in the browser or through the API, is a failure
 *   supplier  supplier price or exchange rate: as m3
 *   own       the engineer's own target (no longer read by the app for an engineer: it is PKR amounts)
 *   info      not money (a rate, a count)
 * JSON values (legacy_source, quotation lines) are searched for money-named keys; legacy_source must carry none (BUG-RV-01).
 */
export type Rule = 'hidden' | 'm3' | 'supplier' | 'own' | 'info'
const H = 'hidden'
export const MONEY: Record<string, Record<string, Rule>> = {
  audit_log: { old_value: H, new_value: H },
  expenses: { amount_pkr: H, input_tax_pkr: H },
  invoices: { net_amount: H, gst_amount: H, tax_deposit_amount: H },
  payments_in: { amount: H },
  recurring_expenses: { amount: H },
  order_costs: { expected_cost_pkr: H },
  month_snapshots: { pnl: H, adjust: H, status: H, categories: H, team: H, payments: H, via: H, aging: H, payables: H, gst: H, details: H },
  order_items: { unit_price_net: 'm3', supplier_unit_price: 'supplier', gst_rate: 'info' },
  rfq_items: { quoted_unit_price_net: 'm3', gst_rate: 'info' },
  quotations: { net_total: 'm3', gst_total: 'm3', lines: 'm3' },
  purchase_orders: { total: 'supplier', lines: 'supplier' },
  supplier_quote_lines: { unit_price: 'supplier', fx_rate_pkr: 'supplier' },
  targets: { target_net_pkr: 'own' },
  fx_rates: { rate_pkr: 'supplier' },
  v_fx_latest: { rate_pkr: 'supplier' },
  v_rfq_state: { items_total: 'info', items_quoted: 'info' },
  v_inquiry_state: { items_total: 'info', items_quoted: 'info' },
  v_report_float: { items_total: 'info', items_quoted: 'info' },
  v_supplier_stats: { quoted: 'info', prices_hidden: 'info' },
  v_order_items_total: { net: 'm3', gst: 'm3', gross: 'm3' },
  v_order_state: { net: 'm3', gst: 'm3', gross: 'm3' },
  v_cash_month: { gross_received: H, gst_received: H, money_out: H, net_received: H, unresolved_gross: H },
  v_month_cash_flow: { money_in: H, money_out: H },
  v_month_cash_out_detail: { gross_paid: H },
  v_month_profit: { sales_net: H, sales_gst: H, order_costs_matched: H, overheads: H, profit: H, order_costs_paid: H, non_pnl_paid: H, input_tax_paid: H },
  v_gst_month: { net: H, gst: H, deposited_amount: H, gst_to_deposit: H, input_tax: H },
  v_gst_register: { net_amount: H, gst_amount: H, gross_amount: H, tax_deposit_amount: H },
  v_invoice_state: { net_amount: H, gst_amount: H, gross_amount: H },
  v_month_expense_category: { net_cost: H, gross_paid: H },
  v_month_pnl: {
    net_in: H, gst_in: H, unresolved_gross: H, order_costs: H, overheads: H, result: H, non_pnl_out: H, after_drawings: H, cash_out_total: H,
    input_tax: H, adj_net_in: H, adj_gst_in: H, adj_unresolved_gross: H, adj_order_costs: H, adj_overheads: H, adj_non_pnl_out: H, adjust_result: H,
  },
  v_month_pnl_live: { net_in: H, gst_in: H, unresolved_gross: H, order_costs: H, overheads: H, non_pnl_out: H, cash_out_total: H, input_tax: H },
  v_month_team: { net_credited: H, quarter_achieved_net: H, quarter_target_net: H },
  v_order_basis: { items_net: H, items_gross: H, invoice_net: H, invoice_gross: H },
  v_order_money: { net_sale: H, expected_cost: H, actual_cost: H, margin: H, gross_target: H, settled: H, overpaid_by: H },
  v_payment_net: { amount: H, net_portion: H, gst_portion: H },
  v_target_progress: { target_net: H, achieved_net: H, on_pace_net: H },
  aging_as_of: { gross: H, applied: H, remaining: H, advance_held: H },
  payables_as_of: { committed: H, committed_pkr: H, fx_rate: H, paid_pkr: H, owed_pkr: H },
  order_receivables: { gross_target: H, settled: H, balance: H, overpaid_by: H },
  receivables_list: { gross_target: H, settled: H, balance: H, overpaid_by: H },
  receivables_summary: { gross: H, settled: H, outstanding: H, overdue: H, not_yet_due: H, not_invoiced: H },
  month_end_check_details: { detail: H },
  my_target_progress: { target_net: 'own', achieved_net: 'own', on_pace_net: 'own' },
  rank_item_quotes: {
    sell_unit_net: H, sell_order_number: H, spread_unit: H, spread_total: H,
    price: 'supplier', pkr_unit_price: 'supplier', fx_rate_pkr: 'supplier', orders_value_pkr: 'supplier',
  },
  customer_price_memory: { quoted_price: 'm3', sold_price: 'm3' },
  po_line_prefill: { unit_price: 'supplier' },
  supplier_item_memory: {
    last_quote_price: 'supplier', last_quote_price_pkr: 'supplier', last_quote_fx_rate_pkr: 'supplier', last_po_price: 'supplier',
    last_po_price_pkr: 'supplier', last_po_fx_rate_pkr: 'supplier', last_ordered_price: 'supplier', last_ordered_price_pkr: 'supplier',
    last_ordered_fx_rate_pkr: 'supplier',
  },
}

/** Keys of a JSON value (legacy_source, quotation lines) that look like money, at any depth, with a value. */
export const MONEY_JSON_KEY = /(price|cost|value|amount|total|gst|tax|margin|paid|balance|spread|gross|sell|sold|net_|_net)/i

export function moneyKeysIn(v: unknown, path = ''): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => moneyKeysIn(x, `${path}[${i}]`))
  if (v && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => {
      const here = `${path}.${k}`
      const leaf = (typeof x === 'number' && x !== 0) || (typeof x === 'string' && x !== '' && x !== '0')
      return [...(leaf && MONEY_JSON_KEY.test(k) ? [here] : []), ...moneyKeysIn(x, here)]
    })
  }
  return []
}

/** A column name that looks like money but is classified nowhere (a new column the suite must learn about). */
export const MONEY_NAME = /(price|cost|margin|amount|total|gst|_net$|^net|gross|balance|paid|pkr|tax|spread|settled|achieved|payable|owed|committed|remaining|result|drawings|money|_in$|_out$|sale|sold|sell|overhead|deposit|profit)/

export interface Leak {
  where: string
  field: string
  rule: Rule | 'unclassified' | 'legacy'
  value: string
}

/**
 * Every money value in a PostgREST answer for `object` (a table, view or function), following embedded objects by their key
 * (PostgREST names an embedded resource after its table). Zero, null and empty values are not money.
 */
export function moneyIn(object: string, body: unknown, where = object): Leak[] {
  const rows = Array.isArray(body) ? body : body && typeof body === 'object' ? [body] : []
  const out: Leak[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
      if (v === null || v === undefined || v === 0 || v === '0' || v === '') continue
      if ((Array.isArray(v) || typeof v === 'object') && !(k in (MONEY[object] ?? {})) && k !== 'legacy_source' && k !== 'detail') {
        out.push(...moneyIn(k, v, `${where}.${k}`))
        continue
      }
      if (k === 'legacy_source') {
        for (const key of moneyKeysIn(v)) out.push({ where, field: `legacy_source${key}`, rule: 'legacy', value: '…' })
        continue
      }
      const rule = MONEY[object]?.[k]
      if (rule) {
        if (rule !== 'info') out.push({ where, field: k, rule, value: JSON.stringify(v).slice(0, 40) })
      } else if (typeof v === 'number' && MONEY_NAME.test(k) && !/_count$|^count|_days$|_tier$|_number$|^number$|revision|position|qty|rank|quarter|year|^n$/.test(k)) {
        out.push({ where, field: k, rule: 'unclassified', value: String(v) })
      }
    }
  }
  return out
}

// ------------------------------------------------------------------------------------------------ dates
export function karachiToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
