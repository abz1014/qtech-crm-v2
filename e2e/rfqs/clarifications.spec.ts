import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { expect, test, type Page } from '@playwright/test'
import { API_URL, ANON_KEY, createCompany, createRfq, karachiDay, login, must, openAs, review, rest, uniqueName } from '../support/stack'

/*
 * R09 (clarifications) and R10 (attachments) end to end, against the local CI stack: the RFQ detail page as the fixture users,
 * through the real login form. Every test seeds its own company and RFQ, so tests do not depend on each other.
 *
 * FE-2 targets asserted here (BUILD_PLAN FE-2 and A3 R09):
 *   Add questions       1 paste + 1 tap (the paste splits into one question per line)
 *   Copy for customer   1 tap (copies the approved wording and stamps the asked times)
 *   Photo answer        at most 3 taps, 0 typed (here: 2 taps)
 *   Copy answers        1 tap (stamps last_relayed_at); a photo-only answer reads "see attached photo"
 *   Withdraw            1 tap
 *   Add a file          1 tap on Choose files (or a drop / paste), 0 typed
 */

const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')

async function violations(page: Page): Promise<string[]> {
  await page.evaluate(axeSource)
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: Document, opts: object) => Promise<{ violations: Array<{ id: string; impact: string | null; help: string; nodes: Array<{ target: unknown; failureSummary?: string }> }> }> } }).axe
    const result = await axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
      resultTypes: ['violations'],
    })
    return result.violations.flatMap(v => v.nodes.map(n => `${v.id} (${v.impact}) ${JSON.stringify(n.target)}: ${(n.failureSummary ?? v.help).replace(/\s+/g, ' ')}`))
  })
}

// A real 1x1 PNG, so the browser can decode (and try to shrink) it.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const PATH_FORMAT = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/

interface Seed {
  rfq: { id: string; number: number }
  customer: string
  lpc: { id: string; name: string; inquiryId: string }
  abc: { id: string; name: string; inquiryId: string }
}

