import { expect, test, type Page } from '@playwright/test'
import { axeViolations } from '../support/axe'
import { createCompany, createRfq, karachiDay, must, openAs, review, rest, rfqRef, uniqueName } from '../support/stack'

/*
 * R22: every frame of docs/design/mockups/g2-capture.html, photographed from the running app (REVIEW_DIR) at 375 and 1440, with
 * the words of each state asserted. Nothing here changes data except where a frame is a saved state.
 *
 *   Android 1-4 (shared photo and text, saved)          iPhone 1-5 (empty zone, pasted, saved)
 *   The destinations a, b, c, d, e                       Signed out in the middle (sign-in, back in the sheet, after 7 days)
 *   Desktop (nothing added, drag over, added, over the limit)
 *   Photos and limits (resizing, over 5 MB, offline, could not save)
 */
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PNG = Buffer.from(PNG_B64, 'base64')

async function seed() {
  const customer = uniqueName('Capture Frames')
  const co = await createCompany(customer, { city: 'Faisalabad' })
  const rfq = await createRfq(co.id, { due_on: karachiDay(6), customer_ref: `F${Math.floor(Math.random() * 90000 + 10000)}` })
  await must(rest('admin', 'rfq_items', { method: 'POST', body: { rfq_id: rfq.id, position: 0, description: 'Flow meter DN50', qty: 1 } }))
  const asked = new Date(Date.now() - 6 * 86_400_000).toISOString()
  for (const question of ['Line size and flange rating on the process line for item 2', 'Fluid temperature range, and whether the meter sees CIP cleaning']) {
    await must(rest('admin', 'clarifications', { method: 'POST', body: { rfq_id: rfq.id, question, ask_count: 1, first_asked_at: asked, last_asked_at: asked } }))
  }
  const supplier = await createCompany(uniqueName('Lahore Process Controls'), { country: 'Pakistan' })
  await must(rest('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: rfq.id, supplier_id: supplier.id, sent_on: karachiDay(-3) } }))
  return { rfq, customer, co }
}

async function ready(page: Page, rfqId: string) {
  await openAs(page, 'sales', `/rfqs/${rfqId}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null)
  await page.goto('/today')
  await page.locator('#main').waitFor()
}

const sheet = (page: Page) => page.getByRole('dialog', { name: 'Capture' })
const settle = (page: Page) => page.waitForTimeout(450)

async function paste(page: Page, text: string, files: { name: string; type: string }[] = []) {
  await page.evaluate(
    ({ text, files, b64 }) => {
      const dt = new DataTransfer()
      if (text) dt.setData('text/plain', text)
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
      for (const f of files) dt.items.add(new File([bytes], f.name, { type: f.type }))
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    },
    { text, files, b64: PNG_B64 },
  )
}

async function share(page: Page, text: string, files: { name: string; type: string }[] = []) {
  await page.evaluate(
    ({ text, files, b64 }) => {
      const form = document.createElement('form')
      form.method = 'POST'
      form.action = '/capture'
      form.enctype = 'multipart/form-data'
      if (text) {
        const t = document.createElement('textarea')
        t.name = 'text'
        t.value = text
        form.append(t)
      }
      if (files.length) {
        const input = document.createElement('input')
        input.type = 'file'
        input.name = 'files'
        input.multiple = true
        const dt = new DataTransfer()
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
        for (const f of files) dt.items.add(new File([bytes], f.name, { type: f.type }))
        input.files = dt.files
        form.append(input)
      }
      document.body.append(form)
      form.submit()
    },
    { text, files, b64: PNG_B64 },
  )
}

const MESSAGE = 'Line size is 4 inch, flange PN16.\nFluid is hot water, 5 to 85 C. Yes, it sees CIP at 90 C twice a week.'

for (const [name, size] of [
  ['375', { width: 375, height: 812 }],
  ['1440', { width: 1440, height: 900 }],
] as const) {
  test.describe(`the frames at ${name}`, () => {
    test.use({ viewport: size })

    test('Android: shared text and photo, the checked sheet, saved', async ({ page }) => {
      const s = await seed()
      await ready(page, s.rfq.id)
      await share(page, MESSAGE, [{ name: 'nameplate-photo.png', type: 'image/png' }])
      await expect(sheet(page)).toBeVisible()
      const dlg = sheet(page)
      await expect(dlg.getByText('1 message · 1 photo')).toBeVisible()
      await expect(page.getByRole('radio', { name: /Answer a question/ })).toBeChecked()
      await expect(dlg.getByText('Recent', { exact: true })).toBeVisible()
      await expect(dlg.getByText(/Opened .* · 2 open questions/)).toBeVisible()
      await expect(dlg.getByText(/RFQ-\d+ · Capture Frames .* — Faisalabad/)).toBeVisible()
      await expect(dlg.getByText('Search all RFQs')).toBeVisible()
      await expect(dlg.getByText(/Answers 2 open questions on RFQ-\d+: line size and flange rating, fluid temperature range\. Untick any that this does not answer\./)).toBeVisible()
      await expect(dlg.getByText(/Asked \w{3} \d{1,2} \w{3}/).first()).toBeVisible()
      if (name === '375') await expect(dlg.getByText('Shared from WhatsApp')).toBeVisible()
      await settle(page)
      await review(page, `capture-frame-android-check-${name}`)
      await dlg.getByRole('button', { name: 'Save answer to 2 questions' }).click()
      await expect(dlg.getByRole('heading', { name: `Saved to ${rfqRef(s.rfq.number)}` })).toBeVisible()
      await expect(dlg.getByText(/2 questions answered and 1 photo attached\. They now wait on Today to be relayed\./)).toBeVisible()
      await expect(dlg.getByText('Answers to relay')).toBeVisible()
      for (const b of ['Open ' + rfqRef(s.rfq.number), 'Capture another', 'Done']) await expect(dlg.getByRole('button', { name: b })).toBeVisible()
      await expect(page.getByRole('status').filter({ hasText: '2 questions answered' }).getByRole('button', { name: /Undo/ })).toBeVisible()
      await settle(page)
      await review(page, `capture-frame-saved-${name}`)
    })

    test('the destinations: photo, questions, notes, new RFQ', async ({ page }) => {
      const s = await seed()
      await ready(page, s.rfq.id)
      // e: a photo alone
      await paste(page, '', [{ name: 'nameplate-photo.png', type: 'image/png' }])
      await expect(page.getByRole('radio', { name: /Answer with photo/ })).toBeChecked()
      await expect(sheet(page).getByText(/Answers 1 open question on RFQ-\d+: line size and flange rating\. The photo is attached as the reply\. Tick another to answer it too\./)).toBeVisible()
      await expect(sheet(page).getByRole('button', { name: 'Save photo as the answer' })).toBeEnabled()
      await settle(page)
      await review(page, `capture-frame-destination-photo-${name}`)
      await page.getByRole('button', { name: 'Remove nameplate-photo.png' }).click()
      // b: several questions
      await paste(page, 'Dear Sir, for the Belimo quote please confirm:\n1. Valve size and Kvs\n2. Actuator torque and supply voltage\n3. Fail-safe position on power loss\n4. Medium and maximum temperature')
      await page.getByRole('radio', { name: /New supplier questions/ }).click()
      await expect(sheet(page).getByText('Tick the ones to keep')).toBeVisible()
      await expect(sheet(page).getByText('Each line becomes one question on the RFQ, ready to put to the customer.')).toBeVisible()
      await settle(page)
      await review(page, `capture-frame-destination-questions-${name}`)
      await sheet(page).getByRole('textbox', { name: 'Captured text' }).fill('')
      // c: notes
      await paste(page, 'Customer will send the P&ID on Monday. Plant shutdown is 12 to 14 Dec, so delivery must be before 10 Dec.')
      await page.getByRole('radio', { name: /Add to RFQ notes/ }).click()
      await expect(sheet(page).getByText(/Added to the notes of RFQ-\d+ as written, with your name and the time: “Test Sales, /)).toBeVisible()
      await expect(sheet(page).getByRole('button', { name: 'Add to notes' })).toBeVisible()
      await settle(page)
      await review(page, `capture-frame-destination-notes-${name}`)
      // d: a new RFQ
      await page.getByRole('radio', { name: /Start a new RFQ/ }).click()
      await sheet(page).getByLabel('Which company?').fill(s.customer)
      await expect(page.getByRole('option', { name: new RegExp(`${s.customer} — Faisalabad`) })).toBeVisible()
      await settle(page)
      await review(page, `capture-frame-destination-new-rfq-${name}`)
      await page.getByRole('option', { name: new RegExp(s.customer) }).click()
      await expect(sheet(page).getByText('Intake opens with this text and the company already filled in. Nothing is saved until you create the RFQ.')).toBeVisible()
      await expect(sheet(page).getByRole('button', { name: 'Continue to intake' })).toBeEnabled()
      await expect(sheet(page).getByText('Search all RFQs')).toHaveCount(0)
    })

    test('photos, size limits and failures', async ({ page }) => {
      const s = await seed()
      // a photo that takes a moment to resize shows the Resizing row
      await page.addInitScript(() => {
        const original = window.createImageBitmap.bind(window)
        ;(window as unknown as { createImageBitmap: unknown }).createImageBitmap = async (...a: unknown[]) => {
          await new Promise(r => setTimeout(r, 2500))
          return (original as (...x: unknown[]) => Promise<ImageBitmap>)(...a)
        }
      })
      await ready(page, s.rfq.id)
      await paste(page, MESSAGE, [{ name: 'wiring-photo.png', type: 'image/png' }])
      await expect(sheet(page).getByText('Resizing')).toBeVisible()
      await settle(page)
      await review(page, `capture-frame-resizing-${name}`)
      await expect(sheet(page).getByText('Resizing')).toHaveCount(0)

      // over the limit: a PDF and a photo that does not shrink
      await sheet(page).locator('input[aria-label="Add more files"], input[aria-label="Choose files"]').first().setInputFiles([
        { name: 'datasheet-scan.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(Math.round(7.2 * 1024 * 1024), 1) },
        { name: 'site-photo.png', mimeType: 'image/png', buffer: Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(Math.round(6.3 * 1024 * 1024), 7)]) },
      ])
      const dlg = sheet(page)
      if (name === '1440') {
        await expect(dlg.getByText(/datasheet-scan\.pdf is 7\.2 MB\. Files can be up to 5 MB\./)).toBeVisible()
        await expect(dlg.getByText('Photos are shrunk for you; PDFs are not. Remove it, or add a smaller file. The rest can still be saved.').first()).toBeVisible()
      } else {
        await expect(dlg.getByText('datasheet-scan.pdf is too large')).toBeVisible()
        await expect(dlg.getByText('PDFs are not shrunk. Remove it, or scan at a lower quality.')).toBeVisible()
      }
      await expect(dlg.getByText(/7\.2 MB\. The limit is 5 MB\./)).toBeVisible()
      await expect(dlg.getByText(/Still 6\.3 MB after resizing\. The limit is 5 MB\./)).toBeVisible()
      await settle(page)
      await review(page, `capture-frame-limits-${name}`)
      expect(await axeViolations(page)).toEqual([])

      // offline
      await page.context().setOffline(true)
      await expect(dlg.getByText('You are offline')).toBeVisible()
      await expect(dlg.getByText('Your capture is kept on this phone. Save when you are back online.')).toBeVisible()
      await expect(dlg.getByRole('button', { name: 'Save answer to 2 questions' })).toBeDisabled()
      await review(page, `capture-frame-offline-${name}`)
      await page.context().setOffline(false)
      await expect(dlg.getByText('You are offline')).toHaveCount(0)

      // could not save: the write is refused, the capture stays
      await page.route('**/rest/v1/clarifications*', route => route.abort())
      await dlg.getByRole('button', { name: 'Save answer to 2 questions' }).click()
      await expect(dlg.getByText('Couldn’t save')).toBeVisible()
      await expect(dlg.getByText('Nothing was changed and your capture is still here.')).toBeVisible()
      await expect(dlg.getByRole('button', { name: 'Try again' })).toBeVisible()
      await review(page, `capture-frame-save-failed-${name}`)
      await expect(dlg.getByRole('textbox', { name: 'Captured text' })).toHaveValue(/Line size is 4 inch/)
    })
  })
}

test.describe('desktop frames at 1440', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('nothing added, a file over the window, added and ready', async ({ page }) => {
    const s = await seed()
    await ready(page, s.rfq.id)
    await page.getByRole('button', { name: 'Capture' }).first().click()
    const dlg = sheet(page)
    await expect(dlg.getByText('Text, photos and files from WhatsApp or anywhere else. Choose where they go.')).toBeVisible()
    await expect(dlg.getByText('Drop text, photos or files here')).toBeVisible()
    await expect(dlg.getByText('to paste what you copied in WhatsApp Desktop')).toBeVisible()
    await expect(dlg.getByText('You choose after you add something.')).toBeVisible()
    await expect(dlg.getByText('Nothing to save yet')).toBeVisible()
    await expect(dlg.getByRole('button', { name: 'Save answer to 2 questions' })).toBeDisabled()
    await expect(dlg.getByRole('button', { name: 'Choose photos' }).first()).toBeVisible()
    await expect(dlg.getByRole('button', { name: 'Choose files' }).first()).toBeVisible()
    await settle(page)
    await review(page, 'capture-frame-desktop-empty-1440')

    await page.evaluate(b64 => {
      const dt = new DataTransfer()
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
      dt.items.add(new File([bytes], 'nameplate-photo.png', { type: 'image/png' }))
      dt.items.add(new File([bytes], 'datasheet.pdf', { type: 'application/pdf' }))
      document.body.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }))
    }, PNG_B64)
    await expect(dlg.getByText('Release to add 2 files')).toBeVisible()
    await review(page, 'capture-frame-desktop-drag-1440')
    await page.evaluate(() => document.body.dispatchEvent(new DragEvent('dragleave', { bubbles: true })))
    await expect(dlg.getByText('Release to add 2 files')).toHaveCount(0)

    await paste(page, MESSAGE, [{ name: 'nameplate-photo.png', type: 'image/png' }])
    await expect(dlg.getByText('1 text · 1 photo')).toBeVisible()
    await expect(dlg.getByText('Drop or paste more. Up to 5 MB each.')).toBeVisible()
    await expect(dlg.getByText('saves')).toBeVisible()
    await settle(page)
    await review(page, 'capture-frame-desktop-added-1440')
  })
})

test.describe('signed out in the middle', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('sign-in says the item is safe and what is kept; back in the sheet; after 7 days', async ({ page }) => {
    const s = await seed()
    await ready(page, s.rfq.id)
    await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('sb-')).forEach(k => localStorage.removeItem(k)))
    await share(page, MESSAGE, [{ name: 'nameplate-photo.png', type: 'image/png' }])
    await page.waitForURL(/\/login/)
    await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible()
    await expect(page.getByText('You were signed out.')).toBeVisible()
    await expect(page.getByText('Your shared item is safe')).toBeVisible()
    await expect(page.getByText('1 message and 1 photo')).toBeVisible()
    await expect(page.getByText(/Kept on this phone until \w{3} \d{1,2} \w{3}/)).toBeVisible()
    await review(page, 'capture-frame-signed-out-login-375')
    await page.getByLabel('Email').fill('sales@test.invalid')
    await page.getByLabel('Password', { exact: true }).fill('fixture-only-password')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(sheet(page)).toBeVisible()
    await expect(page.getByText('Choose where it goes to finish.')).toBeVisible()
    await settle(page)
    await review(page, 'capture-frame-signed-out-back-375')
  })
})

test.describe('after 7 days', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('the screen says the item is gone and offers Open Capture', async ({ page }) => {
    const s = await seed()
    await ready(page, s.rfq.id)
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
    await expect(sheet(page).getByText('The shared item is no longer on this phone')).toBeVisible()
    await expect(sheet(page).getByText('Shared items are kept for 7 days. Share it again from WhatsApp, or paste it.')).toBeVisible()
    await settle(page)
    await review(page, 'capture-frame-expired-375')
    await sheet(page).getByRole('button', { name: 'Open Capture' }).click()
    await expect(sheet(page).getByText('Tap and hold here, then tap Paste')).toBeVisible()
  })
})
