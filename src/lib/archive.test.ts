import { describe, expect, it } from 'vitest'
import { hideArchived } from '@/lib/archive'

describe('hideArchived', () => {
  it('adds eq("archived", false) and returns the same builder', () => {
    const seen: unknown[][] = []
    const q = {
      eq(c: 'archived', v: boolean) {
        seen.push([c, v])
        return q
      },
    }
    expect(hideArchived(q)).toBe(q)
    expect(seen).toEqual([['archived', false]])
  })
})
