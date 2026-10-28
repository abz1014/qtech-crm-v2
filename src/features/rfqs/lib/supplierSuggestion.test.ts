import { describe, expect, it } from 'vitest'
import {
  coverageLine,
  isDemoted,
  itemLabel,
  memoryLine,
  suggestSuppliers,
  withCategories,
  type CategoryEvidenceRow,
  type PriceWinsRow,
  type SupplierHistory,
  type SupplierItemMemoryRow,
  type SupplierRecord,
  type SupplierStatsRow,
  type SuggestionItem,
} from './supplierSuggestion'

const TODAY = '2026-11-27'

// Brands and categories (ids are opaque strings here; fixtures only, no real customer data).
const EH = 'b-eh'
const HACH = 'b-hach'
const SIEMENS = 'b-siemens'
const FLOW = 'f-flow'
const CONTACTORS = 'f-contactors'
const PRESSURE = 'f-pressure'

const items: SuggestionItem[] = [
  { id: 'i1', description: 'Endress+Hauser Proline Promag 400 electromagnetic flow meter, DN50', brandId: EH, brandName: 'Endress+Hauser', familyId: FLOW, familyName: 'Flow meters' },
  { id: 'i2', description: 'Hach HQ1110 portable pH/EC meter with probes', brandId: HACH, brandName: 'Hach', familyId: null, modelTokens: ['HQ1110'] },
  { id: 'i3', description: 'Siemens SITRANS P320 pressure transmitter, 0-10 bar', brandId: SIEMENS, brandName: 'Siemens', familyId: null, modelTokens: ['P320'] },
  { id: 'i4', description: 'Contactor 3P 25A 24V coil', brandId: null, familyId: CONTACTORS, familyName: 'Contactors' },
]

function stats(id: string, over: Partial<SupplierStatsRow> = {}): SupplierStatsRow {
  return { supplier_id: id, asked: 0, replied: 0, median_reply_days: null, last_contact: null, brand_ids: [], ...over }
}
function sup(id: string, name: string, over: Partial<SupplierStatsRow> = {}): SupplierRecord {
  return { id, name, stats: stats(id, over) }
}
function mem(supplier_id: string, over: Partial<SupplierItemMemoryRow> = {}): SupplierItemMemoryRow {
  return { supplier_id, best_tier: 0, supplied_before: true, last_ordered_on: null, last_po_on: null, ...over }
}
const ev = (supplier_id: string, family_id: string, over: Partial<CategoryEvidenceRow> = {}): CategoryEvidenceRow => ({
  supplier_id, family_id, asked: 0, replied: 0, quoted: 0, no_offer: 0, ordered: 0, last_asked_on: null, ...over,
})
function run(suppliers: SupplierRecord[], extra: Partial<SupplierHistory> = {}, its = items) {
  return suggestSuppliers(its, { suppliers, memory: {}, ...extra }, { today: TODAY })
}
const ids = (r: ReturnType<typeof run>) => r.suppliers.map((s) => s.supplierId)

