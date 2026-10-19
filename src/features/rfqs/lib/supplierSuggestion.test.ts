import { describe, expect, it } from 'vitest'
import {
  GROUP_LABEL,
  itemLabel,
  memoryLine,
  suggestSuppliers,
  type SupplierHistory,
  type SupplierItemMemoryRow,
  type SupplierRecord,
  type SupplierStatsRow,
  type SuggestionItem,
} from './supplierSuggestion'

const TODAY = '2026-11-27'

// Brands / families (ids are opaque strings here).
const EH = 'b-eh'
const HACH = 'b-hach'
const SIEMENS = 'b-siemens'
const FLOW = 'f-flow'
const ACTUATION = 'f-actuation'

const items: SuggestionItem[] = [
  { id: 'i1', description: 'Endress+Hauser Proline Promag 400 electromagnetic flow meter, DN50', brandId: EH, brandName: 'Endress+Hauser', familyId: FLOW, familyName: 'Flow' },
  { id: 'i2', description: 'Hach HQ1110 portable pH/EC meter with probes', brandId: HACH, brandName: 'Hach', familyId: null, modelTokens: ['HQ1110'] },
  { id: 'i3', description: 'Siemens SITRANS P320 pressure transmitter, 0-10 bar', brandId: SIEMENS, brandName: 'Siemens', familyId: null, modelTokens: ['P320'] },
  { id: 'i4', description: '24V actuator for ball valve, DN40', brandId: null, familyId: ACTUATION, familyName: 'Actuator' },
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
function run(suppliers: SupplierRecord[], memory: SupplierHistory['memory'] = {}, its = items) {
  return suggestSuppliers(its, { suppliers, memory }, { today: TODAY })
}
const ids = (r: ReturnType<typeof run>) => r.suppliers.map((s) => s.supplierId)

describe('reason: supplied this item before', () => {
  it('names the model and the last order month (tier 0, same model)', () => {
    const r = run([sup('s1', 'Orient Analytical')], { i2: [mem('s1', { best_tier: 0, last_ordered_on: '2026-03-14' })] })
    const s = r.suppliers[0]
    expect(s.group).toBe('supplied_before')
    expect(s.tierLabel).toBe('same model')
    expect(s.reason).toBe('Supplied this item before: Hach HQ1110, last ordered Mar 2026.')
    expect(s.groupLabel).toBe('Supplied this item before')
  })

  it('falls back to the PO date, then to no date at all', () => {
    const a = run([sup('s1', 'A')], { i3: [mem('s1', { best_tier: 1, last_po_on: '2026-09-21' })] }).suppliers[0]
    expect(a.reason).toBe('Supplied this item before: Siemens P320, last ordered Sep 2026.')
    expect(a.tierLabel).toBe('same item')
    const b = run([sup('s1', 'A')], { i3: [mem('s1', { best_tier: 1 })] }).suppliers[0]
    expect(b.reason).toBe('Supplied this item before: Siemens P320.')
  })

  it('uses the description when the item has no model token, cut to a readable length', () => {
    const r = run([sup('s1', 'A')], { i1: [mem('s1', { best_tier: 1 })] })
    expect(r.suppliers[0].reason).toBe('Supplied this item before: Endress+Hauser Proline Promag 400 elect….')
  })

  it('lists several items, shortens beyond three, and uses the newest order date', () => {
    const many: SuggestionItem[] = ['a', 'b', 'c', 'd', 'e'].map((x) => ({ id: x, description: `Item ${x}`, brandId: null, familyId: null }))
    const memory: SupplierHistory['memory'] = Object.fromEntries(
      many.map((m, n) => [m.id, [mem('s1', { best_tier: 1, last_ordered_on: `2026-0${n + 1}-10` })]]),
    )
    const r = run([sup('s1', 'A')], memory, many)
    expect(r.suppliers[0].reason).toBe('Supplied this item before: Item a, Item b, Item c and 2 more, last ordered May 2026.')
    expect(r.suppliers[0].coversItemIds).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('shows "same model" if any covered item is a tier 0 match', () => {
    const r = run([sup('s1', 'A')], { i2: [mem('s1', { best_tier: 1 })], i3: [mem('s1', { best_tier: 0 })] })
    expect(r.suppliers[0].tierLabel).toBe('same model')
  })

  it('does not count tier 2/3 memory, supplied_before=false, or null as "supplied before"', () => {
    const r = run([sup('s1', 'A'), sup('s2', 'B'), sup('s3', 'C')], {
      i2: [mem('s1', { best_tier: 2 }), mem('s2', { supplied_before: false, best_tier: 0 }), mem('s3', { supplied_before: null })],
    })
    expect(r.suppliers).toEqual([])
  })

  it('ignores memory rows belonging to other suppliers and memory for suppliers that are not candidates', () => {
    const r = run([sup('s1', 'A')], { i2: [mem('someone-else')] })
    expect(r.suppliers).toEqual([])
  })
})

describe('reason: carries the brand', () => {
  it('names the brand from the item', () => {
    const r = run([sup('s1', 'ABC Traders', { brand_ids: [EH] })])
    expect(r.suppliers[0].reason).toBe('Carries Endress+Hauser.')
    expect(r.suppliers[0].group).toBe('carries_brand')
    expect(r.suppliers[0].tierLabel).toBe('same brand')
    expect(r.suppliers[0].coversItemIds).toEqual(['i1'])
  })

  it('joins several brands and falls back to brand_names when the item has no brand name', () => {
    const noName = items.map((i) => ({ ...i, brandName: null }))
    const r = run([sup('s1', 'A', { brand_ids: [HACH, SIEMENS], brand_names: ['Hach', 'Siemens'] })], {}, noName)
    expect(r.suppliers[0].reason).toBe('Carries Hach and Siemens.')
  })

  it('is not pre-ticked', () => {
    expect(run([sup('s1', 'A', { brand_ids: [EH] })]).suppliers[0].preTicked).toBe(false)
  })
})

describe('reason: family shortlist', () => {
  it('names the family in lower case', () => {
    const r = run([sup('s1', 'Karachi Valve', { brand_ids: [ACTUATION] })])
    expect(r.suppliers[0].reason).toBe('On your actuator shortlist.')
    expect(r.suppliers[0].group).toBe('family_shortlist')
    expect(r.suppliers[0].tierLabel).toBe('same family')
  })

  it('falls back to a generic sentence when the family has no name anywhere', () => {
    const noName = items.map((i) => ({ ...i, familyName: null }))
    const r = run([sup('s1', 'A', { brand_ids: [ACTUATION] })], {}, noName)
    expect(r.suppliers[0].reason).toBe('On your shortlist for this item family.')
  })
})

describe('strongest group wins', () => {
  it('a supplier that supplied before and also carries the brand is listed once, as supplied before', () => {
    const r = run([sup('s1', 'A', { brand_ids: [HACH, FLOW] })], { i2: [mem('s1')] })
    expect(r.suppliers).toHaveLength(1)
    expect(r.suppliers[0].group).toBe('supplied_before')
  })

  it('brand beats family', () => {
    expect(run([sup('s1', 'A', { brand_ids: [FLOW, EH] })]).suppliers[0].group).toBe('carries_brand')
  })

  it('a supplier with no connection to any item is not suggested; duplicate candidates are listed once', () => {
    const r = run([sup('s1', 'A', { brand_ids: ['other'] }), sup('s2', 'B', { brand_ids: [EH] }), sup('s2', 'B', { brand_ids: [EH] })])
    expect(ids(r)).toEqual(['s2'])
  })

  it('a supplier with no stats row can still be suggested through memory', () => {
    const r = suggestSuppliers(items, { suppliers: [{ id: 's1', name: 'No Stats', stats: null }], memory: { i2: [mem('s1')] } }, { today: TODAY })
    expect(r.suppliers[0].memoryLine).toBe('no history yet')
  })
})

describe('pre-ticking', () => {
  it('only "supplied this item before" is pre-ticked', () => {
    const r = run(
      [sup('s1', 'A', { brand_ids: [] }), sup('s2', 'B', { brand_ids: [EH] }), sup('s3', 'C', { brand_ids: [ACTUATION] })],
      { i2: [mem('s1')] },
    )
    expect(r.suppliers.map((s) => [s.supplierId, s.preTicked])).toEqual([['s1', true], ['s2', false], ['s3', false]])
    expect(r.preTickedIds).toEqual(['s1'])
  })

  it('reports items that no ticked supplier covers, and items nobody covers', () => {
    const r = run([sup('s1', 'A'), sup('s2', 'K', { brand_ids: [ACTUATION] })], { i2: [mem('s1')] })
    expect(r.itemsWithoutTickedSupplier).toEqual(['i1', 'i3', 'i4'])
    expect(r.itemsWithoutAnySuggestion).toEqual(['i1', 'i3'])
  })

  it('with nothing ticked every item is uncovered (save-only flow)', () => {
    const r = run([])
    expect(r.preTickedIds).toEqual([])
    expect(r.itemsWithoutTickedSupplier).toEqual(['i1', 'i2', 'i3', 'i4'])
  })
})

describe('ranking: tier first, then recency, then name', () => {
  it('tier (group) comes before recency', () => {
    const r = run(
      [sup('fam', 'Zed', { brand_ids: [ACTUATION], last_contact: '2026-11-20' }), sup('br', 'Yan', { brand_ids: [EH], last_contact: '2026-01-02' }), sup('sb', 'Xan', { last_contact: null })],
      { i2: [mem('sb')] },
    )
    expect(ids(r)).toEqual(['sb', 'br', 'fam'])
    expect(r.groups.map((g) => g.group)).toEqual(['supplied_before', 'carries_brand', 'family_shortlist'])
    expect(r.groups.map((g) => g.label)).toEqual(Object.values(GROUP_LABEL))
  })

  it('within a group the most recent contact comes first', () => {
    const r = run([
      sup('a', 'Alpha', { brand_ids: [EH], last_contact: '2026-06-19' }),
      sup('b', 'Bravo', { brand_ids: [EH], last_contact: '2026-10-24' }),
      sup('c', 'Charlie', { brand_ids: [EH], last_contact: '2026-08-01' }),
    ])
    expect(ids(r)).toEqual(['b', 'c', 'a'])
  })

  it('a supplier never contacted sorts after every contacted one in its group', () => {
    const r = run([
      sup('a', 'Aardvark', { brand_ids: [EH], last_contact: null }),
      sup('b', 'Zulu', { brand_ids: [EH], last_contact: '2020-01-01' }),
    ])
    expect(ids(r)).toEqual(['b', 'a'])
  })

  it('equal recency falls back to name, case-insensitive', () => {
    const r = run([
      sup('1', 'beta Co', { brand_ids: [EH], last_contact: '2026-05-05' }),
      sup('2', 'Alpha Co', { brand_ids: [EH], last_contact: '2026-05-05' }),
      sup('3', 'Gamma Co', { brand_ids: [EH], last_contact: '2026-05-05' }),
    ])
    expect(ids(r)).toEqual(['2', '1', '3'])
  })

  it('equal recency and name fall back to id, so the order is total', () => {
    const r = run([sup('b', 'Twin', { brand_ids: [EH] }), sup('a', 'Twin', { brand_ids: [EH] })])
    expect(ids(r)).toEqual(['a', 'b'])
  })

  it('is independent of the input order', () => {
    const list = [
      sup('a', 'Alpha', { brand_ids: [EH], last_contact: '2026-06-19' }),
      sup('b', 'Bravo', { brand_ids: [EH], last_contact: '2026-10-24' }),
      sup('c', 'Charlie', { brand_ids: [ACTUATION], last_contact: '2026-11-01' }),
      sup('d', 'Delta', { last_contact: '2026-01-01' }),
    ]
    const memory = { i2: [mem('d')] }
    const base = ids(run(list, memory))
    expect(base).toEqual(['d', 'b', 'a', 'c'])
    expect(ids(run([...list].reverse(), memory))).toEqual(base)
    expect(ids(run([list[2], list[0], list[3], list[1]], memory))).toEqual(base)
  })

  it('A8: inside a group the better track record comes first, and recency only breaks the remaining ties', () => {
    const mk = (over1: Partial<SupplierStatsRow>, over2: Partial<SupplierStatsRow>, rows: SupplierItemMemoryRow[] = []) =>
      run(
        [
          sup('old', 'Old Friend', { brand_ids: [EH], last_contact: '2026-01-05', asked: 10, replied: 10, ...over1 }),
          sup('new', 'New Contact', { brand_ids: [EH], last_contact: '2026-11-05', asked: 8, replied: 1, ...over2 }),
        ],
        rows.length ? { i1: rows } : {},
      )
    // Same record, same orders, same replies: recency decides, as before.
    expect(ids(mk({ replied: 1 }, {}))).toEqual(['new', 'old'])
    // Reliability first: proven (3 of 3 on time) beats unproven, and "often late" goes last, however recent the contact.
    expect(ids(mk({ deliveries: 4, late: 0, replied: 1 }, {}))).toEqual(['old', 'new'])
    expect(ids(mk({ deliveries: 6, late: 4, replied: 10 }, { deliveries: 0 }))).toEqual(['new', 'old'])
    // Then how often we have ordered at the strongest tier, then how often they reply.
    const ev = (n: number) => ({ best_tier: 2, supplied_before: false, evidence_tier: 2, evidence_order_number: 5, evidence_count_at_tier: n, evidence_placed_on: '2026-02-03', evidence_delivered_after_days: 9 })
    expect(ids(mk({}, {}, [mem('old', ev(1)), mem('new', ev(3))]))).toEqual(['new', 'old'])
    expect(ids(mk({ replied: 2 }, { replied: 6 }, [mem('old', ev(2)), mem('new', ev(2))]))).toEqual(['new', 'old'])
    // orders_count (v_supplier_stats) is the order key when the view has it: more orders first, whatever the tier counts say.
    expect(ids(mk({ orders_count: 2 }, { orders_count: 5 }, [mem('old', ev(9)), mem('new', ev(1))]))).toEqual(['new', 'old'])
    expect(ids(mk({ replied: 6 }, { replied: 2 }, [mem('old', ev(2)), mem('new', ev(2))]))).toEqual(['old', 'new'])
  })

  it('A8: the groups stay the outer order and the pre-ticks do not move', () => {
    const r = run(
      [
        sup('carrier', 'Great Record', { brand_ids: [EH], deliveries: 9, late: 0, replied: 9, asked: 9 }),
        sup('supplied', 'Supplied Before', { deliveries: 0, last_contact: '2020-01-01' }),
      ],
      { i2: [mem('supplied')] },
    )
    expect(ids(r)).toEqual(['supplied', 'carrier'])
    expect(r.preTickedIds).toEqual(['supplied'])
  })

  it('A8: cites the order behind a supplier (number, placed date, days to delivery) and prints its delivery record', () => {
    const r = run([sup('s1', 'Metro', { deliveries: 6, late: 1 })], {
      i3: [
        mem('s1', {
          best_tier: 1,
          evidence_tier: 1,
          evidence_order_number: 31,
          evidence_item_desc: 'Siemens SITRANS P320',
          evidence_qty: 4,
          evidence_placed_on: '2026-03-12',
          evidence_expected_on: '2026-03-26',
          evidence_delivered_on: '2026-03-31',
          evidence_delivered_after_days: 19,
          evidence_count_at_tier: 3,
        }),
      ],
    })
    const s = r.suppliers[0]
    expect(s.evidence?.text).toBe('Ordered Siemens SITRANS P320 ×4 for ORD-0031, placed 12 Mar 2026, delivered after 19 days (expected 14)')
    expect(s.record?.text).toBe('On time 5 of 6 deliveries')
    expect(run([sup('s2', 'None', { brand_ids: [EH] })]).suppliers[0]).toMatchObject({ evidence: null, record: null })
  })

  it('exposes no numeric score or rank field', () => {
    const s = run([sup('a', 'A', { brand_ids: [EH], asked: 5, replied: 4 })]).suppliers[0]
    for (const v of Object.values(s)) expect(typeof v === 'number').toBe(false)
    expect(JSON.stringify(s)).not.toMatch(/score|rank|%/i)
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
    expect(memoryLine(stats('x', { asked: 6, replied: 4, median_reply_days: 2, last_contact: '2026-09-12' }), TODAY)).toBe(
      'answered 4 of 6 · usually replies in ~2 days · last contacted 12 Sep',
    )
    expect(memoryLine(stats('x', { asked: 9, replied: 5, median_reply_days: null }))).toBe('answered 5 of 9')
  })

  it('rounds the median and handles a same-day median', () => {
    expect(memoryLine(stats('x', { asked: 4, replied: 4, median_reply_days: 2.5 }))).toContain('~3 days')
    expect(memoryLine(stats('x', { asked: 4, replied: 4, median_reply_days: 0 }))).toContain('usually replies the same day')
  })

  it('adds the year to a contact date from another year', () => {
    expect(memoryLine(stats('x', { last_contact: '2025-03-04' }), TODAY)).toBe('no history yet · last contacted 4 Mar 2025')
  })

  it('says "ordered from N times" first once there are orders (orders_count), and drops "last contacted" only when an order is cited', () => {
    const s = stats('x', { orders_count: 4, asked: 6, replied: 4, last_contact: '2026-09-12' })
    expect(memoryLine(s, TODAY)).toBe('ordered from 4 times · answered 4 of 6 · last contacted 12 Sep')
    expect(memoryLine(s, TODAY, { hasEvidence: true })).toBe('ordered from 4 times · answered 4 of 6')
    expect(memoryLine(stats('x', { orders_count: 1, asked: 2, replied: 1 }), TODAY)).toBe('ordered from once · asked twice, 1 reply')
    expect(memoryLine(stats('x', { orders_count: 2 }), TODAY)).toBe('ordered from 2 times')
    expect(memoryLine(stats('x', { orders_count: 0, asked: 1, replied: 0 }))).toBe('asked once, no reply')
  })

  it('is attached to every suggestion', () => {
    const r = run([sup('s1', 'K', { brand_ids: [ACTUATION] })])
    expect(r.suppliers[0].memoryLine).toBe('no history yet')
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
