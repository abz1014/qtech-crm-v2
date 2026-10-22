import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { batch } from '../../src/lib/docread/corpus/corpus'
import { dropped, evaluate, type Scored } from '../../src/lib/docread/corpus/gate'
import { docHtml } from '../../src/lib/docread/corpus/html'
import type { CorpusCase, Shot } from '../../src/lib/docread/corpus/model'
import { scanPdf } from '../../src/lib/docread/corpus/pdf'
import { scoreEnquiry, scoreQuote, type EnquiryResult, type QuoteResult } from '../../src/lib/docread/corpus/score'

/*
 * The reader's corpus as pictures and scans (src/lib/docread/corpus; pasted text and PDFs run in corpus.test.ts): each fictional
 * enquiry or quote is rendered as the app or paper it imitates (Outlook, Gmail, WhatsApp, Excel, a printed page), photographed
 * at its scale, then given what a camera or a copier does to it (tilt, blur, shadow, low contrast, JPEG). Pictures go to the
 * picture reader, scans (the pictures saved as a PDF with no text layer) to the PDF reader, on /dev/docread under the production
 * Content-Security-Policy. The text is parsed there and scored here against the case's truth; every field of every set and
 * shape must stay at or above floor.ocr.json, and a clean screenshot must be read in 3 s or less (median).
 *     E2E_CSP=1 npx playwright test --project=docread e2e/docread/corpus.spec.ts
 *   CORPUS_OCR_BATCHES=0,10,11   batches to run (CI: 0)
 *   CORPUS_OCR_OUT=<file.json>   save every case's text ({ id: text }) for `CORPUS_OCR=<file> npx vitest run src/lib/docread/corpus`
 *   CORPUS_WRITE_FLOOR=1         record this run as the new floors
 *   CORPUS_IDS=e0-003,q0-005     only these cases;  CORPUS_SAVE=<dir>  save each picture there
 */

interface Read {
  ok: boolean
  text: string
  reason: string | null
  confidence: number | null
  ms: number
}

interface Docread {
  readImage(b64: string, type: string): Promise<Read>
  readPdf(b64: string): Promise<Read>
  parseEnquiry(text: string): EnquiryResult
  parseQuote(text: string, rfq: unknown): QuoteResult
}

const RUN = (process.env.CORPUS_OCR_BATCHES ?? '0').split(',').map(Number)
const FLOOR_FILE = 'src/lib/docread/corpus/floor.ocr.json'
const MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' } as const

async function photograph(browser: Browser, html: string, shot: Shot): Promise<string> {
  const ctx = await browser.newContext({ viewport: { width: shot.width, height: shot.phone ? 852 : 760 }, deviceScaleFactor: shot.scale })
  const page = await ctx.newPage()
  await page.setContent(html)
  const png = await page.screenshot({ fullPage: true })
  await ctx.close()
  return png.toString('base64')
}

