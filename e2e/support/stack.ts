import { mkdirSync } from 'node:fs'
import type { Page } from '@playwright/test'

/*
 * Helpers for end-to-end tests against the LOCAL CI stack (supabase start + db reset). They only ever talk to
 * API_URL, which is the local stack, using the fixture users from supabase/seed.sql (@test.invalid addresses).
 * Nothing here can reach a remote project: there is no remote URL or key in this repository.
 */
export const API_URL = process.env.API_URL ?? 'http://127.0.0.1:54321'
export const ANON_KEY = process.env.ANON_KEY ?? ''
const FIXTURE_PASSWORD = 'fixture-only-password'

export type Role = 'admin' | 'sales' | 'engineer'
const EMAIL: Record<Role, string> = {
  admin: 'admin@test.invalid',
  sales: 'sales@test.invalid',
  engineer: 'engineer@test.invalid',
}

interface Session {
  access_token: string
  refresh_token: string
  expires_at: number
  [k: string]: unknown
}

const cache = new Map<Role, Session>()

export async function login(role: Role): Promise<Session> {
  const hit = cache.get(role)
  if (hit && hit.expires_at * 1000 > Date.now() + 60_000) return hit
  const res = await fetch(`${API_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL[role], password: FIXTURE_PASSWORD }),
  })
  if (!res.ok) throw new Error(`fixture sign-in failed for ${role}: ${res.status} ${await res.text()}`)
  const session = (await res.json()) as Session
  cache.set(role, session)
  return session
}

/**
 * Sign in through the real login form as a fixture user, then open `path`. Every data request the app makes
 * carries that person's token, so Row Level Security is what answers.
 */
/**
 * The shell downloads Radix (menus, dialogs, popovers) after first paint and rebuilds their triggers when it lands (AppShell sets
 * documentElement.dataset.radixReady). A click on a trigger in that gap hits a button that is then replaced ("element is not stable /
 * detached"): wait for it after a page load. Resolves quietly if the marker never comes.
 */
export async function radixReady(page: Page): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset.radixReady === '1', undefined, { timeout: 15_000 }).catch(() => undefined)
}

export async function openAs(page: Page, role: Role, path: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(EMAIL[role])
  await page.getByLabel('Password', { exact: true }).fill(FIXTURE_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
  // The specs of the old RFQ board, RFQ page, Orders list and order page keep testing those pages: they stay on until their removal
  // (src/app/oldAddresses.tsx). A spec that wants Jobs opens a /jobs address, or /rfqs?old=0.
  await page.evaluate(() => window.localStorage.setItem('qtech.old-pages', '1'))
  await page.goto(path)
  await radixReady(page)
  // The shell (and so the Ctrl+K handler) only exists once the session has resolved. Wait for it, so a key pressed right after this returns is not lost.
  await page.locator('#main').waitFor()
}

export interface RestResult<T> {
  status: number
  body: T
}

/** A PostgREST call as a fixture user. Returns the status and parsed body instead of throwing, so a test can assert a refusal. */
export async function rest<T = unknown>(role: Role, path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<RestResult<T>> {
  const session = await login(role)
  const res = await fetch(`${API_URL}/rest/v1/${path}`, {
    method: init.method ?? 'GET',
    headers: {
      apikey: ANON_KEY,
      authorization: `Bearer ${session.access_token}`,
      'content-type': 'application/json',
      prefer: init.prefer ?? 'return=representation',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const text = await res.text()
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T }
}

export async function must<T>(call: Promise<RestResult<T>>): Promise<T> {
  const r = await call
  if (r.status >= 300) throw new Error(`REST ${r.status}: ${JSON.stringify(r.body)}`)
  return r.body
}

/** A name that cannot collide with another test or an earlier run. */
export function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
}

export async function createCompany(name: string, extra: Record<string, unknown> = {}): Promise<{ id: string; name: string }> {
  const rows = await must(rest<{ id: string; name: string }[]>('admin', 'companies', { method: 'POST', body: { name, ...extra } }))
  return rows[0]
}

export async function createRfq(companyId: string, extra: Record<string, unknown> = {}): Promise<{ id: string; number: number }> {
  const rows = await must(rest<{ id: string; number: number }[]>('admin', 'rfqs', { method: 'POST', body: { company_id: companyId, ...extra } }))
  return rows[0]
}

export const rfqRef = (n: number) => `RFQ-${String(n).padStart(4, '0')}`

/** Today in the business timezone (Asia/Karachi), YYYY-MM-DD, shifted by `days`. */
export function karachiDay(days = 0): string {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' })
  const [y, m, d] = fmt.format(new Date()).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** Screenshots for the review folder, taken only when REVIEW_DIR is set (CI uploads it; nothing is written otherwise). */
export async function review(page: Page, name: string): Promise<void> {
  const dir = process.env.REVIEW_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: `${dir}/${name}.png` })
}
