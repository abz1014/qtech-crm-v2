import { appendFileSync } from 'node:fs'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { NO_TEXT, SCENES, type Scene } from './scenes'

/*
 * The picture reader (src/lib/docread/imageText.ts) in real Chromium, on /dev/docread (dev builds only), under the production
 * Content-Security-Policy when E2E_CSP=1 (CI sets it). Fictional screenshots (scenes.ts) are rendered and photographed here,
 * dropped on the page, read on the device, and the items parseEnquiry finds in the text are scored against the items the same
 * enquiry gives when pasted as text, or against the exact items a scene expects (the Outlook RFQ: unit, customer reference and
 * email domain too). Run:
 *     E2E_CSP=1 npx playwright test --project=docread
 */

interface Item {
  description: string
  qty: number
  unit?: string | null
}

interface Parsed {
  items: Item[]
  customerRef: string | null
  domain: string | null
}

async function shoot(browser: Browser, scene: Pick<Scene, 'viewport' | 'deviceScaleFactor' | 'html' | 'format'>): Promise<{ buffer: Buffer; mimeType: string }> {
  const ctx = await browser.newContext({ viewport: scene.viewport, deviceScaleFactor: scene.deviceScaleFactor })
  const page = await ctx.newPage()
  await page.setContent(scene.html)
  let out: { buffer: Buffer; mimeType: string }
  if (scene.format === 'webp') {
    const png = await page.screenshot({ fullPage: true })
    const b64 = await page.evaluate(async (data: string) => {
      const img = new Image()
      img.src = `data:image/png;base64,${data}`
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      c.getContext('2d')!.drawImage(img, 0, 0)
      return c.toDataURL('image/webp', 0.9).split(',')[1]!
    }, png.toString('base64'))
    out = { buffer: Buffer.from(b64, 'base64'), mimeType: 'image/webp' }
  } else if (scene.format === 'jpeg') {
    out = { buffer: await page.screenshot({ fullPage: true, type: 'jpeg', quality: 80 }), mimeType: 'image/jpeg' }
  } else {
    out = { buffer: await page.screenshot({ fullPage: true }), mimeType: 'image/png' }
  }
  await ctx.close()
  return out
}

async function drop(page: Page, name: string, file: { buffer: Buffer; mimeType: string }) {
  await page.getByLabel('Picture').setInputFiles({ name, ...file })
}