/** What a camera or a copier does: tilt on a desk, blur, a shadow, low contrast, then the file format. Pages: for a scan. */
async function develop(page: Page, png: string, shot: Shot, pages: boolean): Promise<Array<{ b64: string; width: number; height: number }>> {
  return page.evaluate(
    async ({ png, shot, pages }) => {
      // Decoded from bytes, not loaded from a data: URL (the page runs under the production CSP).
      const bin = Uint8Array.from(atob(png), ch => ch.charCodeAt(0))
      const bmp = await createImageBitmap(new Blob([bin], { type: 'image/png' }))
      const img = { naturalWidth: bmp.width, naturalHeight: bmp.height }
      const tilt = ((shot.tilt ?? 0) * Math.PI) / 180
      const margin = shot.photo ? Math.round(0.06 * img.naturalWidth) : shot.tilt ? Math.round(Math.abs(Math.sin(tilt)) * img.naturalHeight * 0.5) + 10 : 0
      const c = document.createElement('canvas')
      c.width = img.naturalWidth + 2 * margin
      c.height = img.naturalHeight + 2 * margin
      const g = c.getContext('2d')!
      g.fillStyle = shot.photo ? '#4a443d' : '#ffffff'
      g.fillRect(0, 0, c.width, c.height)
      g.translate(c.width / 2, c.height / 2)
      g.rotate(tilt)
      const filters = [shot.blur ? `blur(${shot.blur}px)` : '', shot.contrast && shot.contrast !== 1 ? `contrast(${shot.contrast})` : '', shot.photo ? 'brightness(0.93) sepia(0.12)' : '', pages ? 'grayscale(1)' : '']
      g.filter = filters.filter(Boolean).join(' ') || 'none'
      g.drawImage(bmp, -img.naturalWidth / 2, -img.naturalHeight / 2)
      g.setTransform(1, 0, 0, 1, 0, 0)
      g.filter = 'none'
      if (shot.shadow) {
        const grad = g.createLinearGradient(0, 0, c.width, c.height * 0.4)
        grad.addColorStop(0, 'rgba(0,0,0,0.38)')
        grad.addColorStop(0.45, 'rgba(0,0,0,0.12)')
        grad.addColorStop(1, 'rgba(0,0,0,0)')
        g.fillStyle = grad
        g.fillRect(0, 0, c.width, c.height)
      }
      const mime = pages ? 'image/jpeg' : shot.format === 'png' ? 'image/png' : shot.format === 'webp' ? 'image/webp' : 'image/jpeg'
      const q = (shot.quality ?? 85) / 100
      if (!pages) return [{ b64: c.toDataURL(mime, q).split(',')[1]!, width: c.width, height: c.height }]
      // A scan: A4 pages cut from the long picture.
      const pageH = Math.round(c.width * 1.414)
      const out: Array<{ b64: string; width: number; height: number }> = []
      for (let y = 0; y < c.height; y += pageH) {
        const p = document.createElement('canvas')
        p.width = c.width
        p.height = pageH
        const pg = p.getContext('2d')!
        pg.fillStyle = '#fff'
        pg.fillRect(0, 0, p.width, p.height)
        pg.drawImage(c, 0, y, c.width, Math.min(pageH, c.height - y), 0, 0, c.width, Math.min(pageH, c.height - y))
        out.push({ b64: p.toDataURL('image/jpeg', q).split(',')[1]!, width: p.width, height: p.height })
      }
      return out
    },
    { png, shot, pages },
  )
}

test.describe.configure({ mode: 'serial' })

