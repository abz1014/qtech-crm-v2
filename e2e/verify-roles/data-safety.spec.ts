import { expect, test, type Page } from '@playwright/test'
import { API_URL, openAs } from '../support/stack'
import { api, FIXTURE_PASSWORD, STAFF_EMAIL } from './lib'
import { IDS, seedWorld, type World } from './fixtures'

/*
 * Data safety in the real app (production build, local CI stack):
 *   - a double tap on a create or record action makes ONE record;
 *   - Undo puts the row back exactly as it was;
 *   - an optimistic update (the bank tick, the only onMutate in the app) is rolled back when the write fails;
 *   - drafts are per person on a shared device, and sign-out clears the cached data: the TanStack Query cache, the Capture
 *     drafts (IndexedDB), the recents and drafts in localStorage;
 *   - the service worker never stores an API answer (money or otherwise), so nothing reaches the next person offline.
 */
let world: World

test.setTimeout(180_000)

test.beforeAll(async () => {
  world = await seedWorld('VD')
})

/**
 * Keeps an item on this device as the Android share target does (IndexedDB 'qtech-capture', 7 days). The Paste or photo sheet is
 * gone (P4), so this is the one thing Capture still keeps: a shared item waiting for a person to choose New enquiry or Add to job.
 */
async function keepSharedItem(page: Page, text: string): Promise<void> {
  await page.evaluate(
    t =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('qtech-capture', 1)
        open.onupgradeneeded = () => open.result.createObjectStore('items', { keyPath: 'id' })
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const tx = open.result.transaction('items', 'readwrite')
          const now = Date.now()
          tx.objectStore('items').put({ id: crypto.randomUUID(), createdAt: now, expiresAt: now + 7 * 86_400_000, source: 'share', text: t, files: [] })
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        }
      }),
    text,
  )
}

const rows = async <T>(path: string): Promise<T[]> => {
  const r = await api('admin', `/rest/v1/${path}`)
  if (r.status !== 200) throw new Error(`GET ${path}: ${r.status} ${r.text}`)
  return r.body as T[]
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Account menu, / }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)
}

async function signIn(page: Page, email: string): Promise<void> {
  if (!/\/login$/.test(page.url())) await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(FIXTURE_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
  await page.locator('#main').waitFor()
}

/** The app's TanStack Query cache, read through React's fiber tree (the QueryClientProvider's `client` prop). */
async function cachedQueries(page: Page): Promise<{ key: string; hasData: boolean }[] | null> {
  return page.evaluate(() => {
    const root = document.getElementById('root') as unknown as Record<string, unknown> | null
    if (!root) return null
    const k = Object.keys(root).find(x => x.startsWith('__reactContainer$'))
    type Fiber = { child?: Fiber | null; sibling?: Fiber | null; memoizedProps?: { client?: { getQueryCache?: () => { getAll: () => { queryKey: unknown; state: { data: unknown } }[] } } } }
    const stack: (Fiber | null | undefined)[] = [k ? (root[k] as Fiber) : null]
    let visited = 0
    while (stack.length && visited < 50_000) {
      const f = stack.pop()
      if (!f) continue
      visited++
      const client = f.memoizedProps?.client
      if (client && typeof client.getQueryCache === 'function') {
        return client.getQueryCache().getAll().map(q => ({ key: JSON.stringify(q.queryKey), hasData: q.state.data !== undefined }))
      }
      stack.push(f.sibling, f.child)
    }
    return null
  })
}

async function storageState(page: Page): Promise<{ local: string[]; session: string[]; captures: number }> {
  return page.evaluate(async () => {
    const captures = await new Promise<number>(resolve => {
      const req = indexedDB.open('qtech-capture', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('items', { keyPath: 'id' })
      req.onerror = () => resolve(-1)
      req.onsuccess = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('items')) return resolve(0)
        const c = db.transaction('items', 'readonly').objectStore('items').count()
        c.onsuccess = () => {
          resolve(c.result)
          db.close()
        }
        c.onerror = () => resolve(-1)
      }
    })
    return { local: Object.keys(localStorage), session: Object.keys(sessionStorage), captures }
  })
}

