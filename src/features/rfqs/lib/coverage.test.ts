import { describe, expect, it } from 'vitest'
import {
  askedReachText,
  cellStatus,
  filterItems,
  gapOf,
  gapText,
  groupByBrand,
  hasReplied,
  itemSummary,
  openWords,
  pricesWord,
  shortNames,
  showBoard,
  sortSuppliers,
  supplierCounts,
  supplierCountsText,
  supplierReach,
  supplierStage,
  type CoverageInquiry,
} from '@/features/rfqs/lib/coverage'

const items = [1, 2, 3, 4, 5].map(n => ({ id: `it${n}`, number: n, description: `Part ${n} 6ES7${n}`, brandName: n <= 3 ? 'Siemens' : 'WIKA' }))

function inq(over: Partial<CoverageInquiry> & { id: string }): CoverageInquiry {
  return {
    supplierId: `s-${over.id}`,
    supplierName: `Supplier ${over.id}`,
    supplierCountry: null,
    sentOn: '2026-11-17',
    noOfferOn: null,
    itemDeclines: {},
    itemWaits: {},
    askedItemIds: null,
    responseState: 'awaiting',
    lines: [],
    ...over,
  }
}

const priced = (...ids: string[]) => ids.map(itemId => ({ itemId }))

describe('cellStatus', () => {
  it('reads priced, cannot, later, left out, no reply and not asked', () => {
    const a = inq({ id: 'a', lines: priced('it1'), itemDeclines: { it2: 'discontinued' }, itemWaits: { it3: true }, responseState: 'quoted' })
    expect(cellStatus(a, 'it1')).toBe('priced')
    expect(cellStatus(a, 'it2')).toBe('cannot')
    expect(cellStatus(a, 'it3')).toBe('later')
    expect(cellStatus(a, 'it4')).toBe('left-out')
    expect(cellStatus(inq({ id: 'b' }), 'it1')).toBe('no-reply')
    expect(cellStatus(inq({ id: 'c', askedItemIds: ['it1'] }), 'it2')).toBe('not-asked')
  })

  it('a whole cannot quote covers only the items asked about', () => {
    const c = inq({ id: 'c', askedItemIds: ['it1'], noOfferOn: '2026-11-18', responseState: 'no_offer' })
    expect(cellStatus(c, 'it1')).toBe('cannot')
    expect(cellStatus(c, 'it2')).toBe('not-asked')
  })

  it('uses the reply chip rule for replied', () => {
    expect(hasReplied(inq({ id: 'a', responseState: 'quoted' }))).toBe(true)
    expect(hasReplied(inq({ id: 'a', noOfferOn: '2026-11-18' }))).toBe(true)
    expect(hasReplied(inq({ id: 'a', lines: priced('it1') }))).toBe(true)
    expect(hasReplied(inq({ id: 'a' }))).toBe(false)
  })
})

describe('item summary', () => {
  const list = [inq({ id: 'a', lines: priced('it1'), responseState: 'quoted', itemWaits: { it2: true } }), inq({ id: 'b' })]
  it('counts prices and who still has to answer', () => {
    const s = itemSummary(list, 'it1')
    expect(s.counts.priced).toBe(1)
    expect(s.noPrice).toBe(false)
    expect(pricesWord(s.counts.priced)).toBe('1 price')
    expect(openWords(s.counts)).toBe('1 no reply')
    const two = itemSummary(list, 'it2')
    expect(two.noPrice).toBe(true)
    expect(two.open).toBe(true)
    expect(pricesWord(0)).toBe('No price')
    expect(openWords(two.counts)).toBe('1 later · 1 no reply')
  })
})