describe('group 1: deals in a category (manual tag, or quoted or ordered at least once)', () => {
  it('a supplier that quoted the category is listed with the evidence as its reason', () => {
    const r = run([sup('s1', 'Lahore Switchgear')], { categoryEvidence: [ev('s1', CONTACTORS, { asked: 6, replied: 5, quoted: 5 })] })
    const s = r.suppliers[0]
    expect(s.group).toBe('deals_in')
    expect(s.groupLabel).toBe('Deals in contactors')
    expect(s.reason).toBe('Deals in contactors: quoted 5 of 6.')
    expect(s.coversItemIds).toEqual(['i4'])
  })

  it('an order counts, and is added to the reason', () => {
    const r = run([sup('s1', 'A')], { categoryEvidence: [ev('s1', CONTACTORS, { asked: 6, replied: 5, quoted: 5, ordered: 2 })] })
    expect(r.suppliers[0].reason).toBe('Deals in contactors: quoted 5 of 6, ordered 2.')
    expect(run([sup('s1', 'A')], { categoryEvidence: [ev('s1', CONTACTORS, { ordered: 1 })] }).suppliers[0].reason).toBe('Deals in contactors: ordered 1.')
  })

  it('a manual tag alone qualifies, with nothing else to show', () => {
    const s = run([sup('s1', 'A', { brand_ids: [CONTACTORS] })]).suppliers[0]
    expect(s.group).toBe('deals_in')
    expect(s.manualTag).toBe(true)
    expect(s.reason).toBe('Deals in contactors: on your list for it.')
  })

  it('asked but never quoted (or only no-offer answers) does not qualify', () => {
    const r = run([sup('s1', 'A')], { categoryEvidence: [ev('s1', CONTACTORS, { asked: 4, replied: 4, quoted: 0, no_offer: 4 })] })
    expect(r.suppliers).toEqual([])
  })

  it('one group per category, in the order the items hold them', () => {
    const many: SuggestionItem[] = [
      { id: 'a', description: 'Contactor', brandId: null, familyId: CONTACTORS, familyName: 'Contactors' },
      { id: 'b', description: 'Pressure transmitter', brandId: null, familyId: PRESSURE, familyName: 'Pressure transmitters' },
    ]
    const r = run([sup('s1', 'Pres Co'), sup('s2', 'Cont Co')], { categoryEvidence: [ev('s1', PRESSURE, { quoted: 2, asked: 2 }), ev('s2', CONTACTORS, { quoted: 1, asked: 1 })] }, many)
    expect(r.groups.map((g) => g.label)).toEqual(['Deals in contactors', 'Deals in pressure transmitters'])
  })

  it('goes before brand: a supplier that deals in the category and carries the brand is listed once, under the category', () => {
    const r = run([sup('s1', 'A', { brand_ids: [EH] })], { categoryEvidence: [ev('s1', FLOW, { quoted: 1, asked: 1 })] })
    expect(r.suppliers).toHaveLength(1)
    expect(r.suppliers[0].group).toBe('deals_in')
  })
})

describe('group 2: carries a brand; supplied before is a badge', () => {
  it('names the brand from the item', () => {
    const r = run([sup('s1', 'ABC Traders', { brand_ids: [HACH] })])
    expect(r.suppliers[0]).toMatchObject({ group: 'carries_brand', reason: 'Carries Hach.', tierLabel: 'same brand', coversItemIds: ['i2'] })
  })

  it('joins several brands and falls back to brand_names when the item has no brand name', () => {
    const noName = items.map((i) => ({ ...i, brandName: null }))
    const r = run([sup('s1', 'A', { brand_ids: [HACH, SIEMENS], brand_names: ['Hach', 'Siemens'] })], {}, noName)
    expect(r.suppliers[0].reason).toBe('Carries Hach and Siemens.')
  })

  it('"Supplied this item before" is a badge on a supplier of any group, not a group of its own', () => {
    const r = run([sup('s1', 'A', { brand_ids: [HACH] })], { memory: { i2: [mem('s1', { best_tier: 0 })] } })
    expect(r.suppliers[0]).toMatchObject({ group: 'carries_brand', suppliedBefore: true, tierLabel: 'same model' })
    expect(r.groups.map((g) => g.group)).toEqual(['carries_brand'])
  })

  it('a supplier with only an earlier supply still appears, in a last fallback group', () => {
    const r = run([sup('s1', 'Orient Analytical')], { memory: { i2: [mem('s1', { best_tier: 0, last_ordered_on: '2026-03-14' })] } })
    expect(r.suppliers[0]).toMatchObject({ group: 'supplied_before', suppliedBefore: true })
    expect(r.suppliers[0].reason).toBe('Supplied this item before: Hach HQ1110, last ordered Mar 2026.')
  })

  it('does not count tier 2/3 memory, supplied_before=false, or null; a supplier with no connection is not suggested', () => {
    const r = run([sup('s1', 'A'), sup('s2', 'B'), sup('s3', 'C'), sup('s4', 'D', { brand_ids: ['other'] })], {
      memory: { i2: [mem('s1', { best_tier: 2 }), mem('s2', { supplied_before: false }), mem('s3', { supplied_before: null })] },
    })
    expect(r.suppliers).toEqual([])
  })

  it('a duplicated candidate is listed once, and a supplier with no stats row can still be suggested through memory', () => {
    expect(ids(run([sup('s2', 'B', { brand_ids: [EH] }), sup('s2', 'B', { brand_ids: [EH] })]))).toEqual(['s2'])
    const r = suggestSuppliers(items, { suppliers: [{ id: 's1', name: 'No Stats', stats: null }], memory: { i2: [mem('s1')] } }, { today: TODAY })
    expect(r.suppliers[0].memoryLine).toBe('no history yet')
  })

  it('the groups are always deals in, then carries a brand, then supplied before', () => {
    const r = run([sup('z', 'Zed'), sup('y', 'Yan', { brand_ids: [EH] }), sup('x', 'Xan', { brand_ids: [CONTACTORS] })], { memory: { i2: [mem('z')] } })
    expect(r.groups.map((g) => g.group)).toEqual(['deals_in', 'carries_brand', 'supplied_before'])
  })
})

