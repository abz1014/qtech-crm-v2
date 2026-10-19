import { expect, test, type Page } from '@playwright/test'

/*
 * R21 on the production build (vite preview): the manifest is valid and its icons are real, the service worker
 * registers and precaches the app shell only, no Supabase response is ever cached, the shell opens offline, and
 * Chrome itself reports the app installable. Chrome's check (Page.getInstallabilityErrors) is the very test the
 * Lighthouse "installable" audit ran; Lighthouse 12 dropped its PWA category, so we ask the browser directly.
 */
// With E2E_CSP=1 (every e2e suite, P04) the page's Content-Security-Policy allows the local stack, not the production project, so the test calls that origin.
const SUPABASE = process.env.E2E_CSP ? new URL(process.env.API_URL ?? 'http://127.0.0.1:54321').origin : 'https://yafbphagorydbitfgfmg.supabase.co'

interface Icon {
  src: string
  sizes: string
  type: string
  purpose?: string
}

async function activeWorker(page: Page) {
  await page.goto('/login')
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready
    if (!reg.active) throw new Error('no active worker')
  })
  // clientsClaim() takes control without a reload, but wait for it so later fetches go through the worker.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
}

test.describe('manifest', () => {
  test('is linked from the page and valid', async ({ page, request }) => {
    await page.goto('/login')
    const href = await page.locator('link[rel="manifest"]').getAttribute('href')
    expect(href).toBe('/manifest.webmanifest')

    const res = await request.get('/manifest.webmanifest')
    expect(res.ok()).toBe(true)
    const m = await res.json()
    expect(m.name).toBe('Q-Tech CRM')
    expect(m.short_name).toBe('Q-Tech')
    expect(m.display).toBe('standalone')
    expect(m.start_url).toBe('/')
    expect(m.theme_color).toBe('#1a7b46')
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i)

    // Android share target (R22): WhatsApp's Share sheet posts text, images and PDFs to /capture.
    expect(m.share_target).toMatchObject({ action: '/capture', method: 'POST', enctype: 'multipart/form-data' })
    expect(m.share_target.params.files[0]).toMatchObject({ name: 'files', accept: ['image/*', 'application/pdf'] })

    const icons: Icon[] = m.icons
    const has = (size: string, purpose: string) => icons.some(i => i.sizes === size && (i.purpose ?? 'any') === purpose && i.type === 'image/png')
    expect(has('192x192', 'any')).toBe(true)
    expect(has('512x512', 'any')).toBe(true)
    expect(has('512x512', 'maskable')).toBe(true)

    for (const icon of icons) {
      const r = await request.get(icon.src)
      expect(r.status(), icon.src).toBe(200)
      expect(r.headers()['content-type']).toContain('image/png')
      const png = await r.body()
      // PNG header: width and height are big-endian 32-bit integers at byte 16 and 20.
      const [w, h] = icon.sizes.split('x').map(Number)
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], icon.src).toEqual([w, h])
    }
  })

  test('iPhone Add to Home Screen tags are present', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/apple-touch-icon.png')
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes')
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Q-Tech')
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#1a7b46')
  })
})

