import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseSupplierQuote } from './supplierQuoteParse'
import { classifyDoc } from './docKind'
import { parseEnquiry } from './enquiryParse'
import { htmlTableText, pastedText, readClipboardText } from './htmlTable'

// Synthetic Outlook-style clipboard HTML (no real names, emails or quotes): mso classes, <o:p>, nested spans, colspan, empty cells.
const OUTLOOK_ENQUIRY = `<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><style>p.MsoNormal{margin:0}</style>
<!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/></o:OfficeDocumentSettings></xml><![endif]--></head>
<body lang=EN-US style='tab-interval:36.0pt'><!--StartFragment-->
<xml><o:OfficeDocumentSettings><o:AllowPNG/></o:OfficeDocumentSettings></xml>
<p class=MsoNormal><span style='font-size:11.0pt'>Dear Sir,<o:p></o:p></span></p>
<p class=MsoNormal><span>Please quote the following.</span><o:p>&nbsp;</o:p></p>
<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0 width=600>
<tr style='height:15.0pt'>
<td width=40 valign=top style='border:solid windowtext 1.0pt'><p class=MsoNormal><b><span style='mso-bidi-font-weight:normal'>S/N</span></b><o:p></o:p></p></td>
<td width=300 valign=top><p class=MsoNormal align=center><b><span>Description</span></b><o:p></o:p></p></td>
<td width=60 valign=top><p class=MsoNormal><b><span>Qty</span></b></p></td>
<td width=100 valign=top><p class=MsoNormal><b><span>Remarks</span></b></p></td></tr>
<tr><td><p class=MsoNormal><span>1</span></p></td>
<td><p class=MsoNormal><span>Ball valve </span><span><span>DN50 PN16</span></span><span style='mso-spacerun:yes'>  </span><span>SS316</span></p></td>
<td><p class=MsoNormal><span>6</span><span> nos</span></p></td>
<td><p class=MsoNormal><span>&nbsp;</span><o:p></o:p></p></td></tr>
<tr><td><p class=MsoNormal><span>2</span></p></td>
<td><p class=MsoNormal><span>Pressure gauge 0-10 bar</span><br><span>Make: Acme</span></p></td>
<td><p class=MsoNormal><span>12</span></p></td>
<td><p class=MsoNormal><span>Urgent</span></p></td></tr>
<tr><td colspan=2><p class=MsoNormal><span>3  Level switch float type</span></p></td>
<td><p class=MsoNormal><span>4</span></p></td><td></td></tr>
</table>
<p class=MsoNormal><o:p>&nbsp;</o:p></p><p class=MsoNormal>Regards,<o:p></o:p></p><p class=MsoNormal>Sample Buyer<o:p></o:p></p><!--EndFragment--></body></html>`

const OUTLOOK_REPLY = `<html><body><!--StartFragment--><p class=MsoNormal><span>Hello, our offer:</span><o:p></o:p></p>
<table class=MsoNormalTable border=0 cellspacing=0 cellpadding=0>
<tr><td><p class=MsoNormal><b>Item</b></p></td><td><p class=MsoNormal><b>Description</b></p></td><td><p class=MsoNormal><b>Qty</b></p></td><td><p class=MsoNormal><b>Unit Price (USD)</b></p></td><td><p class=MsoNormal><b>Lead time</b></p></td></tr>
<tr><td><p class=MsoNormal><span>1</span></p></td><td><p class=MsoNormal><span>Ball valve </span><span><span>DN50 PN16</span></span></p></td><td><p class=MsoNormal>6</p></td><td><p class=MsoNormal><span>45.00</span></p></td><td><p class=MsoNormal><span>2 weeks</span></p></td></tr>
<tr><td><p class=MsoNormal><span>2</span></p></td><td><p class=MsoNormal><span>Pressure gauge 0-10 bar</span></p></td><td><p class=MsoNormal>12</p></td><td><p class=MsoNormal><span>18.50</span></p></td><td><p class=MsoNormal><span>2 weeks</span></p></td></tr>
</table><!--EndFragment--></body></html>`

const PLAIN_FLAT = 'S/N\n\nDescription\n\nQty\n\n1\n\nBall valve DN50 PN16 SS316\n\n6'