describe('order inside a group: ordered, category reply rate, overall reply rate, price wins, last contact', () => {
  const two = (a: Partial<SupplierStatsRow>, b: Partial<SupplierStatsRow>, ea: Partial<CategoryEvidenceRow>, eb: Partial<CategoryEvidenceRow>, wins: PriceWinsRow[] = []) =>
    ids(
      run([sup('a', 'Alpha', a), sup('b', 'Bravo', b)], {
        categoryEvidence: [ev('a', CONTACTORS, { quoted: 1, asked: 2, replied: 1, ...ea }), ev('b', CONTACTORS, { quoted: 1, asked: 2, replied: 1, ...eb })],
        priceWins: wins,
      }),
    )

  it('more orders first, before every reply rate', () => {
    expect(two({}, {}, { ordered: 1, replied: 2 }, { ordered: 3, replied: 0, asked: 4 })).toEqual(['b', 'a'])
  })

  it('then the category reply rate', () => {
    expect(two({}, {}, { asked: 4, replied: 2 }, { asked: 4, replied: 3 })).toEqual(['b', 'a'])
  })

  it('then the overall reply rate', () => {
    expect(two({ asked: 10, replied: 2 }, { asked: 10, replied: 8 }, {}, {})).toEqual(['b', 'a'])
  })

  it('then price wins (admin and sales only: an engineer has none and nothing changes)', () => {
    const w = (id: string, wins: number | null): PriceWinsRow => ({ supplier_id: id, family_id: CONTACTORS, wins, of_ranked: wins === null ? null : 5 })
    expect(two({}, {}, {}, {}, [w('a', 1), w('b', 3)])).toEqual(['b', 'a'])
    expect(two({}, {}, {}, {}, [w('a', null), w('b', null)])).toEqual(['a', 'b'])
  })

  it('then the most recent contact, a never-contacted supplier last, then name, then id', () => {
    expect(two({ last_contact: '2026-06-01' }, { last_contact: '2026-10-01' }, {}, {})).toEqual(['b', 'a'])
    expect(two({ last_contact: null }, { last_contact: '2020-01-01' }, {}, {})).toEqual(['b', 'a'])
    expect(two({}, {}, {}, {})).toEqual(['a', 'b'])
    expect(ids(run([sup('b', 'Twin', { brand_ids: [CONTACTORS] }), sup('a', 'Twin', { brand_ids: [CONTACTORS] })]))).toEqual(['a', 'b'])
  })

  it('equal on every count, a proven delivery record comes before an unproven one and often late goes last (A8 as a tie-break)', () => {
    const r = run([sup('late', 'Aardvark', { brand_ids: [CONTACTORS], deliveries: 6, late: 4 }), sup('new', 'Beta', { brand_ids: [CONTACTORS] }), sup('good', 'Zeta', { brand_ids: [CONTACTORS], deliveries: 4, late: 0 })])
    expect(ids(r)).toEqual(['good', 'new', 'late'])
  })

  it('is independent of the input order', () => {
    const list = [sup('a', 'Alpha', { brand_ids: [CONTACTORS] }), sup('b', 'Bravo', { brand_ids: [CONTACTORS], last_contact: '2026-10-24' }), sup('c', 'Charlie', { brand_ids: [EH] })]
    const base = ids(run(list))
    expect(ids(run([...list].reverse()))).toEqual(base)
  })
})

