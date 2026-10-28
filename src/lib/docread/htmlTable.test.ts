import { describe, expect, it } from 'vitest'
import { parseEnquiry } from './enquiryParse'
import { htmlTableText, pastedText } from './htmlTable'

// Outlook's HTML for a pasted table: a fragment with a wide table, cells in <p> and <span>, empty cells, &nbsp;.
const OUTLOOK = `<html><body><!--StartFragment--><p class=MsoNormal>Please quote the items below.<o:p></o:p></p>
<table class=MsoNormalTable border=0 cellspacing=0 cellpadding=0>
<tr><td><p class=MsoNormal><b>Sr. #</b></p></td><td><p class=MsoNormal><b>Description</b></p></td><td><p class=MsoNormal><b>Qty</b></p></td><td><p class=MsoNormal><b>Reference #</b></p></td></tr>
<tr><td><p>01</p></td><td><p>Float Switch<br>XY-100 AV<br>Make: Acme</p></td><td><p>02</p></td><td><p>&nbsp;</p></td></tr>
<tr><td><p>02</p></td><td><p><span>Capacitive Sensor</span><span> AB-12</span></p></td><td><p>04</p></td><td><p>&nbsp;</p></td></tr>
</table><p>Regards,</p><!--EndFragment--></body></html>`

describe('htmlTableText', () => {
  it('turns a table into tab rows and keeps the text around it', () => {
    expect(htmlTableText(OUTLOOK)).toBe(
      ['Please quote the items below.', 'Sr. #\tDescription\tQty\tReference #', '01\tFloat Switch XY-100 AV Make: Acme\t02', '02\tCapacitive Sensor AB-12\t04', 'Regards,'].join('\n'),
    )
  })

  it('is null when the HTML has no table, so the plain text is read as before', () => {
    expect(htmlTableText('<p>Please quote 2 nos valve</p>')).toBeNull()
    const data = { getData: (t: string) => (t === 'text/html' ? '<p>x</p>' : 'Please quote 2 nos valve') }
    expect(pastedText(data)).toBe('Please quote 2 nos valve')
  })

  it('pastedText prefers the HTML table; the enquiry reader then reads the rows', () => {
    const data = { getData: (t: string) => (t === 'text/html' ? OUTLOOK : 'Sr. #\n\nDescription\n\nQty\n\n01\n\nFloat Switch\n\n02') }
    const r = parseEnquiry(pastedText(data), { today: '2026-10-20' })
    expect(r.items.map(i => [i.description, i.qty])).toEqual([
      ['Float Switch XY-100 AV Make: Acme', 2],
      ['Capacitive Sensor AB-12', 4],
    ])
  })

  it('a table of nested tables flattens into the cell text', () => {
    const html = '<table><tr><td>Item</td><td>Qty</td></tr><tr><td><table><tr><td>Relay</td><td>24V</td></tr></table></td><td>3</td></tr></table>'
    expect(htmlTableText(html)).toBe('Item\tQty\nRelay 24V\t3')
  })
})

describe('M9: a layout table keeps its lines', () => {
  const body = '<table><tr><td><p>Dear Sir,</p><p>1. Alpha relay 3RT-1 - 10 nos</p><p>2. Beta gauge 0-10 bar - 2 nos</p><p>3. Gamma sensor M18 - 5 nos</p><p>Regards</p></td></tr></table>'
  it('puts each paragraph of a one-column wrapper on its own line', () => {
    expect(htmlTableText(body)).toBe(['Dear Sir,', '1. Alpha relay 3RT-1 - 10 nos', '2. Beta gauge 0-10 bar - 2 nos', '3. Gamma sensor M18 - 5 nos', 'Regards'].join('\n'))
  })
  it('reads the third item with its quantity of 5', () => {
    const r = parseEnquiry(htmlTableText(body) ?? '', { today: '2026-10-20' })
    expect(r.items.find(i => /Gamma/.test(i.description))?.qty).toBe(5)
  })
  it('still reads a real data table as tab rows inside a wrapper', () => {
    const wrapped = '<table><tr><td><p>Hello</p>' + OUTLOOK.replace(/<\/?(?:html|body)>/g, '') + '</td></tr></table>'
    expect(htmlTableText(wrapped)).toContain('01\tFloat Switch XY-100 AV Make: Acme\t02')
  })
})
