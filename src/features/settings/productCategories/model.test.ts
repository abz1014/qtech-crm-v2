import { describe, expect, it } from 'vitest'
import { categoryNameError, filterCategories, mergeSentence } from '@/features/settings/productCategories/model'

const rows = [
  { id: 'a', name: 'Contactors', curated: true, suppliers: 4 },
  { id: 'b', name: 'contactor sets', curated: false, suppliers: 1 },
  { id: 'c', name: 'Cables', curated: true, suppliers: 0 },
]

describe('product categories model', () => {
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