describe('no offer on 2 of the last 3 asks demotes a supplier', () => {
  it('isDemoted reads the newest three', () => {
    expect(isDemoted(['no_offer', 'other', 'no_offer'])).toBe(true)
    expect(isDemoted(['no_offer', 'other', 'other', 'no_offer', 'no_offer'])).toBe(false)
    expect(isDemoted(['no_offer'])).toBe(false)
    expect(isDemoted(undefined)).toBe(false)
  })

  it('a demoted supplier goes after the others of its group, stays listed, is never ticked, and says why', () => {
    const r = run([sup('good', 'Zeta Co', { asked: 4, replied: 3 }), sup('bad', 'Alpha Co', { asked: 9, replied: 9 })], {
      categoryEvidence: [ev('good', CONTACTORS, { quoted: 1, asked: 2, replied: 1 }), ev('bad', CONTACTORS, { ordered: 9, quoted: 9, asked: 9, replied: 9 })],
      recentAsks: { bad: ['no_offer', 'other', 'no_offer'] },
    })
    expect(ids(r)).toEqual(['good', 'bad'])
    expect(r.suppliers[1].demoted).toBe(true)
    expect(r.suppliers[1].preTicked).toBe(false)
    expect(r.suppliers[1].reason).toContain('no offer on 2 of the last 3 asks')
  })
})

describe('pre-ticking: the top 3 with a reply rate of 50% or more, or a manual tag', () => {
  it('ticks three at most, the first three of the ranked list', () => {
    const four = ['a', 'b', 'c', 'd'].map((x, n) => sup(x, `S${x}`, { last_contact: `2026-10-0${4 - n}` }))
    const evidence = ['a', 'b', 'c', 'd'].map((x) => ev(x, CONTACTORS, { quoted: 4, asked: 4, replied: 4 }))
    expect(run(four, { categoryEvidence: evidence }).preTickedIds).toEqual(['a', 'b', 'c'])
  })

  it('a reply rate below 50% earns no tick, a manual tag does', () => {
    const r = run([sup('lo', 'Low'), sup('tag', 'Tagged', { brand_ids: [CONTACTORS] })], { categoryEvidence: [ev('lo', CONTACTORS, { quoted: 1, asked: 5, replied: 1 })] })
    expect(r.suppliers.map((s) => [s.supplierId, s.preTicked])).toEqual([['lo', false], ['tag', true]])
  })

  it('a supplier whose category has no asks is judged on the overall rate', () => {
    const r = run([sup('s1', 'A', { asked: 10, replied: 6 }), sup('s2', 'B', { asked: 10, replied: 2 })], { categoryEvidence: [ev('s1', CONTACTORS, { ordered: 1 }), ev('s2', CONTACTORS, { ordered: 1 })] })
    expect(r.suppliers.map((s) => s.preTicked)).toEqual([true, false])
  })

  it('a carries-brand supplier is ticked on its overall reply rate; one that supplied the item before always qualifies', () => {
    const r = run([sup('s1', 'A', { brand_ids: [HACH], asked: 4, replied: 3 }), sup('s2', 'B', { brand_ids: [EH], asked: 4, replied: 0 }), sup('s3', 'C')], { memory: { i2: [mem('s3')] } })
    const tick = Object.fromEntries(r.suppliers.map((s) => [s.supplierId, s.preTicked]))
    expect(tick).toEqual({ s1: true, s2: false, s3: true })
  })

  it('reports the items no ticked supplier covers, and the items nobody covers', () => {
    const r = run([sup('s1', 'A')], { categoryEvidence: [ev('s1', CONTACTORS, { quoted: 2, asked: 2, replied: 2 })] })
    expect(r.preTickedIds).toEqual(['s1'])
    expect(r.itemsWithoutTickedSupplier).toEqual(['i1', 'i2', 'i3'])
    expect(r.itemsWithoutAnySuggestion).toEqual(['i1', 'i2', 'i3'])
    expect(run([]).preTickedIds).toEqual([])
  })
})

