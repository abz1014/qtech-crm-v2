import { describe, expect, it } from 'vitest'
import { quickProblem } from '@/features/money/expenses/quick'

const base = { categoryId: 'ca7e0000-0000-4000-8000-000000000004', inputTax: 0 }

describe('quickProblem: the amount', () => {
  it('nothing typed asks for the amount', () => {
    expect(quickProblem({ ...base, amount: null })).toBe('amount')
  })
  it('0 and a negative amount say it must be above zero', () => {
    expect(quickProblem({ ...base, amount: 0 })).toBe('positive')
    expect(quickProblem({ ...base, amount: -5 })).toBe('positive')
  })
  it('an amount over the ceiling (999,999,999,999.99) is refused with its own message', () => {
    expect(quickProblem({ ...base, amount: 999_999_999_999 })).toBeNull()
    expect(quickProblem({ ...base, amount: 1_000_000_000_000 })).toBe('large')
  })
})
