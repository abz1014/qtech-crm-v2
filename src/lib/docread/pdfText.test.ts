import { beforeAll, describe, expect, it } from 'vitest'
import { letterPdf, lockedPdf, placedPdf, quotationPdf, scanPdf, tableItems, type Placed } from '@/test/pdfFixtures'
import { isPdfFile, pdfFailureMessage, readPdfText } from './pdfText'

// Under Node pdf.js runs its worker in-process ("fake worker") from globalThis.pdfjsWorker; loading the worker module sets it.
// The module under test still loads pdf.js through its own lazy runtime (pdfjsRuntime.ts), as the browser does.
beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
})

describe('readPdfText', () => {
  it('reads a letter enquiry line by line', async () => {
    const pdf = await letterPdf([
      'Dear Sir,',
      'Please quote your best price for the following:',
      '',
      '1. Pressure transmitter 0-10 bar, 4-20mA - 2 Nos',
      '2. Temperature transmitter PT100 - 4 Nos',
      '',
      'Regards,',
      'Purchase Department',
    ])
    const r = await readPdfText(pdf)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.text).toBe(
      [
        'Dear Sir,',
        'Please quote your best price for the following:',
        '',
        '1. Pressure transmitter 0-10 bar, 4-20mA - 2 Nos',
        '2. Temperature transmitter PT100 - 4 Nos',
        '',
        'Regards,',
        'Purchase Department',
      ].join('\n'),
    )
    expect(r).toMatchObject({ pageCount: 1, pagesRead: 1, truncated: false, pagesWithoutText: [] })
  })

  it('reads a table quote as rows: one tab-separated row per item, the wrapped description folded back in', async () => {
    const r = await readPdfText(await quotationPdf())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const lines = r.text.split('\n')
    expect(lines).toContain('Quotation No: BAT-Q-2026-0412')
    expect(lines).toContain('Date: 15/10/2026') // the right-hand part of the letterhead is its own line
    expect(lines).toContain('Your Ref: QT-RFQ-0118')
    expect(lines).toContain(['No.', 'Part No.', 'Description', 'Qty', 'Unit', 'Unit Price (USD)', 'Amount (USD)'].join('\t'))
    expect(lines).toContain(['1', '6ES7214-1AG40-0XB0', 'SIMATIC S7-1200 CPU 1214C DC/DC/DC, 14 DI / 10 DO', '2', 'PCS', '285.00', '570.00'].join('\t'))
    expect(lines).toContain(['2', '6EP1334-2BA20', 'SITOP PSU100S 24 V/10 A', '1', 'PCS', '142.50', '142.50'].join('\t'))
    expect(lines).toContain(['3', '3RT2026-1BB40', 'Contactor 24VDC coil', '4', 'PCS', '38.20', '152.80'].join('\t'))
    expect(lines).toContain(['', '', '', '', '', 'Sub Total', '865.30'].join('\t'))
    expect(lines).toContain('Delivery: 3-4 weeks after PO')
    expect(lines).toContain('Validity: 30 days')
    // every row of the table has the header's number of cells
    expect(r.lines.filter(l => l.kind === 'row').every(l => l.cells.length === 7)).toBe(true)
    expect(r.tableRows).toBe(4)
  })

  it('accepts a File and an ArrayBuffer as well as bytes', async () => {
    const bytes = await letterPdf(['Please quote 2 nos gate valve 4 inch'])
    const copy = new Uint8Array(bytes)
    const file = new File([copy], 'enquiry.pdf', { type: 'application/pdf' })
    const fromFile = await readPdfText(file)
    const fromBuffer = await readPdfText(copy.buffer)
    expect(fromFile.ok && fromFile.text).toBe('Please quote 2 nos gate valve 4 inch')
    expect(fromBuffer.ok && fromBuffer.text).toBe('Please quote 2 nos gate valve 4 inch')
  })

  it('reads a table that runs onto the next page, with the header written again', async () => {
    const columns = [
      { x: 40, header: 'S.No' },
      { x: 80, header: 'Description' },
      { x: 400, header: 'Qty', right: 430 },
      { x: 445, header: 'Unit' },
    ]
    const p1 = tableItems({ top: 600, descColumn: 1, columns, rows: Array.from({ length: 8 }, (_, i) => [String(i + 1), `Ball valve DN${15 + i * 5}`, '2', 'Nos']) })
    const footer: Placed = { text: 'Page 1 of 2', x: 270, y: 820, size: 8 }
    const p2 = tableItems({ top: 60, descColumn: 1, columns, rows: [['9', 'Gate valve DN100', '1', 'Nos']] })
    // page 2 starts with the next row, not a header
    const page2 = p2.items.filter(i => !['S.No', 'Description', 'Qty', 'Unit'].includes(i.text))
    const r = await readPdfText(await placedPdf([[...p1.items, footer], page2]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.text).not.toContain('Page 1 of 2')
    expect(r.text.split('\n')).toContain(['9', 'Gate valve DN100', '1', 'Nos'].join('\t'))
    expect(r.lines.filter(l => l.kind === 'header')).toHaveLength(2)
    expect(r.pageCount).toBe(2)
  })

  it('says a scan is a scan', async () => {
    const r = await readPdfText(await scanPdf(2))
    expect(r).toEqual({ ok: false, reason: 'scan', message: 'This PDF is a scan; type or paste the items.', pageCount: 2 })
    const q = await readPdfText(await scanPdf(1, 'Scanned with CamScanner'), { subject: 'prices' })
    expect(q).toMatchObject({ ok: false, reason: 'scan', message: 'This PDF is a scan; type or paste the prices.' })
  })

  it('lists scanned pages inside a PDF that has text elsewhere', async () => {
    const text: Placed[] = [{ text: 'Please quote 3 nos solenoid valve 1/2 inch 24VDC', x: 56, y: 80, size: 10 }]
    const r = await readPdfText(await placedPdf([text, []]))
    expect(r).toMatchObject({ ok: true, pagesWithoutText: [2], pagesRead: 2 })
  })

  it('says a password-protected PDF is locked', async () => {
    const r = await readPdfText(await lockedPdf())
    expect(r).toMatchObject({ ok: false, reason: 'password' })
    expect(!r.ok && r.message).toBe('This PDF is locked with a password. Open it, copy the text and paste it here, or type or paste the items.')
  })

  it('refuses a file over the size limit before reading it', async () => {
    const bytes = await letterPdf(['x'])
    let loaded = false
    const r = await readPdfText(bytes, {
      maxBytes: 100,
      load: async () => {
        loaded = true
        throw new Error('not reached')
      },
    })
    expect(r).toMatchObject({ ok: false, reason: 'too_big' })
    expect(loaded).toBe(false)
    expect(!r.ok && r.message).toMatch(/limit is 0 MB|limit is/)
  })

  it('refuses a file that is not a PDF, without loading pdf.js', async () => {
    let loaded = false
    const r = await readPdfText(new TextEncoder().encode('Hello, this is a text file'), {
      load: async () => {
        loaded = true
        throw new Error('not reached')
      },
    })
    expect(r).toMatchObject({ ok: false, reason: 'not_pdf', message: 'This file is not a PDF. Paste the text, or type or paste the items.' })
    expect(loaded).toBe(false)
  })

  it('says a damaged PDF could not be read', async () => {
    const r = await readPdfText(new TextEncoder().encode('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF'))
    expect(r).toMatchObject({ ok: false, reason: 'unreadable' })
  })

  it('reads at most the page limit and says the file was cut short', async () => {
    const pages: Placed[][] = Array.from({ length: 4 }, (_, i) => [{ text: `Page ${i + 1} item: cable gland M20 qty 10`, x: 56, y: 80, size: 10 }])
    const r = await readPdfText(await placedPdf(pages), { maxPages: 2 })
    expect(r).toMatchObject({ ok: true, pageCount: 4, pagesRead: 2, truncated: true })
    expect(r.ok && r.text).toBe('Page 1 item: cable gland M20 qty 10\n\nPage 2 item: cable gland M20 qty 10')
  })

  it('stops when the person cancels', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const r = await readPdfText(await letterPdf(['Please quote']), { signal: ctrl.signal })
    expect(r).toMatchObject({ ok: false, reason: 'aborted', message: '' })
  })

  it('says when the reader itself could not be loaded (offline on first use)', async () => {
    const r = await readPdfText(await letterPdf(['Please quote']), {
      load: () => Promise.reject(new Error('Failed to fetch dynamically imported module')),
    })
    expect(r).toMatchObject({ ok: false, reason: 'unreadable' })
  })
})

describe('isPdfFile and messages', () => {
  it('knows a PDF by type or by name', () => {
    expect(isPdfFile({ type: 'application/pdf', name: 'x' })).toBe(true)
    expect(isPdfFile({ type: '', name: 'Quotation.PDF' })).toBe(true)
    expect(isPdfFile({ type: 'image/jpeg', name: 'photo.jpg' })).toBe(false)
  })

  it('words the size limit', () => {
    expect(pdfFailureMessage('too_big', 'prices', 18.4 * 1024 * 1024)).toBe(
      'This PDF is 18.4 MB; the limit is 15 MB. Copy the text from it and paste it here, or type or paste the prices.',
    )
  })
})