describe('the coverage line', () => {
  it('names a category that no candidate deals in', () => {
    const r = run([sup('s1', 'A', { brand_ids: [HACH] })], { categoryEvidence: [ev('s1', CONTACTORS, { quoted: 1, asked: 1 })] })
    expect(r.uncovered.map((u) => u.name)).toEqual(['Flow meters'])
    expect(coverageLine(r.uncovered)).toBe('No supplier on file deals in flow meters yet. Ask a few: their answers build the list.')
  })

  it('says nothing when every category has a supplier, or the items have no category', () => {
    expect(coverageLine(run([sup('s1', 'A', { brand_ids: [FLOW, CONTACTORS] })]).uncovered)).toBeNull()
    expect(coverageLine([])).toBeNull()
  })
})

describe('the category of an item: its family, else the dictionary (a guess)', () => {
  const families = [{ id: CONTACTORS, name: 'Contactors' }, { id: PRESSURE, name: 'Pressure transmitters' }]

  it('fills a missing family from the dictionary and marks it a guess', () => {
    const [a] = withCategories([{ id: 'x', description: 'Pressure transmitter 0-10 bar', brandId: null, familyId: null }], families)
    expect(a).toMatchObject({ familyId: PRESSURE, familyName: 'Pressure transmitters', categoryGuessed: true })
  })

  it('leaves an item that has a family alone, and one the dictionary is unsure about, or whose category is not on file', () => {
    const own = { id: 'x', description: 'Pressure transmitter', brandId: null, familyId: FLOW, familyName: 'Flow meters' }
    expect(withCategories([own], families)[0]).toBe(own)
    expect(withCategories([{ id: 'y', description: 'something unusual', brandId: null, familyId: null }], families)[0].familyId).toBeNull()
    expect(withCategories([{ id: 'z', description: 'MCB 16A', brandId: null, familyId: null }], families)[0].familyId).toBeNull()
  })

  it('a guessed category drives the suppliers like a real one, and is flagged in the coverage', () => {
    const guessed = withCategories([{ id: 'x', description: 'Contactor 25A', brandId: null, familyId: null }], families)
    const r = suggestSuppliers(guessed, { suppliers: [], memory: {} }, { today: TODAY })
    expect(r.uncovered).toEqual([{ categoryId: CONTACTORS, name: 'Contactors', guessed: true }])
  })
})

describe('what a suggestion holds', () => {
  it('cites the order behind a supplier and prints its delivery record', () => {
    const r = run([sup('s1', 'Metro', { deliveries: 6, late: 1, brand_ids: [SIEMENS] })], {
      memory: {
        i3: [
          mem('s1', {
            best_tier: 1, evidence_tier: 1, evidence_order_number: 31, evidence_item_desc: 'Siemens SITRANS P320', evidence_qty: 4,
            evidence_placed_on: '2026-03-12', evidence_expected_on: '2026-03-26', evidence_delivered_on: '2026-03-31', evidence_delivered_after_days: 19, evidence_count_at_tier: 3,
          }),
        ],
      },
    })
    const s = r.suppliers[0]
    expect(s.evidence?.text).toBe('Ordered Siemens SITRANS P320 ×4 for ORD-0031, placed 12 Mar 2026, delivered after 19 days (expected 14)')
    expect(s.record?.text).toBe('On time 5 of 6 deliveries')
  })

  it('exposes no score or rank field', () => {
    const s = run([sup('a', 'A', { brand_ids: [EH], asked: 5, replied: 4 })]).suppliers[0]
    expect(JSON.stringify(s)).not.toMatch(/score|rank/i)
  })
})