test('the corpus as pictures and scans: every field at or above its floor, a screenshot in 3 s', async ({ page, browser }) => {
  test.setTimeout(3_600_000)
  const violations: string[] = []
  page.on('console', m => {
    if (/Content.Security.Policy/i.test(m.text())) violations.push(m.text())
  })
  await page.goto('/dev/docread')
  await expect(page.getByRole('heading', { name: 'Read a picture' })).toBeVisible()
  const api = <K extends keyof Docread>(name: K, ...args: Parameters<Docread[K]>) =>
    page.evaluate(({ name, args }) => (window as unknown as { __docread: Record<string, (...a: unknown[]) => unknown> }).__docread[name]!(...args), { name, args }) as Promise<Awaited<ReturnType<Docread[K]>>>

  const only = process.env.CORPUS_IDS ? new Set(process.env.CORPUS_IDS.split(',')) : null
  // CORPUS_SHAPES=outlook_table: the dev cases of those shapes only (to work on one shape).
  const shapes = process.env.CORPUS_SHAPES ? new Set(process.env.CORPUS_SHAPES.split(',')) : null
  const cases: CorpusCase[] = RUN.flatMap(b => batch(b)).filter(
    c => (c.medium === 'image' || c.medium === 'scan') && (!only || only.has(c.id)) && (!shapes || (shapes.has(c.shape) && c.split === 'dev')),
  )
  const save = process.env.CORPUS_SAVE
  const scores: Scored[] = []
  const texts: Record<string, string> = {}
  const times: Array<{ id: string; ms: number; clean: boolean }> = []
  let first = true
  for (const c of cases) {
    const shot = c.shot as Shot
    const png = await photograph(browser, docHtml(c.doc, shot), shot)
    let read: Read
    if (c.medium === 'image') {
      // CORPUS_PICTURES=<dir>: the pictures CI saved (artifact "ocr-texts"), read here as CI read them.
      const ext = shot.format === 'jpeg' ? 'jpg' : shot.format
      const saved = process.env.CORPUS_PICTURES ? `${process.env.CORPUS_PICTURES}/${c.id}.${ext}` : null
      const [pic] = saved && existsSync(saved) ? [{ b64: readFileSync(saved).toString('base64') }] : await develop(page, png, shot, false)
      if (save) writeFileSync(`${save}/${c.id}.${shot.format === 'jpeg' ? 'jpg' : shot.format}`, Buffer.from(pic!.b64, 'base64'))
      read = await api('readImage', pic!.b64, MIME[shot.format])
      // A clean screenshot (not a photo, not a scan) on a laptop or a phone: the 3 s budget. The first read loads the engine.
      if (!first) times.push({ id: c.id, ms: read.ms, clean: !shot.photo && !shot.tilt })
      first = false
    } else {
      const pics = await develop(page, png, shot, true)
      if (save) pics.forEach((p, i) => writeFileSync(`${save}/${c.id}-p${i + 1}.jpg`, Buffer.from(p.b64, 'base64')))
      const pdf = await scanPdf(pics.map(p => ({ bytes: Buffer.from(p.b64, 'base64'), type: 'jpeg' as const, width: p.width, height: p.height })))
      read = await api('readPdf', Buffer.from(pdf).toString('base64'))
    }
    texts[c.id] = read.text
    const score =
      c.kind === 'enquiry' ? scoreEnquiry(c, await api('parseEnquiry', read.text)) : scoreQuote(c, await api('parseQuote', read.text, c.rfq))
    scores.push({ ...score, batch: c.batch, kind: c.kind })
    if (!score.perfect && c.split === 'dev') console.log(`--- ${c.id} ${c.shape} ${c.medium} (${read.ms} ms, conf ${read.confidence})\n${score.problems.join('\n')}`)
  }
  if (process.env.CORPUS_OCR_OUT) {
    const out = process.env.CORPUS_OCR_OUT
    const old = existsSync(out) ? (JSON.parse(readFileSync(out, 'utf8')) as Record<string, string>) : {}
    writeFileSync(out, JSON.stringify({ ...old, ...texts }, null, 1))
  }
  const g = evaluate(scores, 'pictures and scans')
  const floor = existsSync(FLOOR_FILE) ? (JSON.parse(readFileSync(FLOOR_FILE, 'utf8')) as Record<string, number>) : {}
  const drops = dropped(g.values, floor)
  if (process.env.CORPUS_WRITE_FLOOR === '1') writeFileSync(FLOOR_FILE, `${JSON.stringify(Object.fromEntries(Object.entries({ ...floor, ...g.values }).sort()), null, 2)}\n`)
  const clean = times.filter(t => t.clean).map(t => t.ms).sort((a, b) => a - b)
  const median = clean.length ? (clean[Math.floor(clean.length / 2)] as number) : 0
  const all = times.map(t => t.ms).sort((a, b) => a - b)
  const timing = `Picture reading time: clean screenshots median ${(median / 1000).toFixed(1)} s (n=${clean.length}, max ${(Math.max(0, ...clean) / 1000).toFixed(1)} s); all pictures median ${((all[Math.floor(all.length / 2)] ?? 0) / 1000).toFixed(1)} s, max ${(Math.max(0, ...all) / 1000).toFixed(1)} s`
  const summary = [...g.report, timing, g.belowBars.length ? `Below the owner's bars:\n${g.belowBars.join('\n')}` : "All owner's bars met.", drops.length ? `BELOW FLOOR:\n${drops.join('\n')}` : 'No field below its floor.']
  console.log(summary.join('\n'))
  // The measured values in one line, so the floors can be set from what CI's Linux browser reads (fonts render differently
  // from a Windows or Mac machine, so a local run is not the measure).
  console.log(`OCR_VALUES ${JSON.stringify(g.values)}`)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join('\n')}\n`)
  expect(violations, violations.join('\n')).toEqual([])
  expect(drops).toEqual([])
  expect(median, timing).toBeLessThanOrEqual(3000)
})

test('a scanned PDF is read page by page with progress, and can be cancelled', async ({ page, browser }) => {
  test.setTimeout(300_000)
  await page.goto('/dev/docread')
  const c = batch(0).find(x => x.medium === 'scan' && x.kind === 'enquiry') as CorpusCase
  const shot = c.shot as Shot
  const pics = await develop(page, await photograph(browser, docHtml(c.doc, shot), shot), shot, true)
  const pdf = await scanPdf(pics.map(p => ({ bytes: Buffer.from(p.b64, 'base64'), type: 'jpeg' as const, width: p.width, height: p.height })))
  await page.getByLabel('PDF').setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) })
  await expect(page.getByTestId('ocr-progress')).toHaveText(/^Reading the scan… \d{1,3}%$/, { timeout: 60_000 })
  const result = page.getByTestId('ocr-result')
  await expect(result).toBeVisible({ timeout: 180_000 })
  expect(await result.getAttribute('data-ok')).toBe('true')
  // Cancel: a second read stopped part way says nothing and leaves the page usable.
  await page.getByLabel('PDF').setInputFiles({ name: 'scan2.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) })
  await expect(page.getByTestId('ocr-progress')).toHaveText(/Reading the scan… \d+%/, { timeout: 60_000 })
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(result).toHaveAttribute('data-reason', 'aborted', { timeout: 60_000 })
})
