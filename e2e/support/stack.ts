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

/**
 * The Job page starts with every step closed (clarity redesign); the step the job is at is only marked. Most specs were written for the
 * old page, which opened that step, and then work inside it. This opens it for them, once per page load, the way a person would tap it.
 * A spec that checks the closed state sets `window.__keepStepsClosed = true` with page.addInitScript before it opens the page.
 */
export const OPEN_CURRENT_STEP = (): void => {
  const w = window as unknown as { __keepStepsClosed?: boolean; __openCurrentStep?: boolean }
  // installed more than once on a page (a context and a page both add it): only the first one works
  if (w.__openCurrentStep) return
  w.__openCurrentStep = true
  // Each "Now" head is opened once, whenever it appears: the page may draw before its data arrives, and the step the job is at can move on
  // after an action, so one pass per page load is not enough.
  const done = new WeakSet<Element>()
  const tick = (): void => {
    const list = document.querySelector('[data-stages]')
    if (!list || w.__keepStepsClosed) return
    // opening a step can unmount the dialog that was raised from another one: wait until no dialog is open
    if (document.querySelector('[role="dialog"]')) return
    // The rows inside an opened step (Commissioning, Challans, Optional details...) are closed too: they are opened as they appear, once each,
    // because the specs were written when those panels were always drawn. Only inside a step that is open.
    for (const inner of Array.from(list.querySelectorAll('[data-fold-row] [data-fold-row] > button'))) {
      if (done.has(inner)) continue
      done.add(inner)
      if (inner.getAttribute('aria-expanded') === 'false') (inner as HTMLButtonElement).click()
    }
    const head = Array.from(list.querySelectorAll('[data-fold-row] > button')).find(b => b.querySelector('.sr-only')?.textContent === 'Now') as HTMLButtonElement | undefined
    if (!head || done.has(head)) return
    done.add(head)
    if (head.getAttribute('aria-expanded') === 'false') head.click()
  }
  new MutationObserver(tick).observe(document, { childList: true, subtree: true })
}

export async function openAs(page: Page, role: Role, path: string): Promise<void> {
  // The screen audit measures the page as it really opens (every step closed): it sets AUDIT_ROLES, and the helper stands down
  if (process.env.AUDIT_ROLES === undefined) await page.addInitScript(OPEN_CURRENT_STEP)
  await page.goto('/login')
  await page.getByLabel('Email').fill(EMAIL[role])
  await page.getByLabel('Password', { exact: true }).fill(FIXTURE_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
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