async function readResult(page: Page) {
  const result = page.getByTestId('ocr-result')
  await expect(result).toBeVisible({ timeout: 90_000 })
  return {
    ok: (await result.getAttribute('data-ok')) === 'true',
    reason: await result.getAttribute('data-reason'),
    ms: Number(await result.getAttribute('data-ms')),
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

function similarity(a: string, b: string): number {
  const x = norm(a)
  const y = norm(b)
  if (!x.length && !y.length) return 1
  const d: number[] = Array.from({ length: y.length + 1 }, (_, j) => j)
  for (let i = 1; i <= x.length; i++) {
    let prev = d[0]!
    d[0] = i
    for (let j = 1; j <= y.length; j++) {
      const tmp = d[j]!
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return 1 - d[y.length]! / Math.max(x.length, y.length)
}

/**
 * Matched items: same quantity, description at least 90% alike (letters and digits, case ignored), and the same unit when the
 * scene states one. Exact: the description identical too.
 */
function score(expected: Item[], got: Item[]) {
  const left = [...got]
  let matched = 0
  let exact = 0
  for (const e of expected) {
    let best = -1
    let bestSim = 0
    left.forEach((g, i) => {
      const unitOk = e.unit === undefined || (e.unit ?? '').toLowerCase() === (g.unit ?? '').toLowerCase()
      const s = g.qty === e.qty && unitOk ? similarity(e.description, g.description) : 0
      if (s > bestSim) {
        bestSim = s
        best = i
      }
    })
    if (best >= 0 && bestSim >= 0.9) {
      matched++
      if (norm(left[best]!.description) === norm(e.description)) exact++
      left.splice(best, 1)
    }
  }
  return { matched, exact }
}

test.describe.configure({ mode: 'serial' })

const violations: string[] = []

test.beforeEach(async ({ page }) => {
  page.on('console', m => {
    if (/Content.Security.Policy/i.test(m.text())) violations.push(m.text())
  })
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', e => console.error(`Content-Security-Policy violation: ${e.violatedDirective} ${e.blockedURI}`))
  })
  await page.goto('/dev/docread')
  await expect(page.getByRole('heading', { name: 'Read a picture' })).toBeVisible()
})

test('screenshots of enquiries come back as text, and as the same items a paste gives', async ({ page, browser }) => {
  test.setTimeout(600_000)
  const rows: string[] = []
  let cleanExpected = 0
  let cleanMatched = 0
  let cleanGot = 0
  for (const [i, scene] of SCENES.entries()) {
    const file = await shoot(browser, scene)
    await drop(page, `${scene.name}.${scene.format ?? 'png'}`, file)
    const r = await readResult(page)
    expect(r.ok, `${scene.name}: ${r.reason}`).toBe(true)
    if (i === 0) await expect(page.getByTestId('ocr-progress')).toHaveText(/^Reading the image… \d{1,3}%$/)
    const text = await page.getByTestId('ocr-text').innerText()
    const parsed = JSON.parse(await page.getByTestId('ocr-items').innerText()) as Parsed
    const got = parsed.items
    const pasted = await page.evaluate(t => (window as unknown as { __docreadItems: (t: string) => Parsed }).__docreadItems(t), scene.paste)
    const expected: Item[] = scene.expected?.items ?? pasted.items
    expect(expected.length, `${scene.name}: the paste itself gives items`).toBeGreaterThan(0)
    const { matched, exact } = score(expected, got)
    let facts = ''
    if (scene.expected) {
      const pasteScore = score(expected, pasted.items)
      facts = `ref ${parsed.customerRef ?? "none"} (paste ${pasted.customerRef ?? "none"}, wanted ${scene.expected.customerRef}), domain ${parsed.domain === scene.expected.domain ? "ok" : (parsed.domain ?? "none")}; paste gives ${pasteScore.matched}/${expected.length}`
      if (scene.clean) {
        // The subject's trailing number is the customer's reference.
        expect.soft(parsed.customerRef, `${scene.name}: customer ref`).toBe(scene.expected.customerRef)
        expect.soft(parsed.domain, `${scene.name}: email domain`).toBe(scene.expected.domain)
      }
    }
    const recall = matched / expected.length
    const precision = got.length ? matched / got.length : 0
    if (scene.clean) {
      cleanExpected += expected.length
      cleanMatched += matched
      cleanGot += got.length
    }
    const conf = await page.getByTestId('ocr-confidence').innerText()
    rows.push(
      `| ${scene.kind} | ${file.buffer.length > 1024 * 1024 ? `${(file.buffer.length / 1048576).toFixed(1)} MB` : `${Math.round(file.buffer.length / 1024)} KB`} | ${expected.length} | ${got.length} | ${matched} (${exact} exact) | ${Math.round(recall * 100)}% | ${Math.round(precision * 100)}% | ${conf.replace('Confidence ', '')} | ${(r.ms / 1000).toFixed(1)} s | ${facts} |`,
    )
    if (recall < 1 || precision < 1) console.log(`--- ${scene.name}\n${text}\n--- items\n${JSON.stringify(got, null, 1)}`)
  }
  const recall = cleanMatched / cleanExpected
  const precision = cleanMatched / cleanGot
  const table = [
    '### Picture reader accuracy (fictional screenshots; items vs the scene\'s expected items, or vs the same text pasted)',
    '',
    '| Screenshot | File | Items expected | Items (picture) | Matched | Recall | Precision | Confidence | Time | Facts |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...rows,
    `| **All clean screenshots** | | ${cleanExpected} | ${cleanGot} | ${cleanMatched} | **${Math.round(recall * 100)}%** | **${Math.round(precision * 100)}%** | | | |`,
    '',
    'The first row includes loading the reader (worker, engine and language data) from the local server.',
  ].join('\n')
  console.log(table)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n`)
  expect(recall).toBeGreaterThanOrEqual(0.9)
  expect(precision).toBeGreaterThanOrEqual(0.9)
})

test('a picture with no text says so plainly, and a read can be cancelled', async ({ page, browser }) => {
  test.setTimeout(180_000)
  await drop(page, 'blank.png', await shoot(browser, { viewport: { width: 600, height: 400 }, deviceScaleFactor: 1, html: NO_TEXT }))
  const r = await readResult(page)
  expect(r).toMatchObject({ ok: false, reason: 'unclear' })
  await expect(page.getByTestId('ocr-message')).toHaveText("Couldn't read this clearly — type or paste the items.")

  await drop(page, 'chat.png', await shoot(browser, SCENES[0]!))
  await expect(page.getByTestId('ocr-progress')).toHaveText(/Reading the image… \d+%/)
  await page.getByRole('button', { name: 'Cancel' }).click()
  const c = await readResult(page)
  expect(c).toMatchObject({ ok: false, reason: 'aborted' })

  // After a cancel the next picture starts a fresh reader and still works.
  await drop(page, 'chat-again.png', await shoot(browser, SCENES[1]!))
  expect((await readResult(page)).ok).toBe(true)
})

test('a file that is not a picture is turned away before anything loads', async ({ page }) => {
  await page.getByLabel('Picture').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('2 nos valve') })
  const r = await readResult(page)
  expect(r).toMatchObject({ ok: false, reason: 'not_image' })
})

test.afterAll(() => {
  expect(violations, violations.join('\n')).toEqual([])
})
