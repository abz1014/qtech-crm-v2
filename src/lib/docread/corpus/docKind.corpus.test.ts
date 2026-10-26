// The document-type check against the whole corpus: no enquiry may be blocked (0 wrongly blocked), no supplier quotation may be
// called an enquiry, an order or our own paper, and every non-enquiry document (gen31.ts) must be told apart correctly.
import { beforeAll, describe, expect, it } from 'vitest'
import { classifyDoc, NOT_A_SUPPLIER_QUOTE, NOT_AN_ENQUIRY } from '../docKind'
import { readPdfText } from '../pdfText'
import { BATCHES, batch } from './corpus'
import { NON_RFQ_CASES } from './gen31'
import { docPdf } from './pdf'
import { docText } from './text'

beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
})


describe('document kind over the corpus', () => {
  it('never blocks an enquiry, and never calls a supplier quotation an enquiry or our own paper', async () => {
    const wrong: string[] = []
    let enquiries = 0
    let asRfq = 0
    let quotes = 0
    let asQuote = 0
    const seen: Record<string, number> = {}
    for (const b of BATCHES.filter(x => x.gate)) {
      for (const c of batch(b.batch)) {
        let text: string
        if (c.medium === 'text') text = docText(c.doc, c.textStyle)
        else if (c.medium === 'pdf') {
          const pdf = await readPdfText(await docPdf(c.doc))
          text = pdf.ok ? pdf.text : ''
        } else continue
        const k = classifyDoc(text)
        seen[`${c.kind}:${k.kind}`] = (seen[`${c.kind}:${k.kind}`] ?? 0) + 1
        if (c.kind === 'enquiry') {
          enquiries++
          if (k.kind === 'rfq') asRfq++
          if (NOT_AN_ENQUIRY.includes(k.kind)) wrong.push(`${c.id} ${c.shape} ${c.medium} -> ${k.kind} (${k.reasons.join('; ')})`)
        } else {
          quotes++
          if (k.kind === 'supplier-quote') asQuote++
          if (NOT_A_SUPPLIER_QUOTE.includes(k.kind)) wrong.push(`${c.id} ${c.shape} ${c.medium} -> ${k.kind} (${k.reasons.join('; ')})`)
        }
      }
    }
    console.log(`enquiries ${enquiries}: classified rfq ${asRfq}; quotes ${quotes}: classified supplier-quote ${asQuote}; ${JSON.stringify(seen)}`)
    expect(wrong.slice(0, 40)).toEqual([])
    // Every enquiry is "rfq" (not merely unblocked); a supplier quotation may rarely be "unknown" (a one-line chat price), never an enquiry.
    expect(asRfq).toBe(enquiries)
    expect(asQuote / quotes).toBeGreaterThanOrEqual(0.99)
  }, 600_000)

  it('tells every non-enquiry document (gen31) from an enquiry, as text and as PDF', async () => {
    const wrong: string[] = []
    const byKind: Record<string, [number, number]> = {}
    for (const c of NON_RFQ_CASES) {
      let text: string
      if (c.medium === 'text') text = docText(c.doc, c.textStyle)
      else {
        const pdf = await readPdfText(await docPdf(c.doc))
        text = pdf.ok ? pdf.text : ''
      }
      const k = classifyDoc(text)
      const t = byKind[c.kind] ?? [0, 0]
      t[1]++
      if (k.kind === c.kind) t[0]++
      else wrong.push(`${c.id} ${c.medium} -> ${k.kind} ${k.confidence} (${k.reasons.join('; ')})`)
      byKind[c.kind] = t
    }
    const total = NON_RFQ_CASES.length
    console.log(`gen31: ${total - wrong.length}/${total} classified correctly; ${JSON.stringify(byKind)}`)
    expect(wrong).toEqual([])
  }, 120_000)
})
