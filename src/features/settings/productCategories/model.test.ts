import { describe, expect, it } from 'vitest'
import { categoryNameError, countSuppliersByCategory, filterCategories, mergeSentence } from '@/features/settings/productCategories/model'

const rows = [
  { id: 'a', name: 'Contactors', curated: true, suppliers: 4, tagged: 4 },
  { id: 'b', name: 'contactor sets', curated: false, suppliers: 1, tagged: 1 },
  { id: 'c', name: 'Cables', curated: true, suppliers: 0, tagged: 0 },
]

describe('product categories model', () => {
  it('counts each supplier once per category: tag only, evidence only, both, or none', () => {
    const tags = [{ brand_id: 'a', company_id: 's1' }, { brand_id: 'a', company_id: 's2' }, { brand_id: 'a', company_id: 's2' }]
    const evidence = [{ family_id: 'a', supplier_id: 's2' }, { family_id: 'a', supplier_id: 's3' }, { family_id: 'b', supplier_id: 's3' }]
    const { suppliers, tagged } = countSuppliersByCategory(tags, evidence)
    expect(suppliers.get('a')).toBe(3) // s1 tag only, s2 both (once), s3 evidence only
    expect(suppliers.get('b')).toBe(1) // evidence only
    expect(suppliers.get('c') ?? 0).toBe(0) // none
    expect(tagged.get('a')).toBe(2)
    expect(tagged.get('b') ?? 0).toBe(0)
  })

  it('filters by curated, others, all and by text, curated first then by name', () => {
    expect(filterCategories(rows, 'curated', '').map(r => r.id)).toEqual(['c', 'a'])
    expect(filterCategories(rows, 'other', '').map(r => r.id)).toEqual(['b'])
    expect(filterCategories(rows, 'all', '').map(r => r.id)).toEqual(['c', 'a', 'b'])
    expect(filterCategories(rows, 'all', '  CONTACT ').map(r => r.id)).toEqual(['a', 'b'])
  })

  it('a name is unique ignoring case and spaces, and not empty or too long', () => {
    expect(categoryNameError('  contactors ', rows, 'z')).toMatch(/already exists/)
    expect(categoryNameError('Contactors', rows, 'a')).toBeNull()
    expect(categoryNameError('   ', rows, 'a')).toBe('Enter a name.')
    expect(categoryNameError('x'.repeat(81), rows, 'a')).toMatch(/80/)
  })

  it('says what a merge does', () => {
    expect(mergeSentence(rows[1], rows[0])).toBe('Every item and order line of "contactor sets" moves into "Contactors", and 1 supplier is tagged with it. "contactor sets" is then removed.')
    expect(mergeSentence(rows[2], rows[0])).toContain('no supplier is tagged with it')
  })
})