test.describe('service worker', () => {
  test('registers and activates at the root scope', async ({ page }) => {
    await activeWorker(page)
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope)
    expect(scope).toBe(new URL('/', page.url()).href)
  })

  test('precaches the app shell only: same-origin built files, nothing from Supabase', async ({ page }) => {
    await activeWorker(page)
    const cached = await page.evaluate(async () => {
      const out: { cache: string; url: string }[] = []
      for (const name of await caches.keys()) {
        for (const req of await (await caches.open(name)).keys()) out.push({ cache: name, url: req.url })
      }
      return out
    })
    expect(cached.length).toBeGreaterThan(5)
    expect(new Set(cached.map(c => c.cache.replace(/-https?:.*$/, '')))).toEqual(new Set(['workbox-precache-v2']))
    const origin = new URL(page.url()).origin
    for (const { url } of cached) {
      expect(new URL(url).origin, url).toBe(origin)
      expect(url).not.toMatch(/\/(rest|auth|storage|functions|realtime)\/v1\//)
    }
    const paths = cached.map(c => new URL(c.url).pathname)
    expect(paths).toContain('/index.html')
    expect(paths).toContain('/icon-192.png')
    expect(paths).toContain('/brand/logo-mark.png')
    expect(paths.some(p => p.startsWith('/assets/') && p.endsWith('.js'))).toBe(true)
  })

  test('a Supabase request bypasses the worker cache entirely', async ({ page }) => {
    await activeWorker(page)
    let hits = 0
    await page.route(`${SUPABASE}/**`, route => {
      hits += 1
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'cache-control': 'max-age=3600' }, body: '[{"secret":"row"}]' })
    })
    for (const path of ['/rest/v1/rfqs?select=*', '/auth/v1/user', '/storage/v1/object/sign/generated-docs/q.pdf']) {
      await page.evaluate(async url => (await fetch(url, { headers: { authorization: 'Bearer test' } })).text(), SUPABASE + path)
      await page.evaluate(async url => (await fetch(url)).text(), SUPABASE + path)
    }
    expect(hits).toBe(6) // every call reached the network layer; none was answered from a cache
    const leaked = await page.evaluate(async () => {
      const urls: string[] = []
      for (const name of await caches.keys()) {
        for (const req of await (await caches.open(name)).keys()) urls.push(req.url)
      }
      return urls.filter(u => u.includes('supabase.co'))
    })
    expect(leaked).toEqual([])
  })

  test('a share-target POST is kept on the device before the app checks the session, and survives the login redirect (R22)', async ({ page }) => {
    await activeWorker(page)
    await page.evaluate(() => {
      const form = document.createElement('form')
      form.method = 'POST'
      form.action = '/capture'
      form.enctype = 'multipart/form-data'
      const text = document.createElement('input')
      text.name = 'text'
      text.value = 'Line size is 4 inch, flange PN16.'
      form.append(text)
      const file = document.createElement('input')
      file.type = 'file'
      file.name = 'files'
      const dt = new DataTransfer()
      dt.items.add(new File([new Uint8Array([1, 2, 3])], 'nameplate-photo.png', { type: 'image/png' }))
      file.files = dt.files
      form.append(file)
      document.body.append(form)
      form.submit()
    })
    // Signed out: the app sends the person to sign in, and says their item is safe.
    await page.waitForURL(/\/login/)
    await expect(page.getByText('Your shared item is safe')).toBeVisible()
    const kept = await page.evaluate(
      () =>
        new Promise<{ text: string; files: string[]; ttlDays: number }[]>((resolve, reject) => {
          const open = indexedDB.open('qtech-capture', 1)
          open.onerror = () => reject(open.error)
          open.onsuccess = () => {
            const all = open.result.transaction('items').objectStore('items').getAll()
            all.onsuccess = () =>
              resolve((all.result as { text: string; files: { name: string }[]; createdAt: number; expiresAt: number }[]).map(i => ({ text: i.text, files: i.files.map(f => f.name), ttlDays: Math.round((i.expiresAt - i.createdAt) / 86_400_000) })))
          }
        }),
    )
    expect(kept).toEqual([{ text: 'Line size is 4 inch, flange PN16.', files: ['nameplate-photo.png'], ttlDays: 7 }])
  })

  test('the shell opens offline', async ({ page, context }) => {
    await activeWorker(page)
    await context.setOffline(true)
    await page.goto('/rfqs/does-not-exist-offline')
    await expect(page).toHaveTitle(/Q-Tech CRM/)
    await expect(page.locator('#root')).not.toBeEmpty()
    await context.setOffline(false)
  })
})

test('Chrome reports the app installable', async ({ page, context }) => {
  await activeWorker(page)
  const cdp = await context.newCDPSession(page)
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors')
  expect(installabilityErrors).toEqual([])
  const { url, errors } = await cdp.send('Page.getAppManifest')
  expect(url).toContain('/manifest.webmanifest')
  expect(errors).toEqual([])
})