describe('supplier counts and order', () => {
  it('says what a supplier was asked and answered', () => {
    const a = inq({ id: 'a', askedItemIds: ['it1', 'it2'], lines: priced('it1'), itemDeclines: { it2: 'x' }, responseState: 'quoted' })
    const c = supplierCounts(a, items)
    expect(c.asked).toBe(2)
    expect(supplierCountsText(c)).toBe('Asked for 2 of 5 · 1 priced · 1 cannot')
    const all = inq({ id: 'b', lines: priced('it1', 'it2'), responseState: 'quoted' })
    expect(supplierCountsText(supplierCounts(all, items))).toBe('Asked for all 5 · 2 priced · 3 left out')
  })

  it('sorts no reply first, then quoting later, then complete, shortlist last', () => {
    const done = inq({ id: 'done', lines: priced('it1'), responseState: 'quoted' })
    const later = inq({ id: 'later', lines: priced('it1'), itemWaits: { it2: true }, responseState: 'quoted' })
    const silent = inq({ id: 'silent' })
    const shortlist = inq({ id: 'short', sentOn: null })
    expect(supplierStage(silent, items)).toBe('no-reply')
    expect(supplierStage(later, items)).toBe('later')
    expect(supplierStage(done, items)).toBe('done')
    expect(sortSuppliers([shortlist, done, later, silent], items).map(i => i.id)).toEqual(['silent', 'later', 'done', 'short'])
  })
})

describe('local and international', () => {
  it('Pakistan is local in any case, unknown is neither', () => {
    expect(supplierReach('Pakistan')).toBe('local')
    expect(supplierReach(' PK ')).toBe('local')
    expect(supplierReach('pakistan')).toBe('local')
    expect(supplierReach('China')).toBe('international')
    expect(supplierReach(null)).toBe(null)
    expect(supplierReach('  ')).toBe(null)
  })

  it('counts the suppliers asked by reach', () => {
    const list = [inq({ id: 'a', supplierCountry: 'Pakistan' }), inq({ id: 'b', supplierCountry: 'China' }), inq({ id: 'c', supplierCountry: 'Germany' }), inq({ id: 'd' }), inq({ id: 'e', sentOn: null, supplierCountry: 'Pakistan' })]
    expect(askedReachText(list)).toBe('4 asked · 1 local, 2 international')
    expect(askedReachText([inq({ id: 'x' })])).toBe('1 asked')
  })
})

describe('gap, board, groups, filters', () => {
  const list = [inq({ id: 'a', lines: priced('it1', 'it2', 'it3'), responseState: 'quoted' }), inq({ id: 'b', askedItemIds: ['it4'] })]
  it('names the items with no price and how many still have a supplier to answer', () => {
    const gap = gapOf(items, list)
    expect(gap.items.map(i => i.number)).toEqual([4, 5])
    expect(gap.open).toBe(1)
    expect(gapText(gap)).toEqual({ lead: '2 items have no price yet:', list: 'item 4 (WIKA), item 5 (WIKA).', open: '1 of them still have a supplier to answer.' })
  })

  it('shows the board from 5 items or 3 suppliers asked', () => {
    expect(showBoard(5, 1)).toBe(true)
    expect(showBoard(2, 3)).toBe(true)
    expect(showBoard(4, 2)).toBe(false)
    expect(showBoard(10, 0)).toBe(false)
  })

  it('groups by brand in first-seen order and filters', () => {
    expect(groupByBrand(items).map(g => [g.brand, g.items.length])).toEqual([
      ['Siemens', 3],
      ['WIKA', 2],
    ])
    expect(filterItems(items, list, 'no-price', '').map(i => i.number)).toEqual([4, 5])
    expect(filterItems(items, list, 'all', 'wika').map(i => i.number)).toEqual([4, 5])
    expect(filterItems(items, list, 'all', '6ES72').map(i => i.number)).toEqual([2])
    expect(filterItems(items, [inq({ id: 'w', itemWaits: { it3: true } })], 'later', '').map(i => i.number)).toEqual([3])
  })

  it('short names take a second word only when the first is shared', () => {
    expect(shortNames(['Achievers Automation', 'Al-Noor Automation', 'Gulf Automation FZE', 'Gulf Traders'])).toEqual(['Achievers', 'Al-Noor', 'Gulf Automation', 'Gulf Traders'])
  })
})
