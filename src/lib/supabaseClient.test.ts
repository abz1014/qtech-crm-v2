import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLeanClient } from '@/lib/supabaseClient'

/*
 * The lean client (no Realtime) must talk to Supabase exactly as supabase-js `createClient` does. Each case sends the same
 * calls through both, over a fake network, and compares what went out: URL, method, headers and body.
 */
const URL_ = 'https://abcdefghijklmnop.supabase.co'
const LEGACY_KEY = 'eyJhbGciOiJIUzI1NiJ9.e30.anon-signature'
const PUBLISHABLE_KEY = 'sb_publishable_test_0123456789'

interface Sent {
  url: string
  method: string
  headers: Record<string, string>
  body: string | null
}

function network() {
  const sent: Sent[] = []
  const fetchFn: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const headers = Object.fromEntries([...new Headers(init?.headers).entries()].filter(([k]) => k !== 'x-client-info'))
    sent.push({ url, method: init?.method ?? 'GET', headers, body: typeof init?.body === 'string' ? init.body : init?.body ? '[body]' : null })
    const body = url.includes('/storage/v1/object/sign/') ? { signedURL: '/object/sign/files/a.pdf?token=t' } : url.includes('/functions/v1/') ? { ok: true } : []
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return { sent, fetchFn }
}

async function sameCalls(key: string) {
  const lean = network()
  const full = network()
  const a = createLeanClient<never>(URL_, key, { fetch: lean.fetchFn })
  const b = createClient(URL_, key, { global: { fetch: full.fetchFn } })
  for (const c of [a, b] as const) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the same untyped calls through both clients
    const db = c as any
    await db.from('companies').select('id, name').eq('id', 'c1').order('name')
    await db.from('expenses').insert({ amount: 10 })
    await db.rpc('order_receivables', { p_order_id: 'o1' })
    await db.rpc('merge_companies', { p_keep: 'k', p_drop: 'd' }, { count: 'exact' })
    await db.storage.from('files').createSignedUrl('a.pdf', 60)
    await db.functions.invoke('admin-users', { body: { action: 'list' } })
  }
  a.auth.stopAutoRefresh()
  await b.auth.stopAutoRefresh()
  return { lean: lean.sent, full: full.sent }
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('lean Supabase client (no Realtime)', () => {
  it('sends the same requests as supabase-js with a legacy anon key (no session: the key is the bearer)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { lean, full } = await sameCalls(LEGACY_KEY)
    expect(lean).toHaveLength(6)
    expect(lean).toEqual(full)
    expect(lean[0].headers.authorization).toBe(`Bearer ${LEGACY_KEY}`)
    expect(lean[0].headers.apikey).toBe(LEGACY_KEY)
  })

  it('sends the same requests as supabase-js with a publishable key (edge functions get no key as bearer)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { lean, full } = await sameCalls(PUBLISHABLE_KEY)
    expect(lean).toEqual(full)
    const fn = lean.find(s => s.url.includes('/functions/v1/'))
    expect(fn?.headers.authorization).toBeUndefined()
  })

  it("reads the session a signed-in phone already has (same storage key) and sends that person's token", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ref = new URL(URL_).hostname.split('.')[0]
    const now = Math.floor(Date.now() / 1000)
    const session = { access_token: 'user-jwt', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user: { id: 'u1', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' } }
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session))
    const lean = network()
    const a = createLeanClient<never>(URL_, LEGACY_KEY, { fetch: lean.fetchFn })
    const full = createClient(URL_, LEGACY_KEY)
    expect((a.auth as unknown as { storageKey: string }).storageKey).toBe((full.auth as unknown as { storageKey: string }).storageKey)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped call
    await (a as any).from('companies').select('id')
    expect(lean.sent[0].headers.authorization).toBe('Bearer user-jwt')
    a.auth.stopAutoRefresh()
    await full.auth.stopAutoRefresh()
  })

  it('has no Realtime part', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const a = createLeanClient<never>(URL_, LEGACY_KEY, { fetch: network().fetchFn })
    expect('channel' in a).toBe(false)
    expect('realtime' in a).toBe(false)
    a.auth.stopAutoRefresh()
  })

  it('rejects a URL that is not http(s) and an empty key, as supabase-js does', () => {
    expect(() => createLeanClient('ftp://x.supabase.co', LEGACY_KEY)).toThrow(/HTTP or HTTPS/)
    expect(() => createLeanClient(URL_, '')).toThrow(/supabaseKey is required/)
  })

  it('the four parts are installed at the same version as supabase-js (bump all five together)', () => {
    const version = (pkg: string) => (JSON.parse(readFileSync(resolve('node_modules', pkg, 'package.json'), 'utf8')) as { version: string }).version
    const main = version('@supabase/supabase-js')
    for (const part of ['@supabase/auth-js', '@supabase/postgrest-js', '@supabase/storage-js', '@supabase/functions-js']) {
      expect(version(part), part).toBe(main)
    }
  })
})