describe('htmlTableText: Outlook mso markup', () => {
  it('reads nested spans, <o:p>, br and empty cells into tab rows, and ignores the mso xml block', () => {
    const t = htmlTableText(OUTLOOK_ENQUIRY) as string
    const lines = t.split('\n')
    expect(lines).toContain('S/N\tDescription\tQty\tRemarks')
    expect(lines).toContain('1\tBall valve DN50 PN16 SS316\t6 nos')
    expect(lines).toContain('2\tPressure gauge 0-10 bar Make: Acme\t12\tUrgent')
    expect(t).not.toMatch(/AllowPNG|OfficeDocumentSettings|MsoNormal/)
  })

  it('a colspan cell leaves the columns it covers empty, so the cells after it keep their column', () => {
    const t = htmlTableText(OUTLOOK_ENQUIRY) as string
    expect(t.split('\n')).toContain('3 Level switch float type\t\t4')
  })

  it('an all-empty row and an empty trailing cell leave no stray tabs', () => {
    const html = '<table><tr><td>A</td><td>B</td><td></td></tr><tr><td>&nbsp;</td><td><span> </span></td></tr><tr><td></td><td>x</td></tr></table>'
    expect(htmlTableText(html)).toBe('A\tB\n\tx')
  })

  it('a huge colspan is capped, not expanded without limit', () => {
    const t = htmlTableText('<table><tr><td colspan=100000>a</td><td>b</td></tr></table>') as string
    expect(t.split('\t').length).toBeLessThanOrEqual(22)
  })
})

describe('Intake / ItemsEditor path: pastedText then parseEnquiry', () => {
  const data = (html: string, plain = PLAIN_FLAT) => ({ getData: (t: string) => (t === 'text/html' ? html : t === 'text/plain' ? plain : '') })

  it('reads the items of an Outlook table with their quantities', () => {
    const r = parseEnquiry(pastedText(data(OUTLOOK_ENQUIRY)), { today: '2026-10-20' })
    const by = (re: RegExp) => r.items.find(i => re.test(i.description))
    expect(by(/Ball valve/)?.qty).toBe(6)
    expect(by(/Pressure gauge/)?.qty).toBe(12)
    expect(by(/Level switch/)?.qty).toBe(4)
    expect(r.items).toHaveLength(3)
  })

  it('an enquiry pasted from Outlook is still classed as an enquiry', () => {
    expect(classifyDoc(pastedText(data(OUTLOOK_ENQUIRY))).kind).toBe('rfq')
  })

  it('falls back to the plain text when the HTML has no table or getData throws', () => {
    expect(pastedText(data('<p>hi</p>', 'Please quote 2 nos valve'))).toBe('Please quote 2 nos valve')
    const throwing = {
      getData: (t: string) => {
        if (t === 'text/html') throw new Error('denied')
        return 'plain only'
      },
    }
    expect(pastedText(throwing)).toBe('plain only')
    expect(pastedText(null)).toBe('')
  })
})

describe('PasteReply path: pastedText then parseSupplierQuote', () => {
  it('reads the prices from the Outlook reply table in their own rows', () => {
    const text = pastedText({ getData: (t: string) => (t === 'text/html' ? OUTLOOK_REPLY : '') })
    const items = [
      { id: 'a', description: 'Ball valve DN50 PN16', qty: 6 },
      { id: 'b', description: 'Pressure gauge 0-10 bar', qty: 12 },
    ]
    const r = parseSupplierQuote(text, items, { today: '2026-10-20' })
    const price = (id: string) => r.offers.find(o => o.rfqItemId === id)?.unitPrice
    expect(price('a')).toBe(45)
    expect(price('b')).toBe(18.5)
  })
})

describe('readClipboardText: permission denied falls back to text cleanly', () => {
  const setClip = (clip: unknown) => Object.defineProperty(navigator, 'clipboard', { value: clip, configurable: true })
  afterEach(() => setClip(undefined))

  it('clipboard.read() rejects: readText is used', async () => {
    setClip({ read: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')), readText: vi.fn().mockResolvedValue('plain words') })
    await expect(readClipboardText()).resolves.toBe('plain words')
  })

  it('both rejected: an empty string, no throw', async () => {
    setClip({ read: vi.fn().mockRejectedValue(new Error('x')), readText: vi.fn().mockRejectedValue(new Error('y')) })
    await expect(readClipboardText()).resolves.toBe('')
  })

  it('no read(): readText alone; no clipboard at all: empty', async () => {
    setClip({ readText: vi.fn().mockResolvedValue('only text') })
    await expect(readClipboardText()).resolves.toBe('only text')
    setClip(undefined)
    await expect(readClipboardText()).resolves.toBe('')
  })

  it('reads the HTML table when the browser allows it', async () => {
    const blob = { text: async () => '<table><tr><td>a</td><td>b</td></tr></table>' }
    setClip({ read: vi.fn().mockResolvedValue([{ types: ['text/html'], getType: async () => blob }]), readText: vi.fn() })
    await expect(readClipboardText()).resolves.toBe('a\tb')
  })
})
