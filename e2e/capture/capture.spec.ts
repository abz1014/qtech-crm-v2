import { expect, test, type Page } from '@playwright/test'
import { axeViolations } from '../support/axe'
import { createCompany, createRfq, karachiDay, must, openAs, review, rest, rfqRef, uniqueName } from '../support/stack'

/*
 * R22 (Capture) end to end on the production build, with the service worker running, against the local CI stack.
 *
 * Tap counts asserted (BUILD_PLAN A2b, D12; g2-capture.html "Tap count"). A tap is one deliberate touch; the two taps that happen
 * outside the app on Android (Share in WhatsApp, choose Q-Tech CRM) are added to the in-app clicks counted here:
 *   Android photo answer      Share (1), Q-Tech CRM (2), Save photo as the answer (3)       in-app clicks: 1, nothing typed
 *   Android text answer       the same, "Save answer to 2 questions"                        in-app clicks: 1
 *   iPhone photo answer       Capture (1), Choose photos (2, the system picker), Save (3)   in-app clicks: 3, nothing typed
 *   Desktop paste             paste anywhere (not a click), Save                            in-app clicks: 1
 */
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PNG = Buffer.from(PNG_B64, 'base64')
const PATH_FORMAT = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/

interface Clar {
  id: string
  question: string
  answer: string | null
  answered_at: string | null
  withdrawn_at: string | null
}
const clarsOf = (rfqId: string) => must(rest<Clar[]>('admin', `clarifications?rfq_id=eq.${rfqId}&select=id,question,answer,answered_at,withdrawn_at&order=created_at,id`))
const attsOf = (rfqId: string) => must(rest<{ path: string; file_name: string; clarification_id: string | null }[]>('admin', `attachments?rfq_id=eq.${rfqId}&select=path,file_name,clarification_id&order=created_at`))
const notesOf = async (rfqId: string) => (await must(rest<{ notes: string | null }[]>('admin', `rfqs?id=eq.${rfqId}&select=notes`)))[0].notes