describe('memory line (counts, never a percentage)', () => {
  it('no history yet', () => {
    expect(memoryLine(null)).toBe('no history yet')
    expect(memoryLine(stats('x'))).toBe('no history yet')
  })

  it('asked fewer than 3 times: raw facts only, no usual reply time even if a median leaks in', () => {
    expect(memoryLine(stats('x', { asked: 2, replied: 1, last_contact: '2026-06-19' }), TODAY)).toBe('asked twice, 1 reply · last contacted 19 Jun')
    expect(memoryLine(stats('x', { asked: 1, replied: 0 }))).toBe('asked once, no reply')
    expect(memoryLine(stats('x', { asked: 2, replied: 2, median_reply_days: 2 }))).toBe('asked twice, 2 replies')
  })

  it('3 or more asked: "answered r of a", with the usual reply time only when the view supplies a median', () => {
    expect(memoryLine(stats('x', { asked: 8, replied: 7, median_reply_days: 1, last_contact: '2026-11-03' }), TODAY)).toBe(
      'answered 7 of 8 · usually replies in ~1 day · last contacted 3 Nov',
    )
    expect(memoryLine(stats('x', { asked: 9, replied: 5, median_reply_days: null }))).toBe('answered 5 of 9')
  })

  it('rounds the median and handles a same-day median', () => {
    expect(memoryLine(stats('x', { asked: 4, replied: 4, median_reply_days: 2.5 }))).toContain('~3 days')
    expect(memoryLine(stats('x', { asked: 4, replied: 4, median_reply_days: 0 }))).toContain('usually replies the same day')
  })

  it('says "ordered from N times" first once there are orders, and drops "last contacted" only when an order is cited', () => {
    const s = stats('x', { orders_count: 4, asked: 6, replied: 4, last_contact: '2026-09-12' })
    expect(memoryLine(s, TODAY)).toBe('ordered from 4 times · answered 4 of 6 · last contacted 12 Sep')
    expect(memoryLine(s, TODAY, { hasEvidence: true })).toBe('ordered from 4 times · answered 4 of 6')
    expect(memoryLine(stats('x', { orders_count: 2 }), TODAY)).toBe('ordered from 2 times')
  })
})

describe('itemLabel', () => {
  it('keeps the model as the customer wrote it', () => {
    expect(itemLabel({ id: 'x', description: 'Position transmitter pma-18-f0200-x', brandId: null, familyId: null, modelTokens: ['PMA18F0200X'] })).toBe('pma-18-f0200-x')
  })
  it('does not repeat a brand already inside the model text', () => {
    expect(itemLabel({ id: 'x', description: 'Belimo LF24 actuator', brandId: 'b', brandName: 'Belimo', familyId: null, modelTokens: ['LF24'] })).toBe('Belimo LF24')
  })
})

describe('M10: inside Deals in, category orders rank before overall orders', () => {
  it('a tag-only supplier with many unrelated orders does not outrank real category orders', () => {
    const r = run(
      [sup('alpha', 'Alpha', { brand_ids: [CONTACTORS], orders_count: 40 }), sup('beta', 'Beta')],
      { categoryEvidence: [ev('beta', CONTACTORS, { asked: 6, replied: 6, quoted: 6, ordered: 4 })] },
    )
    expect(ids(r)).toEqual(['beta', 'alpha'])
  })
})