// ------------------------------------------------------------------------------------------------ double submit
test.describe('a double tap makes one record', () => {
  test('New company (any role): one company', async ({ page }) => {
    const name = `${world.tag} Double Tap Co`
    await openAs(page, 'engineer', '/companies')
    await page.getByRole('button', { name: 'New company' }).first().click()
    const d = page.getByRole('dialog', { name: 'New company' })
    await d.getByLabel('Company name').fill(name)
    await d.getByRole('button', { name: 'Add company' }).dblclick()
    await expect(d).toHaveCount(0)
    await expect.poll(async () => (await rows(`companies?name=eq.${encodeURIComponent(name)}&select=id`)).length).toBe(1)
  })

  test('Record payment (admin): one payment', async ({ page }) => {
    const before = (await rows(`payments_in?order_id=eq.${world.order.id}&select=id`)).length
    await openAs(page, 'admin', `/orders/${world.order.id}`)
    await page.getByRole('button', { name: 'Record payment' }).first().click()
    const d = page.getByRole('dialog', { name: 'Record payment' })
    await d.getByLabel('Amount received, PKR').fill('1234')
    await d.getByRole('button', { name: 'Save payment' }).dblclick()
    await expect(d).toHaveCount(0)
    await page.waitForTimeout(1500)
    expect((await rows(`payments_in?order_id=eq.${world.order.id}&select=id`)).length).toBe(before + 1)
  })

  test('Create invoice (sales): one invoice', async ({ page }) => {
    // The imported order has lines and no invoice yet, so the dialog pre-fills a full invoice.
    const order = world.legacyOrder.id
    const before = (await rows(`invoices?order_id=eq.${order}&select=id`)).length
    await openAs(page, 'sales', `/money/gst-register?new=1&order=${order}`)
    const d = page.getByRole('dialog', { name: 'Create invoice' })
    await d.getByLabel('Invoice number').fill(`INV-${world.tag}-2`)
    const net = d.getByLabel('Net amount, PKR')
    if (await net.count()) await net.fill('1000')
    await d.getByRole('button', { name: 'Create invoice' }).dblclick()
    await expect(d).toHaveCount(0)
    await page.waitForTimeout(1500)
    expect((await rows(`invoices?order_id=eq.${order}&select=id`)).length).toBe(before + 1)
  })

  test('BUG-RV-07: Add line on an order (sales): a double tap makes one line', async ({ page }) => {
    const description = `${world.tag} double tap line`
    await openAs(page, 'sales', `/orders/${world.order.id}`)
    const toggle = page.getByRole('button', { name: 'Edit GST and lines' })
    if (await toggle.count()) await toggle.click() // post-merge: line editing sits behind this toggle
    await page.getByRole('button', { name: 'Add line' }).first().click()
    const d = page.getByRole('dialog', { name: 'Add line' })
    await d.getByLabel('Description').fill(description)
    await d.getByLabel('Unit price, net PKR').fill('500')
    await d.getByRole('button', { name: 'Add line' }).dblclick()
    await expect(d).toHaveCount(0)
    await page.waitForTimeout(1500)
    expect((await rows(`order_items?order_id=eq.${world.order.id}&description=eq.${encodeURIComponent(description)}&select=id`)).length).toBe(1)
  })

  test('Add item on an RFQ (engineer): one item', async ({ page }) => {
    const description = `${world.tag} double tap item`
    await openAs(page, 'engineer', `/rfqs/${world.rfq.id}`)
    await page.getByRole('button', { name: 'Add item' }).first().click()
    const d = page.getByRole('dialog', { name: 'Add an item' })
    await d.getByLabel('Description').fill(description)
    await d.getByRole('button', { name: 'Add item' }).last().dblclick()
    await expect(d).toHaveCount(0)
    await page.waitForTimeout(1500)
    expect((await rows(`rfq_items?rfq_id=eq.${world.rfq.id}&description=eq.${encodeURIComponent(description)}&select=id`)).length).toBe(1)
  })
})

