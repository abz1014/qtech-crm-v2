import { expect, test, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'

/*
 * The Android share target after P4: WhatsApp's Share, Q-Tech CRM posts to /capture (the service worker keeps the item for 7 days),
 * and /capture offers two things: New enquiry, or Add to job… with a job search. The sheet with six destinations is gone.
 * Run on the production build with the service worker, against the local CI stack.
 */
async function seed() {
  const customer = uniqueName('Share Customer')
  const co = await createCompany(customer, { city: 'Faisalabad' })
  const rfq = await createRfq(co.id, { due_on: karachiDay(6), customer_ref: `S${Math.floor(Math.random() * 90000 + 10000)}` })
  await must(rest('admin', 'rfq_items', { method: 'POST', body: { rfq_id: rfq.id, position: 0, description: 'Flow meter DN50', qty: 1 } }))
  return { customer, rfq }
}

/** Sign in and wait until the service worker controls the page. */
async function ready(page: Page) {
  await openAs(page, 'sales', '/todo')
  await page.locator('#main').waitFor()
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null)
}

/** What the Android share sheet does: a multipart POST navigation to /capture, answered by the service worker. */
async function share(page: Page, text: string) {
  await page.evaluate(t => {
    const form = document.createElement('form')
    form.method = 'POST'
    form.action = '/capture'
    form.enctype = 'multipart/form-data'
    const field = document.createElement('textarea')
    field.name = 'text'
    field.value = t
    form.append(field)
    document.body.append(form)
    form.submit()
  }, text)
}

test.describe('Android share target: the service worker takes the POST', () => {
  test('a shared message offers New enquiry or Add to job…, and Add to job opens that job with the message ready to add', async ({ page }) => {
    const s = await seed()
    await ready(page)
    await share(page, 'Customer says: the gate pass is needed 2 days ahead.')

    await expect(page.getByTestId('share-target')).toBeVisible()
    await expect(page.getByRole('button', { name: 'New enquiry' })).toBeVisible()
    await page.getByRole('button', { name: 'Add to job…' }).click()
    await page.getByRole('textbox', { name: 'Find the job' }).fill(s.customer)
    await page.getByRole('button', { name: new RegExp(`Job ${s.rfq.number} · ${s.customer}`) }).click()

    await expect(page).toHaveURL(new RegExp(`/jobs/${s.rfq.number}$`))
    await expect(page.getByTestId('guess-line')).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Paste here' })).toHaveValue(/gate pass is needed/)
    await page.getByRole('button', { name: 'Note', exact: true }).click()
    await page.getByRole('button', { name: 'Add note' }).click()
    await expect(page.getByRole('status').filter({ hasText: `Added to Job ${s.rfq.number}` })).toBeVisible()
    const notes = await must(rest<{ notes: string | null }[]>('admin', `rfqs?id=eq.${s.rfq.id}&select=notes`))
    expect(notes[0].notes).toContain('the gate pass is needed 2 days ahead')
  })

  test('a shared message can start a New enquiry', async ({ page }) => {
    await seed()
    await ready(page)
    await share(page, 'Please quote 2 nos level switch LSX-200 24V.')
    await page.getByRole('button', { name: 'New enquiry' }).click()
    await expect(page).toHaveURL(/\/enquiries\/new$/)
    await expect(page.getByRole('textbox', { name: 'Description of item 1' })).toHaveValue(/level switch LSX-200/i)
  })

  test('the shared item survives a sign-in redirect and the choice is offered afterwards', async ({ page }) => {
    await seed()
    await ready(page)
    // signed out in the middle: drop the session, keep the device (service worker and IndexedDB)
    await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('sb-')).forEach(k => localStorage.removeItem(k)))
    await share(page, 'Reply: line size is 4 inch.')
    await page.waitForURL(/\/login/)
    await expect(page.getByText('Your shared item is safe')).toBeVisible()
    await page.getByLabel('Email').fill('sales@test.invalid')
    await page.getByLabel('Password', { exact: true }).fill('fixture-only-password')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByTestId('share-target')).toBeVisible()
    await expect(page.getByText('Reply: line size is 4 inch.')).toBeVisible()
    await expect(page.getByText('Your shared item is back')).toBeVisible()
  })

  test('an item older than 7 days is gone, and the page says so', async ({ page }) => {
    await seed()
    await ready(page)
    const id = await page.evaluate(
      () =>
        new Promise<string>((resolve, reject) => {
          const id = crypto.randomUUID()
          const open = indexedDB.open('qtech-capture', 1)
          open.onupgradeneeded = () => open.result.createObjectStore('items', { keyPath: 'id' })
          open.onsuccess = () => {
            const tx = open.result.transaction('items', 'readwrite')
            const old = Date.now() - 8 * 86_400_000
            tx.objectStore('items').put({ id, createdAt: old, expiresAt: old + 7 * 86_400_000, source: 'share', text: 'old', files: [] })
            tx.oncomplete = () => resolve(id)
            tx.onerror = () => reject(tx.error)
          }
        }),
    )
    await page.goto(`/capture?share=${id}`)
    await expect(page.getByTestId('share-gone')).toContainText('no longer on this device')
    await page.getByRole('button', { name: 'Open Jobs' }).click()
    await expect(page).toHaveURL(/\/jobs$/)
  })
})
