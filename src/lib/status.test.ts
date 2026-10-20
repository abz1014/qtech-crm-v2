import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { agingBucket, deadlineValue, resolveStatus, STATUS_ENTRIES, UnknownStatusError } from '@/lib/status'

const tokens = readFileSync(path.resolve(__dirname, '../../docs/design/tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** The data-status map in tokens.css: key -> { tone, dashed }. */
function tokenMap() {
  const map = new Map<string, { tone?: string; dashed: boolean }>()
  for (const [, selectors, decls] of tokens.matchAll(/((?:\[data-status="[^"]+"\]\s*,?\s*)+)\{([^}]*)\}/g)) {
    const keys = [...selectors.matchAll(/data-status="([^"]+)"/g)].map(m => m[1])
    const tone = /--status-fg:\s*var\(--tone-(\w+)-fg\)/.exec(decls)?.[1]
    const dashed = /--status-border-style:\s*dashed/.test(decls)
    for (const k of keys) {
      const cur = map.get(k) ?? { dashed: false }
      map.set(k, { tone: tone ?? cur.tone, dashed: cur.dashed || dashed })
    }
  }
  return map
}

describe('status registry vs tokens.css', () => {
  const map = tokenMap()

  it('every registry entry has a data-status rule, with the same tone and dash', () => {
    const problems: string[] = []
    for (const [d, v, s] of STATUS_ENTRIES) {
      const t = map.get(`${d}:${v}`)
      if (!t) problems.push(`${d}:${v} is not in tokens.css`)
      else {
        if (t.tone !== s.tone) problems.push(`${d}:${v} tone ${s.tone} but tokens.css says ${t.tone}`)
        if (t.dashed !== !!s.dashed) problems.push(`${d}:${v} dashed differs from tokens.css`)
      }
    }
    expect(problems).toEqual([])
  })

  it('every data-status rule in tokens.css has a registry entry', () => {
    const have = new Set(STATUS_ENTRIES.map(([d, v]) => `${d}:${v}`))
    expect([...map.keys()].filter(k => !have.has(k))).toEqual([])
  })

  it('each three-step track dimension has steps 0 to 3', () => {
    for (const dim of ['tcs', 'fbr']) {
      expect(STATUS_ENTRIES.filter(([d]) => d === dim).map(([, , s]) => s.step)).toEqual([0, 1, 2, 3])
    }
  })
})

/** DATA_MODEL section 5: every value of every derived dimension, as the views emit them (snake_case). */
const SECTION_5: Record<string, string[]> = {
  'rfq-outcome': ['open', 'won', 'closed'],
  sourcing: ['not_floated', 'floated_awaiting', 'partly_covered', 'covered', 'no_offer_anywhere'],
  clarification: ['none', 'to_ask', 'waiting_on_customer', 'answers_to_relay', 'answered', 'withdrawn', 'asked'],
  bid: ['to_bid', 'bid_sent', 'quotation_expired'],
  deadline: ['due-soon', 'overdue'],
  inquiry: ['shortlisted', 'sent', 'chased', 'awaiting', 'quoted', 'no_offer'],
  'inquiry-blocked': ['none', 'open_questions', 'answers_waiting'],
  order: ['active', 'cancelled', 'done'],
  goods: ['n_a', 'to_source', 'to_place', 'on_order', 'late', 'received', 'partly_delivered', 'delivered'],
  commissioning: ['n_a', 'to_plan', 'planned', 'done'],
  invoicing: ['not_invoiced', 'part', 'fully_invoiced'],
  payment: ['unpaid', 'part', 'settled', 'overdue'],
  costs: ['provisional', 'complete'],
  trust: ['ok', 'basis_unknown', 'estimated_dates', 'dates_estimated', 'value_basis_unknown'],
  tcs: ['not_started', 'copy_received', 'sent', 'delivered_to_client'],
  fbr: ['pending', 'generated', 'receipt_received', 'deposited'],
  reminder: ['not_reminded', 'reminded'],
  'company-role': ['customer', 'supplier', 'both', 'prospect'],
  fx: ['fresh', 'stale', 'unusable'],
  'fx-capture': ['captured', 'none'],
  // Amendment A6
  month: ['open', 'closed'],
  aging: ['0-30', '31-60', '61-90', '90-plus', 'advance_held'],
  bank: ['unticked', 'ticked'],
  'paid-via': ['bank', 'cash'],
  'expense-group': ['overhead', 'order_cost', 'not_in_pnl'],
  excluded: ['basis_unknown', 'zero_value', 'unattributed'],
  user: ['active', 'deactivated'],
}

describe('every section 5 value has an entry', () => {
  for (const [dimension, values] of Object.entries(SECTION_5)) {
    it(dimension, () => {
      for (const v of values) expect(() => resolveStatus(dimension, v), `${dimension}:${v}`).not.toThrow()
    })
  }

  it('maps the view outputs to the slugs the design uses', () => {
    expect(resolveStatus('sourcing', 'floated_awaiting').key).toBe('sourcing:awaiting')
    expect(resolveStatus('sourcing', 'no_offer_anywhere').label).toBe('No price yet')
    expect(resolveStatus('tcs', 'delivered_to_client').key).toBe('tcs:delivered')
    expect(resolveStatus('fbr', 'receipt_received').key).toBe('fbr:receipt')
    expect(resolveStatus('invoicing', 'fully_invoiced').key).toBe('invoicing:full')
    expect(resolveStatus('bid', 'quotation_expired').key).toBe('bid:expired')
    expect(resolveStatus('goods', 'n_a').key).toBe('goods:na')
    expect(resolveStatus('trust', 'estimated_dates').dashed).toBe(true)
  })

  it('expense-group reads the expense_categories.grp values the database stores (overhead, order_cost, non_pnl)', () => {
    // 0025_expense_categories.sql: check (grp in ('overhead', 'order_cost', 'non_pnl'))
    expect(resolveStatus('expense-group', 'overhead').key).toBe('expense-group:overhead')
    expect(resolveStatus('expense-group', 'order_cost').key).toBe('expense-group:order-cost')
    expect(resolveStatus('expense-group', 'non_pnl').key).toBe('expense-group:not-in-pnl')
  })

  it('derives deadline risk and aging buckets', () => {
    expect(deadlineValue(5, true)).toBe('overdue')
    expect(deadlineValue(1, false)).toBe('due-soon')
    expect(deadlineValue(9, false)).toBeNull()
    expect([0, 30, 31, 60, 61, 90, 91].map(agingBucket)).toEqual([
      'aging:0-30', 'aging:0-30', 'aging:31-60', 'aging:31-60', 'aging:61-90', 'aging:61-90', 'aging:90-plus',
    ])
  })
})

describe('labels use the plain-words glossary (DECISIONS 2026-10-19)', () => {
  it('no chip says floated, bid, relay, covered, n/a, provisional or basis unknown', () => {
    const jargon = /floated|\bbid\b|relay|covered|^n\/a$|provisional|basis unknown/i
    expect(STATUS_ENTRIES.filter(([, , s]) => jargon.test(s.label)).map(([d, v, s]) => `${d}:${v} "${s.label}"`)).toEqual([])
  })

  it('reads the glossary words', () => {
    expect(resolveStatus('sourcing', 'not_floated').label).toBe('Not sent to suppliers')
    expect(resolveStatus('sourcing', 'floated_awaiting').label).toBe('Waiting for prices')
    expect(resolveStatus('sourcing', 'covered').label).toBe('All priced')
    expect(resolveStatus('bid', 'to_bid').label).toBe('To quote')
    expect(resolveStatus('bid', 'bid_sent').label).toBe('Quotation sent')
    expect(resolveStatus('trust', 'value_basis_unknown').label).toBe('Is GST included?')
    expect(resolveStatus('costs', 'provisional').label).toBe('Not final')
  })
})

describe('an unknown value fails loudly', () => {
  it('throws for an unknown value', () => {
    expect(() => resolveStatus('goods', 'lost_in_transit')).toThrow(UnknownStatusError)
  })
  it('throws for an unknown dimension', () => {
    expect(() => resolveStatus('weather', 'sunny')).toThrow(UnknownStatusError)
  })
  it('does not fall through to Object.prototype', () => {
    expect(() => resolveStatus('goods', 'constructor')).toThrow(UnknownStatusError)
  })
})
