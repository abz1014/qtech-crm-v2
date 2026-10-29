import { describe, expect, it } from 'vitest'
import { rebuildCellTables, rebuildHeaderlessLists } from './cellTable'
import { parseEnquiry } from './enquiryParse'

const parse = (t: string) => parseEnquiry(t, { today: '2026-10-20' })
/** An email as a mail client double-spaces it: a blank line after every line. */
const spaced = (lines: string[]) => lines.join('\n\n')

describe('double-spaced prose email: no table is built from its sentences', () => {
  const PROSE = [
    'Dear Sir,',
    'Hope you are well.',
    'We are looking for a few things for the new plant.',
    'Please quote 4 nos float switch type XY-100 for us.',
    'Description of the duty is attached with this mail.',
    'The quantity needed is flexible for now.',
    'Our unit price expectation is not fixed either.',
    'Delivery to our Lahore store is preferred.',
    'Item numbers are in the attachment.',
    'Please reply by return of mail.',
    'Thanks and regards,',
    'Sample Buyer',
    'Purchase Officer',
    'Tel: 042-0000000',
  ]

  /** What the reader makes of the same lines written one under the other: a table built only from double spacing would differ. */
  const same = (lines: string[], compare = true) => {
    const r = parse(spaced(lines))
    expect(r.items.some(i => i.description.includes('\t'))).toBe(false)
    expect(r.lines.some(l => l.text.includes('\t'))).toBe(false)
    if (compare) expect(r.items).toEqual(parse(lines.join('\n')).items)
    return r
  }

  it('builds no table from the sentences, and still reads the real request', () => {
    const r = same(PROSE)
    expect(r.items.some(i => i.qty === 4 && /float switch/.test(i.description))).toBe(true)
  })

  it('column words on lines of their own inside prose do not start a table', () => {
    same(['Dear Sir,', 'Hello', 'Description', 'Quantity', 'Unit', 'Price', 'are what I need you to confirm,', 'because the last quote was unclear.', 'We have nothing else to add today.', 'Please call me back.', 'Thanks again for your help.', 'Best regards,', 'Sample Buyer'], false)
  })

  it('numbers and short lines in a signature are not paired into rows', () => {
    same(['Dear Sir,', 'Good morning.', 'Kindly note our office has moved.', 'Our new address is below.', 'Sample Industries', '12', 'Industrial Estate', '3', 'Block B', 'Regards,', 'Sample Buyer', 'Procurement'])
  })

  it('the table rebuilders leave the sentences as they are, with blank lines ignored', () => {
    const src = PROSE.map((t, i) => ({ t, blankBefore: i > 0 }))
    const before = src.map(x => x.t)
    expect(rebuildCellTables(src, () => false, { ignoreBlank: true })).toBe(false)
    expect(rebuildHeaderlessLists(src, { ignoreBlank: true })).toBe(false)
    expect(src.map(x => x.t)).toEqual(before)
  })
})

describe('double-spaced one-cell-per-line table: still rebuilt', () => {
  const HEAD = ['Sr.', 'Description', 'Qty', 'Remarks']
  const ROWS = ['1', 'Ball valve DN50 PN16', '6', 'Urgent', '2', 'Pressure gauge 0-10 bar', '12', ' ', '3', 'Level switch float type', '4', ' ']
  const text = spaced(['Dear Sir,', 'Please quote the following.', ...HEAD, ...ROWS.map(c => c.trim() || '-'), 'Regards,', 'Sample Buyer'])

  it('reads every row with its quantity', () => {
    const r = parse(text)
    expect(r.items.map(i => [i.description, i.qty])).toEqual([
      ['Ball valve DN50 PN16', 6],
      ['Pressure gauge 0-10 bar', 12],
      ['Level switch float type', 4],
    ])
  })

  it('a headerless description / quantity / unit list is rebuilt into rows', () => {
    const r = parse(spaced(['Please quote:', 'Soldering iron TQ95-01', '2', 'EA', 'Heat gun HG-200', '5', 'EA', 'Multimeter MM-10', '3', 'EA', 'Regards,', 'Sample Buyer', 'Thanks']))
    expect(r.items.map(i => [i.description, i.qty, i.unit])).toEqual([
      ['Soldering iron TQ95-01', 2, 'EA'],
      ['Heat gun HG-200', 5, 'EA'],
      ['Multimeter MM-10', 3, 'EA'],
    ])
  })
})
