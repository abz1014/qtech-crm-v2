import { describe, expect, it } from 'vitest'
import { parseCsv, toCsv } from '../src/lib/csv'
import { dueTextFromNotes, parseLegacyDate } from '../src/lib/dates'
import { isLegacyId, legacyId, uuidv5 } from '../src/lib/ids'
import { normName, num } from '../src/lib/text'
import { parseMappings } from '../src/mappings'

describe('ids', () => {
  it('is RFC 4122 version 5 (known test vector)', () => {
    expect(uuidv5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2')
  })

  it('gives the same id for the same old id, and different ids for different kinds', () => {
    expect(legacyId('order', 'abc')).toBe(legacyId('order', 'abc'))
    expect(legacyId('order', 'abc')).not.toBe(legacyId('rfq', 'abc'))
    expect(legacyId('order', 'abc')).not.toBe(legacyId('order', 'abd'))
  })

  it('marks every import id as legacy and no random v4 id as legacy', () => {
    expect(isLegacyId(legacyId('x', '1'))).toBe(true)
    expect(isLegacyId(crypto.randomUUID())).toBe(false)
    expect(isLegacyId('a0000000-0000-4000-8000-000000000001')).toBe(false)
    expect(isLegacyId('ca7e0000-0000-4000-8000-000000000010')).toBe(false)
    expect(isLegacyId('not a uuid')).toBe(false)
    for (let i = 0; i < 200; i++) expect(isLegacyId(crypto.randomUUID())).toBe(false)
  })
})

describe('dates', () => {
  it('reads the formats people typed', () => {
    expect(parseLegacyDate('2025-01-31')).toEqual({ date: '2025-01-31', status: 'ok' })
    expect(parseLegacyDate('31/01/2025').date).toBe('2025-01-31')
    expect(parseLegacyDate('31-01-2025').date).toBe('2025-01-31')
    expect(parseLegacyDate('31.1.25').date).toBe('2025-01-31')
    expect(parseLegacyDate(' 1/2/2025 ').date).toBe('2025-02-01') // day first
  })

  it('reads a timestamp as Karachi time', () => {
    expect(parseLegacyDate('2024-10-11T00:00:00+00:00').date).toBe('2024-10-11')
    expect(parseLegacyDate('2024-10-10T20:00:00+00:00').date).toBe('2024-10-11') // 01:00 the next day in Karachi
    expect(parseLegacyDate('2024-10-11 08:30:00').date).toBe('2024-10-11') // no zone: the date as written
  })

  it('separates empty from invalid', () => {
    expect(parseLegacyDate('')).toEqual({ date: null, status: 'empty' })
    expect(parseLegacyDate(null).status).toBe('empty')
    expect(parseLegacyDate(undefined).status).toBe('empty')
    expect(parseLegacyDate('garbage').status).toBe('invalid')
    expect(parseLegacyDate('2025-02-30').status).toBe('invalid')
    expect(parseLegacyDate('31/02/2025').status).toBe('invalid')
    expect(parseLegacyDate('13/13/2025').status).toBe('invalid')
    expect(parseLegacyDate('1999-01-01').status).toBe('invalid')
  })

  it('finds "Due: dd/mm/yyyy" in notes', () => {
    expect(dueTextFromNotes('Proximity sensors. Due: 31/01/2024')).toBe('31/01/2024')
    expect(dueTextFromNotes('due date - 5-2-2025 please')).toBe('5-2-2025')
    expect(dueTextFromNotes('nothing here')).toBeNull()
    expect(dueTextFromNotes(null)).toBeNull()
  })
})

describe('text', () => {
  it('normalises names for matching', () => {
    expect(normName('  Ghani   GLASS ')).toBe('ghani glass')
    expect(normName(null)).toBe('')
    expect(normName('Ｚeta')).toBe('zeta')
  })
  it('reads numbers loosely', () => {
    expect(num('1,234.50')).toBe(1234.5)
    expect(num('')).toBeNull()
    expect(num('abc')).toBeNull()
    expect(num(7)).toBe(7)
  })
})

describe('csv', () => {
  it('reads quotes, commas inside quotes, comments and a BOM', () => {
    const rows = parseCsv(String.fromCharCode(0xfeff) + '# a comment\nold_name,company,site\n"Ghani Glass (KHI), old",Ghani Glass,Karachi\n# another\nB,"C ""quoted""",\n')
    expect(rows).toEqual([
      { old_name: 'Ghani Glass (KHI), old', company: 'Ghani Glass', site: 'Karachi' },
      { old_name: 'B', company: 'C "quoted"', site: '' },
    ])
  })
  it('handles CRLF and a missing final newline', () => {
    expect(parseCsv('a,b\r\n1,2\r\n3,4')).toEqual([{ a: '1', b: '2' }, { a: '3', b: '4' }])
    expect(parseCsv('')).toEqual([])
  })
  it('writes CSV that a spreadsheet will not run as a formula', () => {
    const text = toCsv(['a', 'b'], [{ a: '=SUM(A1)', b: 'x,y' }, { a: '+1', b: 'ok' }, { a: 5, b: null }])
    expect(text).toBe("a,b\n'=SUM(A1),\"x,y\"\n'+1,ok\n5,\n")
  })
})

describe('mappings', () => {
  it('reads the reviewed lists and ignores blank and comment lines', () => {
    const m = parseMappings({
      companyMerge: '# c\nold_name,company,site\nGhani Glass (KHI),Ghani Glass,Karachi\n,,\n',
      vendorParse: 'old_name,company,brand,country\nRed Lion USA (via Four Stars),Four Stars,Red Lion,USA\n',
      expenseCategories: 'legacy_category,category\nPetrol,Fuel & travel\n',
      users: 'old_name,new_name,owner_reliable\nA,B,no\nC,,yes\n',
      poClashes: 'customer_po_number,decision\nEW-1,merge\nX,whatever\n',
    })
    expect(m.companyMerge.get('ghani glass (khi)')).toEqual({ company: 'Ghani Glass', site: 'Karachi' })
    expect(m.vendorParse.get('red lion usa (via four stars)')).toEqual({ company: 'Four Stars', brand: 'Red Lion', country: 'USA' })
    expect(m.expenseCategories.get('petrol')).toBe('Fuel & travel')
    expect(m.users.get('a')).toEqual({ newName: 'B', ownerReliable: false })
    expect(m.users.get('c')).toEqual({ newName: null, ownerReliable: true })
    expect(m.poDecisions.get('EW-1')).toBe('merge')
    expect(m.poDecisions.has('X')).toBe(false)
  })

  it('has PO 000001 merged before anyone writes a line', () => {
    expect(parseMappings({}).poDecisions.get('000001')).toBe('merge')
  })
})