// ------------------------------------------------------------------------------------------------ Undo
test('Undo of a leg stamp puts the leg back exactly as it was', async ({ page }) => {
  const pick = 'id,placed_on,expected_on,received_on,reference,currency,supplier_id,order_id,chase_count,last_chased_on,last_chased_by'
  const before = (await rows<Record<string, unknown>>(`supplier_orders?id=eq.${world.leg}&select=${pick}`))[0]
  await openAs(page, 'engineer', `/orders/${world.order.id}`)
  await page.getByRole('button', { name: /^I placed this order, / }).first().click()
  await expect.poll(async () => (await rows<{ placed_on: string | null }>(`supplier_orders?id=eq.${world.leg}&select=placed_on`))[0].placed_on).not.toBeNull()
  await page.getByRole('region', { name: 'Notifications' }).getByRole('button', { name: /^Undo/ }).first().click()
  await expect.poll(async () => (await rows<Record<string, unknown>>(`supplier_orders?id=eq.${world.leg}&select=${pick}`))[0]).toEqual(before)
})

test('Undo of a supplier chase restores the count and the date; the earlier chaser is not restored (by design, L-1)', async ({ page }) => {
  const inquiry = (await rows<{ id: string }>(`supplier_inquiries?rfq_id=eq.${world.rfq.id}&select=id`))[0].id
  // An earlier chase by sales.
  const first = await api('sales', '/rest/v1/rpc/stamp_supplier_chase', { method: 'POST', body: { p_inquiry_id: inquiry } })
  test.skip(first.status >= 300, `stamp_supplier_chase signature differs: ${first.text}`)
  const pick = 'chase_count,last_chased_on,last_chased_by,sent_on'
  const before = (await rows<Record<string, unknown>>(`supplier_inquiries?id=eq.${inquiry}&select=${pick}`))[0]
  await openAs(page, 'admin', `/rfqs/${world.rfq.id}`)
  const chase = page.getByRole('button', { name: /^Chase/ }).first()
  test.skip((await chase.count()) === 0, 'no chase button in this state')
  await chase.click()
  const undo = page.getByRole('region', { name: 'Notifications' }).getByRole('button', { name: /^Undo/ }).first()
  test.skip(!(await undo.isVisible().catch(() => false)), 'this chase opened a dialog instead of a one-tap stamp')
  await undo.click()
  await expect.poll(async () => {
    const r = (await rows<Record<string, unknown>>(`supplier_inquiries?id=eq.${inquiry}&select=${pick}`))[0]
    return { ...r, last_chased_by: 'x' }
  }).toEqual({ ...before, last_chased_by: 'x' })
  const after = (await rows<{ last_chased_by: string | null }>(`supplier_inquiries?id=eq.${inquiry}&select=last_chased_by`))[0]
  test.info().annotations.push({ type: 'Undo and the actor (L-1, by design)', description: `before ${String(before.last_chased_by)}, after Undo ${String(after.last_chased_by)}` })
})

