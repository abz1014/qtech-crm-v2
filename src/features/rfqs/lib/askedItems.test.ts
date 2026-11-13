import { describe, expect, it } from 'vitest'
import { askedAbout, askedItemsOf, sameScope, scopeFor, widenScope } from '@/features/rfqs/lib/askedItems'

/* Supplier flow D (0140): which items a supplier was asked about. NULL is every item, as every inquiry before 0140 meant. */

const all = ['a', 'b', 'c']

describe('askedItems', () => {
  it('an inquiry from before 0140 (no list) was asked about every item', () => {
    expect(askedAbout({}, 'c')).toBe(true)
    expect(askedAbout({ askedItemIds: null }, 'c')).toBe(true)
    expect(askedItemsOf({ askedItemIds: null }, all.map(id => ({ id })))).toHaveLength(3)
  })

  it('an inquiry about two of three items was not asked about the third', () => {
    const inq = { askedItemIds: ['a', 'b'] }
    expect(askedAbout(inq, 'a')).toBe(true)
    expect(askedAbout(inq, 'c')).toBe(false)
    expect(askedItemsOf(inq, all.map(id => ({ id }))).map(i => i.id)).toEqual(['a', 'b'])
  })

  it('scopeFor stores every item as null and a choice in the RFQ order', () => {
    expect(scopeFor(['c', 'b', 'a'], all)).toBeNull()
    expect(scopeFor(['c', 'a'], all)).toEqual(['a', 'c'])
    expect(scopeFor(['b'], undefined)).toEqual(['b'])
  })

  it('widenScope unions, keeps null, and becomes null once every item is covered', () => {
    expect(widenScope(['a'], ['c'], all)).toEqual(['a', 'c'])
    expect(widenScope(['a', 'c'], ['b'], all)).toBeNull()
    expect(widenScope(null, ['a'], all)).toBeNull()
    expect(widenScope(['a'], null, all)).toBeNull()
  })

  it('sameScope compares as sets', () => {
    expect(sameScope(null, undefined)).toBe(true)
    expect(sameScope(['a', 'b'], ['b', 'a'])).toBe(true)
    expect(sameScope(['a'], null)).toBe(false)
  })
})
