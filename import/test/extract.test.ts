import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDump, readDump } from '../src/extract/dump'
import { LiveExtractor } from '../src/extract/live'
import { reviewLists, renderReport, writeReport } from '../src/report/report'
import { FIXTURE_DUMP, run } from './support'

describe('the dump reader', () => {
  it('reads the fixture folder: tables, storage listing and the folder of files', () => {
    const d = readDump(FIXTURE_DUMP)
    expect(Object.keys(d.dump.tables)).toContain('orders')
    expect(d.dump.tables['orders']).toHaveLength(22)
    expect(d.dump.storage).toHaveLength(1)
    expect(d.storageDir).toMatch(/storage$/)
    expect(d.warnings).toEqual([])
  })

  it('reads a bare .json file too, without a storage folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dump-'))
    try {
      writeFileSync(join(dir, 'x.json'), JSON.stringify({ tables: { clients: [], orders: [], rfqs: [] } }))
      const d = readDump(join(dir, 'x.json'))
      expect(d.storageDir).toBeNull()
      expect(d.dump.storage).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('warns about a table it does not know, and about missing core tables', () => {
    const { warnings } = parseDump(JSON.stringify({ tables: { clients: [], something_new: [] } }))
    expect(warnings.join('\n')).toMatch(/Unknown table "something_new"/)
    expect(warnings.join('\n')).toMatch(/no "orders" table/)
  })

  it('rejects things that are not a dump', () => {
    expect(() => parseDump('nope')).toThrow(/not valid JSON/)
    expect(() => parseDump('[]')).toThrow(/JSON object/)
    expect(() => parseDump('{}')).toThrow(/no "tables"/)
    expect(() => parseDump('{"tables":{"clients":{}}}')).toThrow(/array of rows/)
    expect(() => parseDump('{"tables":{"clients":[1]}}')).toThrow(/not a row object/)
    expect(() => readDump('/no/such/place')).toThrow(/No such file/)
  })
})

describe('the live extractor', () => {
  it('refuses without the live flag', async () => {
    await expect(new LiveExtractor({ iKnowThisIsLive: false, sourceUrl: '' }).extract()).rejects.toThrow(/--i-know-this-is-live/)
  })
  it('is not implemented even with the flag (I07: the owner runs it)', async () => {
    await expect(new LiveExtractor({ iKnowThisIsLive: true, sourceUrl: '' }).extract()).rejects.toThrow(/NOT IMPLEMENTED/)
  })
})

describe('the report', () => {
  const result = run()

  it('renders counts, money, and the review lists', () => {
    const md = renderReport(result)
    expect(md).toContain('## Money: old against new')
    expect(md).toContain('Reconciles: **yes**')
    expect(md).toContain('| orders | 22 | 0 |')
    expect(md).toContain('| 000001 | 147,972.00 | 147,972.00 | 0.00 | proven net |')
    expect(md).toContain('basis_unknown.csv')
  })

  it('writes report.md, report.json and one CSV per review list', () => {
    const dir = mkdtempSync(join(tmpdir(), 'report-'))
    try {
      const files = writeReport(dir, result)
      expect(files).toEqual(expect.arrayContaining(['report.md', 'report.json', 'company_merges.csv', 'po_clashes.csv', 'dropped_rows.csv']))
      expect(files.filter(f => f.endsWith('.csv')).length).toBe(reviewLists(result.review).size)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('lists the PO 000001 merge in po_clashes', () => {
    const items = reviewLists(result.review).get('po_clashes')!
    expect(items.some(i => i.label === '000001' && i.detail.includes('merged into one order'))).toBe(true)
  })
})