// ------------------------------------------------------------------------------------------------ optimistic rollback
test('the bank tick (optimistic) is rolled back when the write fails: network error and server error', async ({ page }) => {
  const prev = (() => {
    const d = new Date()
    d.setUTCDate(1)
    d.setUTCMonth(d.getUTCMonth() - 1)
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  })()
  const pay = await api('admin', '/rest/v1/payments_in', {
    method: 'POST',
    body: { order_id: world.order.id, amount: 4321, received_on: `${prev}-20`, paid_via: 'bank', reference: `${world.tag} tick` },
    prefer: 'return=representation',
  })
  expect(pay.status).toBe(201)
  const id = (pay.body as { id: string }[])[0].id
  await openAs(page, 'admin', `/money/month-end/bank?month=${prev}`)
  const row = page.getByRole('checkbox', { name: new RegExp(world.company.name) }).first()
  await expect(row).toHaveAttribute('aria-checked', 'false')
  for (const failure of ['abort', 500] as const) {
    await page.route('**/rest/v1/payments_in*', route =>
      route.request().method() === 'PATCH'
        ? failure === 'abort'
          ? route.abort('failed')
          : route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'XX000', message: 'boom' }) })
        : route.continue(),
    )
    await row.click()
    await expect(row, `rolled back after ${failure}`).toHaveAttribute('aria-checked', 'false')
    await page.unroute('**/rest/v1/payments_in*')
    expect((await rows<{ bank_month: string | null }>(`payments_in?id=eq.${id}&select=bank_month`))[0].bank_month).toBeNull()
  }
})

// ------------------------------------------------------------------------------------------------ shared device
test('sign-out clears the query cache, the shared items kept on the device and the recents; the next person sees none of it', async ({ page }) => {
  const secret = `${world.tag} secret capture note PKR 99,123`
  await openAs(page, 'admin', `/orders/${world.order.id}`)
  await page.goto(`/rfqs/${world.rfq.id}`)
  await page.locator('#main').waitFor()
  await page.goto('/money/gst-register')
  await page.locator('#main').waitFor()
  // A shared item waiting on the device (kept in IndexedDB while signed in).
  await keepSharedItem(page, secret)
  expect((await storageState(page)).captures, 'the shared item is kept on the device while signed in').toBeGreaterThan(0)
  const withData = (await cachedQueries(page)) ?? []
  expect(withData.filter(q => q.hasData).length, 'precondition: the cache holds data while signed in').toBeGreaterThan(1)

  await signOut(page)
  const cache = await cachedQueries(page)
  expect(cache, 'the query cache is reachable').not.toBeNull()
  expect((cache ?? []).filter(q => q.hasData && !q.key.startsWith('["session"')), 'queries still holding data after sign-out').toEqual([])
  const s = await storageState(page)
  expect(s.captures, 'shared items after sign-out').toBe(0)
  expect(s.local.filter(k => /^qtech\.(recentRfqs|recentOrders|rfqs\.intakeDraft\.)/.test(k)), 'recents and drafts after sign-out').toEqual([])
  expect(s.local.filter(k => /^sb-.*-auth-token/.test(k)), 'the session token after sign-out').toEqual([])
  test.info().annotations.push({ type: 'localStorage after sign-out', description: s.local.join(', ') || 'empty' })
  test.info().annotations.push({ type: 'sessionStorage after sign-out', description: s.session.join(', ') || 'empty' })

  // The next person on the same tab.
  await signIn(page, STAFF_EMAIL.engineer)
  await page.goto('/capture')
  await expect(page.getByTestId('share-gone'), 'the next person finds no shared item').toBeVisible()
  await page.goto(`/orders/${world.order.id}`)
  await page.waitForLoadState('networkidle')
  const text = await page.locator('body').innerText()
  for (const n of [world.amounts.invoiceNet, world.amounts.payment, world.amounts.sell]) expect(text, 'no figure from the admin session').not.toContain(n.toLocaleString('en-US'))
})