async function seed(): Promise<Seed> {
  const customer = uniqueName('Clar Customer')
  const co = await createCompany(customer)
  const rfq = await createRfq(co.id, { due_on: karachiDay(6), customer_ref: `T${Math.floor(Math.random() * 90000 + 10000)}` })
  await must(rest('admin', 'rfq_items', { method: 'POST', body: { rfq_id: rfq.id, position: 0, description: 'Flow meter DN50', qty: 1 } }))
  const supplier = async (prefix: string) => {
    const c = await createCompany(uniqueName(prefix), { country: 'Pakistan' })
    const inq = (await must(rest<{ id: string }[]>('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: rfq.id, supplier_id: c.id, sent_on: karachiDay(-3) } })))[0]
    return { id: c.id, name: c.name, inquiryId: inq.id }
  }
  return { rfq, customer, lpc: await supplier('Lahore Process Controls'), abc: await supplier('ABC Traders') }
}

interface ClarDb {
  id: string
  question: string
  raised_by_inquiry_id: string | null
  first_asked_at: string | null
  last_asked_at: string | null
  ask_count: number
  answer: string | null
  answered_at: string | null
  withdrawn_at: string | null
}
const SELECT = 'id,question,raised_by_inquiry_id,first_asked_at,last_asked_at,ask_count,answer,answered_at,withdrawn_at'

const clarsOf = (rfqId: string) => must(rest<ClarDb[]>('admin', `clarifications?rfq_id=eq.${rfqId}&select=${SELECT}&order=created_at,id`))
const addClar = async (rfqId: string, question: string, extra: Record<string, unknown> = {}) =>
  (await must(rest<ClarDb[]>('admin', 'clarifications', { method: 'POST', body: { rfq_id: rfqId, question, ...extra } })))[0]
const inquiryOf = (id: string) => must(rest<{ last_relayed_at: string | null }[]>('admin', `supplier_inquiries?id=eq.${id}&select=last_relayed_at`)).then(r => r[0])
const attsOf = (rfqId: string) =>
  must(rest<{ id: string; path: string; file_name: string; mime_type: string; size_bytes: number; clarification_id: string | null; bucket: string }[]>('admin', `attachments?rfq_id=eq.${rfqId}&select=id,path,file_name,mime_type,size_bytes,clarification_id,bucket&order=created_at`))

/** The status of a storage object, read as the admin (200 when it exists). */
async function objectStatus(path: string): Promise<number> {
  const s = await login('admin')
  const res = await fetch(`${API_URL}/storage/v1/object/authenticated/rfq-files/${path}`, { headers: { apikey: ANON_KEY, authorization: `Bearer ${s.access_token}` } })
  await res.arrayBuffer()
  return res.status
}

/** A seeded photo on a question or the RFQ, uploaded as the admin the way the app does it. */
async function seedPhoto(rfqId: string, clarificationId: string | null, name: string): Promise<string> {
  const s = await login('admin')
  const path = `${rfqId}/${crypto.randomUUID()}.png`
  const up = await fetch(`${API_URL}/storage/v1/object/rfq-files/${path}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, authorization: `Bearer ${s.access_token}`, 'content-type': 'image/png' },
    body: PNG,
  })
  if (!up.ok) throw new Error(`seed upload failed: ${up.status} ${await up.text()}`)
  await must(
    rest('admin', 'attachments', {
      method: 'POST',
      body: { bucket: 'rfq-files', path, file_name: name, mime_type: 'image/png', size_bytes: PNG.length, rfq_id: rfqId, clarification_id: clarificationId },
    }),
  )
  return path
}

const panel = (page: Page) => page.locator('[data-slot="clarifications"]')
const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText())
const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text })

test.describe('adding questions (FE-2: 1 paste + 1 tap)', () => {
  test('a pasted message splits into separate questions, each can be tagged to the supplier who asked', async ({ page }) => {
    const s = await seed()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await expect(panel(page).getByText(/No questions yet/)).toBeVisible()

    let pastes = 0
    let taps = 0
    await panel(page).getByRole('textbox', { name: 'Add questions' }).fill('1. What flange size and rating does the LR250 mount on?\n2. Is Ex certification needed for the Unit 2 dyeing area?\n- Should the Cerabar output be HART or plain 4 to 20 mA?')
    pastes++
    const list = panel(page).getByRole('list', { name: 'Questions to add' })
    await expect(list.getByRole('listitem')).toHaveCount(3)
    await list.getByLabel('Who asked: Should the Cerabar output be HART or plain 4 to 20 mA?').selectOption({ label: `Raised by ${s.lpc.name}` })
    await panel(page).getByRole('button', { name: 'Add 3 questions' }).click()
    taps++
    expect(pastes).toBe(1)
    expect(taps).toBe(1)

    await expect(toast(page, '3 questions added')).toBeVisible()
    const rows = await clarsOf(s.rfq.id)
    expect(rows.map(r => r.question)).toEqual([
      'What flange size and rating does the LR250 mount on?',
      'Is Ex certification needed for the Unit 2 dyeing area?',
      'Should the Cerabar output be HART or plain 4 to 20 mA?',
    ])
    expect(rows.map(r => r.raised_by_inquiry_id)).toEqual([null, null, s.lpc.inquiryId])
    expect(rows.every(r => r.ask_count === 0 && r.first_asked_at === null)).toBe(true)
    await expect(panel(page).getByText('To ask', { exact: true })).toBeVisible()
    await expect(panel(page).getByText(`Raised by ${s.lpc.name}`)).toBeVisible()
    await expect(panel(page).getByText('Our question').first()).toBeVisible()
  })
})

test.describe('copy for the customer (FE-2: 1 tap)', () => {
  test('Copy questions for customer copies the approved wording and stamps the asked times; a chase stamps again', async ({ page }) => {
    const s = await seed()
    const a = await addClar(s.rfq.id, 'Line size and flange rating on the process line')
    const b = await addClar(s.rfq.id, 'Fluid temperature range')
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)

    await panel(page).getByRole('button', { name: 'Copy questions for customer' }).click()
    await expect(toast(page, 'Questions copied')).toBeVisible()
    const text = await clipboard(page)
    expect(text).toContain('Thank you for your RFQ *#')
    expect(text).toContain('1. Line size and flange rating on the process line\n2. Fluid temperature range')
    expect(text).toContain('Kindly confirm by *')
    await expect.poll(async () => (await clarsOf(s.rfq.id)).map(r => r.ask_count)).toEqual([1, 1])
    const after = await clarsOf(s.rfq.id)
    expect(after.every(r => r.first_asked_at && r.last_asked_at)).toBe(true)
    expect(after.map(r => r.id).sort()).toEqual([a.id, b.id].sort())

    // Asked: the chip shows how many times, the days since the last ask, and the group offers the chase text.
    await expect(panel(page).getByText('Asked ×1')).toBeVisible()
    await expect(panel(page).getByText(/last asked today/)).toBeVisible()
    await panel(page).getByRole('radio', { name: 'Email' }).click()
    await panel(page).getByRole('button', { name: 'Preview text' }).click()
    await expect(panel(page).getByText(/^Subject: RFQ #/)).toBeVisible()
    await panel(page).getByRole('button', { name: 'Copy chase text' }).click()
    await expect(toast(page, 'Chase text copied')).toBeVisible()
    expect(await clipboard(page)).toContain('Thank you for your RFQ #')
    await expect.poll(async () => (await clarsOf(s.rfq.id)).map(r => r.ask_count)).toEqual([2, 2])
    await expect(panel(page).getByText('Asked ×2')).toBeVisible()
  })
})

test.describe('answers', () => {
  test('a photo answer is two taps and nothing typed: it stamps answered with no text', async ({ page }) => {
    const s = await seed()
    const q = await addClar(s.rfq.id, 'What flange size does the LR250 mount on?', { raised_by_inquiry_id: s.abc.inquiryId, first_asked_at: new Date().toISOString(), last_asked_at: new Date().toISOString(), ask_count: 1 })
    await openAs(page, 'engineer', `/rfqs/${s.rfq.id}`)

    let taps = 0
    let typed = 0
    const chooser = page.waitForEvent('filechooser')
    await panel(page).getByRole('button', { name: `Answered with photo: ${q.question}` }).click()
    taps++
    await (await chooser).setFiles({ name: 'flange-nameplate.png', mimeType: 'image/png', buffer: PNG })
    taps++ // choosing the photo in the picker
    expect(taps).toBeLessThanOrEqual(3)
    expect(typed).toBe(0)
    typed = 0

    await expect(toast(page, 'Answered with photo')).toBeVisible()
    const [row] = await clarsOf(s.rfq.id)
    expect(row.answered_at).not.toBeNull()
    expect(row.answer).toBeNull()
    const atts = await attsOf(s.rfq.id)
    expect(atts).toHaveLength(1)
    expect(atts[0].clarification_id).toBe(q.id)
    expect(atts[0].bucket).toBe('rfq-files')
    expect(atts[0].path).toMatch(PATH_FORMAT)
    expect(atts[0].path.startsWith(`${s.rfq.id}/`)).toBe(true)
    expect(await objectStatus(atts[0].path)).toBe(200)
    await expect(panel(page).getByText('Answered with a photo')).toBeVisible()
    await expect(panel(page).getByText('Answered', { exact: true })).toBeVisible()
    // The same photo is in the Files panel, marked as the answer.
    await expect(page.getByRole('list', { name: 'Files on this RFQ' })).toContainText('Photo answer')
  })

  test('a typed answer, then Copy answers for the supplier stamps last_relayed_at; a photo-only answer reads "see attached photo"', async ({ page }) => {
    const s = await seed()
    const asked = { first_asked_at: new Date().toISOString(), last_asked_at: new Date().toISOString(), ask_count: 1 }
    const q1 = await addClar(s.rfq.id, 'Which probe kit comes with the HQ1110?', { raised_by_inquiry_id: s.lpc.inquiryId, ...asked })
    const q2 = await addClar(s.rfq.id, 'What flange size on the LR250?', { raised_by_inquiry_id: s.lpc.inquiryId, ...asked })
    const q3 = await addClar(s.rfq.id, 'Cable length for the ABC unit?', { raised_by_inquiry_id: s.abc.inquiryId, ...asked })
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await expect(panel(page).getByRole('button', { name: /Copy answers for supplier/ })).toHaveCount(0)

    await panel(page).getByRole('button', { name: `Type answer: ${q1.question}` }).click()
    await panel(page).getByRole('textbox', { name: `Answer to: ${q1.question}` }).fill('Same as the old meter: PHC101 pH probe and CDC401 conductivity probe, 5 m cable.')
    await panel(page).getByRole('button', { name: 'Save answer' }).click()
    await expect(toast(page, 'Answer saved')).toBeVisible()
    await expect.poll(async () => (await clarsOf(s.rfq.id)).find(r => r.id === q1.id)?.answered_at ?? null).not.toBeNull()

    const chooser = page.waitForEvent('filechooser')
    await panel(page).getByRole('button', { name: `Answered with photo: ${q2.question}` }).click()
    await (await chooser).setFiles({ name: 'flange.png', mimeType: 'image/png', buffer: PNG })
    await expect.poll(async () => (await clarsOf(s.rfq.id)).find(r => r.id === q2.id)?.answered_at ?? null).not.toBeNull()

    // The supplier banner: Lahore Process Controls is waiting for 2 answers; ABC Traders has none yet.
    await expect(panel(page).getByText(`${s.lpc.name} is waiting for 2 answers.`)).toBeVisible()
    await expect(panel(page).getByRole('button', { name: `Copy answers for supplier ${s.abc.name}` })).toHaveCount(0)
    await panel(page).getByRole('button', { name: `Copy answers for supplier ${s.lpc.name}` }).click()
    await expect(toast(page, 'Answers copied')).toBeVisible()
    const text = await clipboard(page)
    expect(text).toContain('1. Which probe kit comes with the HQ1110?\n   Same as the old meter')
    expect(text).toContain('2. What flange size on the LR250?\n   see attached photo')
    expect(text).not.toContain('Cable length')
    await expect.poll(async () => (await inquiryOf(s.lpc.inquiryId)).last_relayed_at).not.toBeNull()
    expect((await inquiryOf(s.abc.inquiryId)).last_relayed_at).toBeNull()
    await expect(panel(page).getByText(/is waiting for/)).toHaveCount(0)

    // A later answer for the same supplier raises the banner again.
    await addClar(s.rfq.id, 'Any other option?', { raised_by_inquiry_id: s.lpc.inquiryId, ...asked })
    await page.reload()
    await panel(page).getByRole('button', { name: 'Type answer: Any other option?' }).click()
    await panel(page).getByRole('textbox', { name: 'Answer to: Any other option?' }).fill('No.')
    await panel(page).getByRole('button', { name: 'Save answer' }).click()
    await expect(panel(page).getByText(`${s.lpc.name} is waiting for 1 answer.`)).toBeVisible()
    void q3
  })

  test('Undo takes a typed answer back', async ({ page }) => {
    const s = await seed()
    const q = await addClar(s.rfq.id, 'Is Ex needed?')
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await panel(page).getByRole('button', { name: `Type answer: ${q.question}` }).click()
    await panel(page).getByRole('textbox', { name: `Answer to: ${q.question}` }).fill('Yes, zone 2.')
    await panel(page).getByRole('button', { name: 'Save answer' }).click()
    await toast(page, 'Answer saved').getByRole('button', { name: /Undo/ }).click()
    await expect.poll(async () => (await clarsOf(s.rfq.id))[0].answered_at).toBeNull()
    expect((await clarsOf(s.rfq.id))[0].answer).toBeNull()
  })

  test('withdraw is one tap, with Undo and Put back', async ({ page }) => {
    const s = await seed()
    const q = await addClar(s.rfq.id, 'Which supplier dropped out?')
    await addClar(s.rfq.id, 'Still relevant question')
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await panel(page).getByRole('button', { name: `Withdraw: ${q.question}` }).click()
    await expect(toast(page, 'Question withdrawn')).toBeVisible()
    await expect.poll(async () => (await clarsOf(s.rfq.id)).find(r => r.id === q.id)?.withdrawn_at ?? null).not.toBeNull()
    await panel(page).getByText(/^Withdrawn/).click()
    await panel(page).getByRole('button', { name: `Put back: ${q.question}` }).click()
    await expect.poll(async () => (await clarsOf(s.rfq.id)).find(r => r.id === q.id)?.withdrawn_at ?? null).toBeNull()
    await expect(panel(page).getByRole('button', { name: `Withdraw: ${q.question}` })).toBeVisible()
  })
})

test.describe('files (R10)', () => {
  const fileInput = (page: Page) => page.locator('input[type="file"][aria-label="Choose files"]')

  test('PNG, HEIC and PDF are accepted and stored at {rfq_id}/{uuid}.{ext}; the viewer opens an image, a PDF opens in a tab; delete removes the object', async ({ page }) => {
    const s = await seed()
    await openAs(page, 'engineer', `/rfqs/${s.rfq.id}`)
    await expect(page.getByText(/No files yet/)).toBeVisible()

    await fileInput(page).setInputFiles([
      { name: 'tiny.png', mimeType: 'image/png', buffer: PNG },
      { name: 'IMG_0412.heic', mimeType: 'image/heic', buffer: Buffer.alloc(40_000, 7) },
      { name: 'enquiry.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') },
    ])
    await expect(toast(page, '3 files added')).toBeVisible()
    const atts = await attsOf(s.rfq.id)
    expect(atts).toHaveLength(3)
    for (const a of atts) {
      expect(a.path).toMatch(PATH_FORMAT)
      expect(a.path.startsWith(`${s.rfq.id}/`)).toBe(true)
      expect(a.bucket).toBe('rfq-files')
      expect(a.clarification_id).toBeNull()
      expect(await objectStatus(a.path)).toBe(200)
    }
    const heic = atts.find(a => a.file_name === 'IMG_0412.heic')
    expect(heic?.mime_type).toBe('image/heic')
    expect(heic?.path.endsWith('.heic')).toBe(true)
    expect(atts.find(a => a.file_name === 'enquiry.pdf')?.path.endsWith('.pdf')).toBe(true)

    const files = page.getByRole('list', { name: 'Files on this RFQ' })
    await expect(files.getByRole('listitem')).toHaveCount(3)
    const png = atts.find(a => a.mime_type.startsWith('image/') && a.mime_type !== 'image/heic') as (typeof atts)[number]

    // An image opens in a lightbox.
    await files.getByRole('button', { name: `Open ${png.file_name}` }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('img', { name: png.file_name })).toBeVisible()
    await dialog.getByRole('button', { name: 'Close' }).first().click()
    await expect(dialog).toHaveCount(0)

    // A PDF opens in a new tab through a short-lived signed link.
    const pdfLink = files.getByRole('link', { name: /Open enquiry\.pdf/ })
    await expect(pdfLink).toHaveAttribute('target', '_blank')
    expect(await pdfLink.getAttribute('href')).toContain('/storage/v1/object/sign/rfq-files/')

    // Delete asks once, then removes the row and the object.
    await files.getByRole('button', { name: 'Delete enquiry.pdf' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete file' }).click()
    await expect(toast(page, 'File deleted')).toBeVisible()
    const pdf = atts.find(a => a.file_name === 'enquiry.pdf') as (typeof atts)[number]
    await expect.poll(async () => (await attsOf(s.rfq.id)).length).toBe(2)
    await expect.poll(() => objectStatus(pdf.path)).not.toBe(200)
    await expect(files.getByRole('listitem')).toHaveCount(2)
  })

  test('a 6 MB file is refused with a plain message and nothing is stored', async ({ page }) => {
    const s = await seed()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await fileInput(page).setInputFiles({ name: 'big-datasheet.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(6 * 1024 * 1024, 1) })
    await expect(page.getByRole('list', { name: 'Files that were not added' })).toContainText('6 MB. The limit is 5 MB.')
    await expect(toast(page, 'A file was not added')).toBeVisible()
    await review(page, 'r10-file-refused-1440')
    await page.getByRole('button', { name: 'Remove big-datasheet.pdf' }).click()
    await expect(page.getByRole('list', { name: 'Files that were not added' })).toHaveCount(0)
    expect(await attsOf(s.rfq.id)).toHaveLength(0)

    // A type that is not on the list is refused too, naming the ones that are.
    await fileInput(page).setInputFiles({ name: 'sheet.xlsx', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('x') })
    await expect(page.getByRole('list', { name: 'Files that were not added' })).toContainText('Only PNG, JPG, HEIC, HEIF, PDF files can be added.')
    expect(await attsOf(s.rfq.id)).toHaveLength(0)
  })
})

for (const width of [1440, 375]) {
  test(`axe (WCAG 2.2 AA) and review screenshots at ${width}`, async ({ page }) => {
    const s = await seed()
    const old = { first_asked_at: new Date(Date.now() - 6 * 86_400_000).toISOString(), last_asked_at: new Date(Date.now() - 6 * 86_400_000).toISOString(), ask_count: 2 }
    await addClar(s.rfq.id, 'Should the Cerabar output be HART or plain 4 to 20 mA?', { raised_by_inquiry_id: s.lpc.inquiryId })
    await addClar(s.rfq.id, 'What flange size and rating does the LR250 mount on?', { raised_by_inquiry_id: s.abc.inquiryId, ...old })
    await addClar(s.rfq.id, 'Is Ex certification needed for the Unit 2 dyeing area?', old)
    const answered = await addClar(s.rfq.id, 'Which probe kit does the customer want with the HQ1110?', {
      raised_by_inquiry_id: s.lpc.inquiryId,
      ...old,
      answer: 'Same as the old meter: PHC101 pH probe and CDC401 conductivity probe, 5 m cable.',
      answered_at: new Date().toISOString(),
    })
    const photoQ = await addClar(s.rfq.id, 'What is the line size?', { raised_by_inquiry_id: s.lpc.inquiryId, ...old, answered_at: new Date().toISOString() })
    await addClar(s.rfq.id, 'Dropped supplier question', { withdrawn_at: new Date().toISOString() })
    await seedPhoto(s.rfq.id, answered.id, 'nameplate-old-meter.png')
    await seedPhoto(s.rfq.id, photoQ.id, 'line-size.png')
    await seedPhoto(s.rfq.id, null, 'site-photo.png')

    await page.setViewportSize({ width, height: width > 800 ? 900 : 812 })
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await expect(panel(page).getByText('Asked ×2')).toBeVisible()
    await expect(page.getByRole('list', { name: 'Files on this RFQ' }).getByRole('listitem')).toHaveCount(3)
    await expect(page.locator('img[src*="/storage/v1/object/sign/"]').first()).toBeVisible()
    await panel(page).scrollIntoViewIfNeeded()
    expect(await violations(page)).toEqual([])
    await review(page, `r09-clarifications-populated-${width}`)

    await panel(page).getByRole('textbox', { name: 'Add questions' }).fill('Which cable gland size?\nHow long a cable?')
    await panel(page).getByRole('button', { name: 'Preview text' }).first().click()
    expect(await violations(page)).toEqual([])
    await review(page, `r09-clarifications-adding-${width}`)

    await page.getByRole('button', { name: 'Open nameplate-old-meter.png' }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(await violations(page)).toEqual([])
    await review(page, `r10-viewer-${width}`)
  })
}
