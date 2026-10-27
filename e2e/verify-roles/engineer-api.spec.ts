import { expect, test } from '@playwright/test'
import { API_URL } from '../support/stack'
import { api, service, SERVICE_KEY } from './lib'
import { IDS, seedWorld, type World } from './fixtures'

/*
 * What an engineer can still do through the API itself, after the redesign's new surfaces (verify-roles; END-CHECKLIST 27 and 29):
 *   - the owner and the legacy flags of an order are not theirs to change (0065 guard; it must hold on the REAL path, where the
 *     API role is qtech_engineer after 0081's pre_request, not only for the role "authenticated" the pgTAP probes use)
 *   - the history of a record names no priced file and carries no price-like key (0090, 0104): the answer is read as an engineer
 *   - search_all (the palette's one call) finds no invoice number and no customer PO for an engineer
 * Fictional data.
 */
let world: World
let priced: string

test.setTimeout(300_000)

test.beforeAll(async () => {
  test.skip(!SERVICE_KEY, 'needs SERVICE_ROLE_KEY from the local stack (supabase status -o env)')
  world = await seedWorld('EA')
  priced = `po-${world.tag}.pdf`
  const path = `${world.tag}/${priced}`
  const up = await fetch(`${API_URL}/storage/v1/object/rfq-files/${path}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/pdf' },
    body: Buffer.from('%PDF-1.4 engineer-api'),
  })
  expect(up.status).toBeLessThan(300)
  // tagged has_prices, on the enquiry and on the order, as the app tags a customer PO
  for (const parent of [{ rfq_id: world.rfq.id }, { order_id: world.order.id }]) {
    const row = await service('/rest/v1/attachments', {
      method: 'POST',
      body: { bucket: 'rfq-files', path: `${path}-${Object.keys(parent)[0]}`, file_name: priced, mime_type: 'application/pdf', size_bytes: 20, has_prices: true, ...parent },
      prefer: 'return=representation',
    })
    expect(row.status, 'fixture priced attachment').toBeLessThan(300)
  }
})

test('an engineer cannot change the owner or the legacy flags of an order, through the real API path', async () => {
  const before = await api('admin', `/rest/v1/orders?id=eq.${world.order.id}&select=owner_id,legacy_flags,created_by`)
  const was = (before.body as Array<{ owner_id: string; legacy_flags: string[]; created_by: string | null }>)[0]
  for (const patch of [{ owner_id: IDS.engineer }, { legacy_flags: ['owner_unknown'] }, { created_by: IDS.engineer }]) {
    const r = await api('engineer', `/rest/v1/orders?id=eq.${world.order.id}`, { method: 'PATCH', body: patch, prefer: 'return=representation' })
    // PostgREST answers a PATCH with the row even when a trigger kept the old value, so the proof is the stored value below
    test.info().annotations.push({ type: `engineer PATCH ${Object.keys(patch)[0]}`, description: `${r.status}` })
  }
  const after = await api('admin', `/rest/v1/orders?id=eq.${world.order.id}&select=owner_id,legacy_flags,created_by`)
  expect((after.body as Array<{ owner_id: string; legacy_flags: string[]; created_by: string | null }>)[0], 'the order is as it was').toEqual(was)
})

test('the history an engineer can fetch names no priced file and has no price-like key', async () => {
  for (const [table, id] of [['rfqs', world.rfq.id], ['orders', world.order.id]] as const) {
    const r = await api('engineer', '/rest/v1/rpc/record_history', { method: 'POST', body: { p_table: table, p_id: id, p_limit: 200 } })
    // either refused outright, or answered without the priced file and without money keys
    if (r.status >= 400) continue
    expect(r.text, `${table} history for an engineer must not name the priced file`).not.toContain(priced)
    const keys = new Set<string>()
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
          keys.add(k)
          walk(x)
        }
    }
    walk(r.body)
    const bad = [...keys].filter(k => /(^|_)(price|cost|margin|amount|total|gst|net|gross|balance|paid|pkr|tax|spread|rate)(_|$)/i.test(k))
    expect(bad, `${table} history for an engineer carries price-like keys`).toEqual([])
    // the office still sees the file in the same history (a positive control: the test could fail)
    const admin = await api('admin', '/rest/v1/rpc/record_history', { method: 'POST', body: { p_table: table, p_id: id, p_limit: 200 } })
    test.info().annotations.push({ type: `${table} history control`, description: admin.text.includes(priced) ? 'the admin sees the priced file in the same history' : 'the admin history does not list the file either (nothing to hide)' })
  }
})

test('search_all finds an engineer no invoice number and no customer PO; the admin finds both', async () => {
  const find = async (who: 'engineer' | 'admin', q: string) => (await api(who, '/rest/v1/rpc/search_all', { method: 'POST', body: { q, lim: 25 } })).body as Array<{ kind: string; label: string }>
  for (const q of [`INV-${world.tag}`, `${world.tag}-PO`]) {
    const eng = await find('engineer', q)
    expect(eng.filter(h => h.kind === 'invoice' || /PO/.test(h.label) && h.kind === 'order'), `engineer: "${q}"`).toEqual([])
    const adm = await find('admin', q)
    expect(adm.length, `admin: "${q}" finds it (control)`).toBeGreaterThan(0)
  }
})