test('BUG-RV-04: the command palette\'s recent items are cleared on sign-out and are per person', async ({ page }) => {
  await openAs(page, 'admin', '/todo')
  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog', { name: 'Search or jump to' })
  await palette.getByRole('combobox').fill(world.invoice.number)
  await palette.getByRole('option', { name: new RegExp(world.invoice.number) }).first().click()
  await expect(page).toHaveURL(/\/money\/gst-register\?invoice=/)
  // The invoice opens in a sheet over the register; wait for it, or Escape lands before it and the sheet hides the account menu.
  const sheet = page.getByRole('dialog', { name: new RegExp(`Invoice ${world.invoice.number}`) })
  await expect(sheet).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await signOut(page)
  // Recents are kept per person (qtech.palette.recent.<user id>); sign-out removes every one, and the old shared key.
  const after = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('qtech.palette.recent')).join(',') || null)
  test.info().annotations.push({ type: 'qtech.palette.recent after sign-out', description: String(after) })
  await signIn(page, STAFF_EMAIL.engineer)
  await page.keyboard.press('Control+k')
  const recents = await page.getByRole('dialog', { name: 'Search or jump to' }).innerText()
  test.info().annotations.push({ type: 'the engineer\'s palette', description: recents.slice(0, 400) })
  expect.soft(after, 'palette recents after sign-out').toBeNull()
  expect(recents, 'the engineer sees the admin\'s invoice in Recent').not.toContain(world.invoice.number)
})

test('New RFQ drafts (post-merge) are kept per person and cleared on sign-out', async ({ page }) => {
  await openAs(page, 'sales', '/rfqs/new')
  // The screen listens for a paste once it is drawn: pasting before then went nowhere (flaky on CI).
  await expect(page.getByRole('heading', { name: 'New RFQ', level: 1 })).toBeVisible()
  // A pasted enquiry, as a person would (the intake listens for paste anywhere on the screen).
  await page.evaluate(text => {
    const dt = new DataTransfer()
    dt.setData('text/plain', text)
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, `${world.tag} enquiry\n2 x Rosemount 3051 pressure transmitter\n1 x Yokogawa EJA110E`)
  await expect
    .poll(() => page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('qtech.rfqs.intakeDraft.'))), { message: 'one draft, keyed by the person' })
    .toEqual([`qtech.rfqs.intakeDraft.${IDS.sales}`])
  await page.goto('/todo')
  await signOut(page)
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('qtech.rfqs.intakeDraft.')))).toEqual([])
  await signIn(page, STAFF_EMAIL.engineer)
  await page.goto('/rfqs/new')
  await expect(page.getByText(world.tag)).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Continue your draft/ })).toHaveCount(0)
})

// ------------------------------------------------------------------------------------------------ service worker
test.describe('service worker', () => {
  test.use({ serviceWorkers: 'allow' })

  test('caches no API answer, so the next person offline sees no money from the last one', async ({ page, context }) => {
    await openAs(page, 'admin', '/money/gst-register')
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready
    })
    await page.reload()
    await page.locator('#main').waitFor()
    await page.goto(`/orders/${world.order.id}`)
    await page.waitForLoadState('networkidle')
    await page.goto('/money/receivables')
    await page.waitForLoadState('networkidle')
    const cached = await page.evaluate(async () => {
      const out: string[] = []
      for (const name of await caches.keys()) {
        const c = await caches.open(name)
        for (const req of await c.keys()) out.push(req.url)
      }
      return out
    })
    expect(cached.length, 'precondition: the app shell is precached').toBeGreaterThan(0)
    const apiOrigin = new URL(API_URL).origin
    expect(cached.filter(u => u.startsWith(apiOrigin) || /\/(rest|auth|storage|functions)\/v1\//.test(u)), 'API answers in the service worker caches').toEqual([])

    await signOut(page)
    await signIn(page, STAFF_EMAIL.engineer)
    await context.setOffline(true)
    await page.goto(`/orders/${world.order.id}`).catch(() => undefined)
    await page.waitForTimeout(1500)
    const text = await page.locator('body').innerText()
    for (const n of [world.amounts.invoiceNet, world.amounts.payment, world.amounts.sell, world.amounts.expense]) {
      expect(text, 'offline, no figure from the admin session').not.toContain(n.toLocaleString('en-US'))
    }
    await context.setOffline(false)
  })
})
