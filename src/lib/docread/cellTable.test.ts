import { describe, expect, it } from 'vitest'
import { alignSpacedRows, rebuildCellText } from './cellTable'
import { parseEnquiry } from './enquiryParse'

describe('rebuildCellText: a table copied one cell per line', () => {
  it('puts the rows back, a missing cell left empty, a quantity equal to the next serial kept', () => {
    const text = ['Sr. No', 'Particulars', 'Part No', 'QTY', 'UOM', '1', 'Limit switch rod lever', '6', 'PC', '2', 'Contactor 9A', 'LC1D09M7', '4', 'Nos'].join('\n')
    expect(rebuildCellText(text).split('\n')).toEqual(['Sr. No\tParticulars\tPart No\tQTY\tUOM', '1\tLimit switch rod lever\t\t6\tPC', '2\tContactor 9A\tLC1D09M7\t4\tNos'])
  })

  it('stops at the sentence under the table', () => {
    const text = ['#', 'Description', 'Qty', 'Unit', '1', 'Ball valve 1 inch', '4', 'Each', 'Last date for submission: 3 November 2026'].join('\n')
    const r = parseEnquiry(text, { today: '2026-10-20' })
    expect(r.items).toEqual([{ description: 'Ball valve 1 inch', qty: 4, unit: 'Each' }])
    expect(r.facts.dueDate?.iso).toBe('2026-11-03')
  })

  it('leaves other text alone', () => {
    expect(rebuildCellText('Dear Sir,\nPlease quote 2 nos valve')).toBe('Dear Sir,\nPlease quote 2 nos valve')
  })
})

describe('alignSpacedRows: columns lined up with spaces', () => {
  it('keeps a row\'s empty cells, so its quantity stays under Qty', () => {
    const lines = [
      'Item    Description                 Model No.     Make       Qty    Units',
      '1       Fuse 100A                                 Lumenta     150    EA',
      '2       Gasket set for pump 50-200                              4    Set',
    ]
    expect(alignSpacedRows(lines)).toEqual(['Item\tDescription\tModel No.\tMake\tQty\tUnits', '1\tFuse 100A\t\tLumenta\t150\tEA', '2\tGasket set for pump 50-200\t\t\t4\tSet'])
  })
})