/** An RFQ with two questions already asked of the customer, as in the design: the customer is about to reply. */
async function seed() {
  const customer = uniqueName('Capture Customer')
  const co = await createCompany(customer, { city: 'Faisalabad' })
  const rfq = await createRfq(co.id, { due_on: karachiDay(6), customer_ref: `C${Math.floor(Math.random() * 90000 + 10000)}` })
  await must(rest('admin', 'rfq_items', { method: 'POST', body: { rfq_id: rfq.id, position: 0, description: 'Flow meter DN50', qty: 1 } }))
  const asked = new Date(Date.now() - 86_400_000).toISOString()
  const q = (question: string) =>
    must(rest<Clar[]>('admin', 'clarifications', { method: 'POST', body: { rfq_id: rfq.id, question, ask_count: 1, first_asked_at: asked, last_asked_at: asked } }))
  await q('Line size and flange rating on the process line')
  await q('Fluid temperature range, and whether the meter sees CIP cleaning')
  const supplier = await createCompany(uniqueName('Lahore Process Controls'), { country: 'Pakistan' })
  await must(rest('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: rfq.id, supplier_id: supplier.id, sent_on: karachiDay(-3) } }))
  return { rfq, customer, co, supplier }
}

/** Sign in, open the RFQ once (so it is "recent" on this device), and wait until the service worker controls the page. */
async function ready(page: Page, rfqId: string) {
  await openAs(page, 'sales', `/rfqs/${rfqId}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null)
  await page.goto('/today')
  await page.locator('#main').waitFor()
}

interface Shared {
  text?: string
  files?: { name: string; type: string }[]
}

/** What the Android share sheet does: a multipart POST navigation to /capture, answered by the service worker. */
async function share(page: Page, payload: Shared) {
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
      if (files?.length) {
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
    { text: payload.text, files: payload.files, b64: PNG_B64 },
  )
}

const sheet = (page: Page) => page.getByRole('dialog', { name: 'Paste or photo' })

/** R2-11: only the chosen option shows; "Something else" opens the other tiles and the questions and order choices (once per capture). */
async function openMore(page: Page) {
  const more = sheet(page).getByRole('button', { name: 'Something else' })
  if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click()
}
async function chooseDest(page: Page, name: RegExp) {
  await openMore(page)
  await sheet(page).getByRole('radio', { name }).click()
}
/** grade-B K2: "Questions from a supplier" is a choice under "Something else" (the reply with prices took its tile). */
async function chooseQuestions(page: Page) {
  await openMore(page)
  await sheet(page).getByRole('button', { name: 'Questions from a supplier' }).click()
}
// The Undo toast (the saved panel is a status too, so the toast is the one with an Undo button).
const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text }).filter({ has: page.getByRole('button', { name: /Undo/ }) })

/** A paste event as the browser makes it from the clipboard, with text and/or a photo. */
async function paste(page: Page, payload: Shared) {
  await page.evaluate(
    ({ text, files, b64 }) => {
      const dt = new DataTransfer()
      if (text) dt.setData('text/plain', text)
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
      for (const f of files ?? []) dt.items.add(new File([bytes], f.name, { type: f.type }))
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    },
    { text: payload.text, files: payload.files, b64: PNG_B64 },
  )
}

test.describe('Android share target: the service worker takes the POST', () => {
  test('a photo shared from WhatsApp answers the first open question: 1 in-app tap, nothing typed', async ({ page }) => {
    const s = await seed()
    await ready(page, s.rfq.id)
    await share(page, { files: [{ name: 'nameplate-photo.png', type: 'image/png' }] })

    await expect(sheet(page)).toBeVisible()
    await expect(page.getByRole('radio', { name: /Answer with photo/ })).toBeChecked()
    await expect(page.getByRole('radio', { name: new RegExp(`${rfqRef(s.rfq.number)} · ${s.customer}`) })).toBeChecked()
    await expect(sheet(page).getByText('nameplate-photo.png')).toBeVisible()
    await review(page, 'capture-android-photo-answer')

    let taps = 0
    await sheet(page).getByRole('button', { name: 'Save photo as the answer' }).click()
    taps++
    await expect(toast(page, `Saved to ${rfqRef(s.rfq.number)}`)).toBeVisible()
    expect(taps + 2).toBe(3) // Share, Q-Tech CRM, Save

    const [first, second] = await clarsOf(s.rfq.id)
    expect(first.answered_at).not.toBeNull()
    expect(first.answer).toBeNull() // the photo is the reply
    expect(second.answered_at).toBeNull()
    const [att] = await attsOf(s.rfq.id)
    expect(att.path).toMatch(PATH_FORMAT)
    expect(att.clarification_id).toBe(first.id)
    await review(page, 'capture-saved')
  })

  test('a shared text answers both open questions with one tap, and Undo takes it back and brings the capture back', async ({ page }) => {
    const s = await seed()
    await ready(page, s.rfq.id)
    await share(page, { text: 'Line size is 4 inch, flange PN16.\nFluid is hot water, 5 to 85 C.' })

    await expect(sheet(page)).toBeVisible()
    await expect(sheet(page).getByRole('textbox', { name: 'Pasted text' })).toHaveValue(/Line size is 4 inch/)
    await expect(page.getByRole('radio', { name: /Answer a question/ })).toBeChecked()
    await sheet(page).getByRole('button', { name: 'Save answer to 2 questions' }).click()
    await expect(toast(page, `Saved to ${rfqRef(s.rfq.number)}`)).toBeVisible()
    let rows = await clarsOf(s.rfq.id)
    expect(rows.map(r => r.answer)).toEqual(Array(2).fill('Line size is 4 inch, flange PN16.\nFluid is hot water, 5 to 85 C.'))

    await toast(page, `Saved to ${rfqRef(s.rfq.number)}`).getByRole('button', { name: /Undo/ }).click()
    await expect.poll(async () => (await clarsOf(s.rfq.id)).every(r => r.answered_at === null && r.answer === null)).toBe(true)
    rows = await clarsOf(s.rfq.id)
    expect(rows).toHaveLength(2)
    // the capture is back in the sheet
    await expect(sheet(page).getByRole('textbox', { name: 'Pasted text' })).toHaveValue(/Line size is 4 inch/)
  })

  test('the shared item survives a sign-in redirect and opens the sheet afterwards', async ({ page }) => {
    const s = await seed()
    await ready(page, s.rfq.id)
    // signed out in the middle: drop the session, keep the device (service worker and IndexedDB)
    await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('sb-')).forEach(k => localStorage.removeItem(k)))
    await share(page, { text: 'Reply: line size is 4 inch.' })
    await page.waitForURL(/\/login/)
    await expect(page.getByText('Your shared item is safe')).toBeVisible()
    await page.getByLabel('Email').fill('sales@test.invalid')
    await page.getByLabel('Password', { exact: true }).fill('fixture-only-password')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(sheet(page)).toBeVisible()
    await expect(sheet(page).getByRole('textbox', { name: 'Pasted text' })).toHaveValue('Reply: line size is 4 inch.')
    await expect(page.getByText('Your shared item is back')).toBeVisible()
  })

  test('an item older than 7 days is gone, and the sheet says so', async ({ page }) => {
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
    await review(page, 'capture-expired-1440')
    await sheet(page).getByRole('button', { name: 'Paste or photo', exact: true }).click()
    await expect(sheet(page).getByText('Drop text, photos or files here')).toBeVisible()
  })
})

test.describe('desktop: paste and drop anywhere', () => {
  test('pasting text opens Capture with it; it goes to the RFQ notes as written, with name and time', async ({ page }) => {
    const s = await seed()
    await ready(page, s.rfq.id)
    await paste(page, { text: 'Customer will send the P&ID on Monday.' })
    await expect(sheet(page)).toBeVisible()
    await expect(sheet(page).getByRole('textbox', { name: 'Pasted text' })).toHaveValue('Customer will send the P&ID on Monday.')
    await chooseDest(page, /Add to RFQ notes/)
    await sheet(page).getByRole('button', { name: 'Add to notes' }).click()
    await expect(toast(page, `Saved to ${rfqRef(s.rfq.number)}`)).toBeVisible()
    expect(await notesOf(s.rfq.id)).toMatch(/Test Sales, \w{3} \d{1,2} \w{3}, \d\d:\d\d\nCustomer will send the P&ID on Monday\./)
  })

  test('pasting a photo (native clipboard image) opens Capture with the photo added', async ({ page }) => {
    const s = await seed()
    await ready(page, s.rfq.id)
    await paste(page, { files: [{ name: 'image.png', type: 'image/png' }] })
    await expect(sheet(page).getByText('image.png')).toBeVisible()
    await expect(page.getByRole('radio', { name: /Answer with photo/ })).toBeChecked()
  })

  test('dropping files anywhere opens Capture with them; Add to notes keeps them with the RFQ', async ({ page }) => {
    const s = await seed()
    await ready(page, s.rfq.id)
    await page.evaluate(b64 => {
      const dt = new DataTransfer()
      dt.items.add(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], 'site-photo.png', { type: 'image/png' }))
      for (const type of ['dragenter', 'dragover', 'drop']) document.body.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }))
    }, PNG_B64)
    await expect(sheet(page).getByText('site-photo.png')).toBeVisible()
    await chooseDest(page, /Add to RFQ notes/)
    await sheet(page).getByRole('button', { name: 'Add to notes' }).click()
    await expect(toast(page, `Saved to ${rfqRef(s.rfq.number)}`)).toBeVisible()
    const [att] = await attsOf(s.rfq.id)
    expect(att).toMatchObject({ file_name: 'site-photo.png', clarification_id: null })
    expect(att.path).toMatch(PATH_FORMAT)
  })

  test('a file over 5 MB is named and refused, and the rest can still be saved', async ({ page }) => {
    const s = await seed()
    await ready(page, s.rfq.id)
    await page.getByRole('button', { name: /^(Capture|Paste or photo)/ }).first().click()
    await sheet(page).locator('input[aria-label="Choose files"]:visible').setInputFiles([
      { name: 'datasheet-scan.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(5 * 1024 * 1024 + 2048) },
      { name: 'nameplate.png', mimeType: 'image/png', buffer: PNG },
    ])
    await expect(sheet(page).getByText(/datasheet-scan\.pdf/).first()).toBeVisible()
    await expect(sheet(page).getByText(/The limit is 5 MB/)).toBeVisible()
    await sheet(page).getByRole('button', { name: 'Save photo as the answer' }).click()
    await expect(toast(page, 'Saved to')).toBeVisible()
    const atts = await attsOf(s.rfq.id)
    expect(atts.map(a => a.file_name)).toEqual(['nameplate.png'])
  })
})

test.describe('iPhone: Paste or photo button, paste, photo pick', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('Capture, Choose photos, Save: a photo answer with nothing typed', async ({ page }) => {
    const s = await seed()
    await ready(page, s.rfq.id)
    let taps = 0
    await page.getByRole('button', { name: /^(Capture|Paste or photo)/ }).first().click()
    taps++
    await expect(sheet(page)).toBeVisible()
    await expect(sheet(page).getByRole('button', { name: 'Add something first' })).toBeDisabled()
    await expect(page.getByRole('radio', { name: /Answer a question/ })).toBeDisabled()
    await sheet(page).locator('input[aria-label="Choose photos"]:visible').setInputFiles({ name: 'IMG_0412.png', mimeType: 'image/png', buffer: PNG })
    taps++ // Choose photos, then the system picker
    await expect(page.getByRole('radio', { name: /Answer with photo/ })).toBeChecked()
    await sheet(page).getByRole('button', { name: 'Save photo as the answer' }).click()
    taps++
    await expect(toast(page, `Saved to ${rfqRef(s.rfq.number)}`)).toBeVisible()
    expect(taps).toBe(3)
    const [first] = await clarsOf(s.rfq.id)
    expect(first.answered_at).not.toBeNull()
    expect((await attsOf(s.rfq.id))[0].clarification_id).toBe(first.id)
  })

  test('Copy, open the app, Capture, Paste, Save: 5 taps for a text answer, 2 more than Android', async ({ page }) => {
    const s = await seed()
    await ready(page, s.rfq.id)
    let taps = 2 // Copy in WhatsApp (press and hold, then Copy), open Q-Tech CRM from the home screen
    await page.getByRole('button', { name: /^(Capture|Paste or photo)/ }).first().click()
    taps++
    await expect(sheet(page)).toBeVisible()
    await page.waitForTimeout(450)
    await review(page, 'capture-iphone-empty')
    await sheet(page).getByRole('textbox', { name: 'Pasted text' }).fill('1. Line size is 4 inch, flange PN16.' + String.fromCharCode(10) + '2. Fluid is hot water, 5 to 85 C.') // press and hold, then Paste
    taps++
    await expect(page.getByRole('radio', { name: /Answer a question/ })).toBeChecked()
    await page.waitForTimeout(450)
    await review(page, 'capture-iphone-pasted')
    await sheet(page).getByRole('button', { name: 'Save answer to 2 questions' }).click()
    taps++
    await expect(toast(page, `Saved to ${rfqRef(s.rfq.number)}`)).toBeVisible()
    expect(taps).toBe(5)
    expect((await clarsOf(s.rfq.id)).every(r => r.answered_at !== null)).toBe(true)
  })

  test('the C key and the command palette open Capture too', async ({ page }) => {
    const s = await seed()
    await ready(page, s.rfq.id)
    await page.keyboard.press('c')
    await expect(sheet(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(sheet(page)).toHaveCount(0)
    await page.keyboard.press('Control+k')
    await page.getByRole('combobox').fill('photo')
    await page.getByRole('option', { name: /Paste or photo/ }).first().click()
    await expect(sheet(page)).toBeVisible()
  })
})

test.describe('the other destinations', () => {
  test('new supplier questions: one line each, untick one, add', async ({ page }) => {
    const s = await seed()
    await ready(page, s.rfq.id)
    await paste(page, { text: '1. Valve size and Kvs?\n2. Actuator torque and supply voltage?\n3. Fail-safe position on power loss?' })
    await chooseQuestions(page)
    await sheet(page).getByRole('checkbox', { name: /Actuator torque/ }).click()
    await sheet(page).getByRole('button', { name: 'Add 2 questions' }).click()
    await expect(toast(page, `Saved to ${rfqRef(s.rfq.number)}`)).toBeVisible()
    const rows = await clarsOf(s.rfq.id)
    expect(rows.slice(2).map(r => r.question)).toEqual(['Valve size and Kvs?', 'Fail-safe position on power loss?'])
  })

  test('a supplier reply opens the RFQ with the reply read out, nothing saved', async ({ page }) => {
    const s = await seed()
    await ready(page, s.rfq.id)
    await paste(page, { text: 'Dear Sir, price for item 1 is USD 1,200 each, delivery 3 weeks, ex stock.' })
    await chooseDest(page, /A supplier’s prices/) // grade-B K2: one of the four tiles
    await expect(sheet(page).getByRole('radio', { name: s.supplier.name })).toBeChecked()
    await sheet(page).getByRole('button', { name: 'Read the reply' }).click()
    await expect(page).toHaveURL(new RegExp(`/rfqs/${s.rfq.id}$`))
    await expect(page.getByText('Read from their reply')).toBeVisible()
  })

  test('start a new RFQ: pick the company, intake opens with the text, and the photo is attached once the RFQ is saved', async ({ page }) => {
    const s = await seed()
    await ready(page, s.rfq.id)
    await share(page, { text: 'Please quote 2 nos ultrasonic level transmitter, 0 to 8 m, 4-20 mA.', files: [{ name: 'tank.png', type: 'image/png' }] })
    await expect(sheet(page)).toBeVisible()
    await chooseDest(page, /Start a new RFQ/)
    await sheet(page).getByLabel('Which company?').fill(s.customer)
    await page.getByRole('option', { name: new RegExp(s.customer) }).click()
    await sheet(page).getByRole('button', { name: 'Continue to New RFQ' }).click()
    await expect(page).toHaveURL(/\/rfqs\/new\?company=/)
    await expect(page.getByText(/ultrasonic level transmitter/).first()).toBeVisible()
    // A polite line is now read (audit E1): the item and its quantity are already there. Tidy the description by hand.
    await expect(page.getByRole('textbox', { name: 'Quantity of item 1' })).toHaveValue('2 nos')
    await expect(page.getByRole('textbox', { name: 'Description of item 1' })).toHaveValue(/^ultrasonic level transmitter/)
    await page.getByRole('textbox', { name: 'Description of item 1' }).fill('Ultrasonic level transmitter 0 to 8 m')
    // This suite runs at 1440: Save for later is a button in the step bar (on a phone it sits in the bar's ⋯ menu).
    await page.getByRole('button', { name: "Save for later (don't ask suppliers yet)" }).click()
    await expect(page.getByText(/is saved/)).toBeVisible()
    await expect.poll(async () => (await must(rest<{ id: string }[]>('admin', `rfqs?company_id=eq.${s.co.id}&select=id&order=number`))).length).toBe(2)
    const created = (await must(rest<{ id: string }[]>('admin', `rfqs?company_id=eq.${s.co.id}&select=id&order=number.desc&limit=1`)))[0]
    await expect.poll(async () => (await attsOf(created.id)).map(a => a.file_name)).toEqual(['tank.png'])
  })
})

for (const [name, size] of [
  ['1440', { width: 1440, height: 900 }],
  ['375', { width: 375, height: 812 }],
] as const) {
  test.describe(`accessibility at ${name}`, () => {
    test.use({ viewport: size })

    test(`the Capture sheet with a text and a photo passes axe (WCAG 2.2 AA)`, async ({ page }) => {
      const s = await seed()
      await ready(page, s.rfq.id)
      await share(page, { text: 'Line size is 4 inch, flange PN16.', files: [{ name: 'nameplate-photo.png', type: 'image/png' }] })
      await expect(sheet(page)).toBeVisible()
      await expect(page.getByRole('radio', { name: new RegExp(rfqRef(s.rfq.number)) })).toBeChecked()
      await page.waitForTimeout(400)
      expect(await axeViolations(page)).toEqual([])
      await review(page, `capture-sheet-${name}`)
    })

    test(`the empty sheet and the shell with the Paste or photo button pass axe`, async ({ page }) => {
      const s = await seed()
      await ready(page, s.rfq.id)
      expect(await axeViolations(page)).toEqual([])
      await page.getByRole('button', { name: /^(Capture|Paste or photo)/ }).first().click()
      await expect(sheet(page)).toBeVisible()
      await page.waitForTimeout(400)
      expect(await axeViolations(page)).toEqual([])
      await review(page, `capture-empty-${name}`)
    })
  })
}

test.describe('attach to an order (migration 0042)', () => {
  async function seedOrder() {
    const s = await seed()
    const order = (await must(rest<{ id: string; number: number }[]>('admin', 'orders', { method: 'POST', body: { company_id: s.co.id } })))[0]
    return { ...s, order }
  }
  const orderFiles = (orderId: string) => must(rest<{ path: string; file_name: string; bucket: string; rfq_id: string | null }[]>('admin', `attachments?order_id=eq.${orderId}&select=path,file_name,bucket,rfq_id&order=created_at`))

  test('Capture attaches a photo and a note to the order that was just opened, with Undo', async ({ page }) => {
    const s = await seedOrder()
    await openAs(page, 'sales', `/orders/${s.order.id}`)
    await expect(page.getByRole('heading', { name: 'Files' })).toBeVisible() // the order page records the visit
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null)
    await page.goto('/today')
    await page.locator('#main').waitFor()
    await paste(page, { text: 'Customer PO attached, delivery to site gate 2.', files: [{ name: 'po-scan.png', type: 'image/png' }] })
    await expect(sheet(page)).toBeVisible()
    await openMore(page)
    await sheet(page).getByRole('button', { name: 'Attach to an order' }).click()
    await expect(sheet(page).getByRole('radio', { name: new RegExp(`ORD-${String(s.order.number).padStart(4, '0')} · ${s.customer}`) })).toBeChecked()
    await page.waitForTimeout(450)
    await review(page, 'capture-attach-to-order')
    await sheet(page).getByRole('button', { name: 'Attach to order' }).click()
    await expect(toast(page, 'Saved to ORD-')).toBeVisible()
    const files = await orderFiles(s.order.id)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({ file_name: 'po-scan.png', bucket: 'rfq-files', rfq_id: null })
    expect(files[0].path).toMatch(new RegExp(`^${s.order.id}/`))
    const notes = (await must(rest<{ notes: string | null }[]>('admin', `orders?id=eq.${s.order.id}&select=notes`)))[0].notes
    expect(notes).toContain('Customer PO attached, delivery to site gate 2.')
    await toast(page, 'Saved to ORD-').getByRole('button', { name: /Undo/ }).click()
    await expect.poll(async () => (await orderFiles(s.order.id)).length).toBe(0)
  })

  test('the Files panel on the order page adds, lists and deletes a file', async ({ page }) => {
    const s = await seedOrder()
    await openAs(page, 'sales', `/orders/${s.order.id}`)
    await expect(page.getByText('No files yet. The customer’s PO or a photo from site goes here.')).toBeVisible()
    await page.locator('input[type="file"][aria-label="Choose files"]').setInputFiles({ name: 'delivery-note.png', mimeType: 'image/png', buffer: PNG })
    await expect(page.getByRole('list', { name: 'Files on this order' }).getByText('delivery-note.png')).toBeVisible()
    expect((await orderFiles(s.order.id)).map(f => f.file_name)).toEqual(['delivery-note.png'])
    expect(await axeViolations(page)).toEqual([])
    await page.getByRole('button', { name: 'Delete delivery-note.png' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete file' }).click()
    await expect.poll(async () => (await orderFiles(s.order.id)).length).toBe(0)
  })

  test('an engineer can attach to an order too (all staff)', async ({ page }) => {
    const s = await seedOrder()
    await openAs(page, 'engineer', `/orders/${s.order.id}`)
    await page.locator('input[type="file"][aria-label="Choose files"]').setInputFiles({ name: 'site-photo.png', mimeType: 'image/png', buffer: PNG })
    await expect(page.getByRole('list', { name: 'Files on this order' }).getByText('site-photo.png')).toBeVisible()
    expect((await orderFiles(s.order.id)).map(f => f.file_name)).toEqual(['site-photo.png'])
  })
})
