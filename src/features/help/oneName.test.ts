import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { norm, sourceFiles, SRC, visibleStrings } from '@/test/visibleStrings'

/*
 * One name per action (rubric "Learning it as a new user": a word check finds no duplicates). Each group below is ONE action or
 * ONE thing, with the name the glossary keeps first and the other names it has been called (the grade of 2026-10-22 and the
 * plain-words table). The check reads every visible string in src (string and template literals and JSX text; tests, the dev
 * gallery and the help folder left out) and fails when two names of one group are both on screen, or when a retired name is
 * back on its own.
 *
 * KNOWN lists the duplicates still on main, each with the screen that owns it, so this check can land before the screens are
 * fixed. An entry must still be true: when the screen is fixed, the test fails until the entry is deleted, so the list only
 * shrinks.
 */

interface Group {
  /** The one name to keep. */
  keep: string
  /** Other names of the same action or thing. Any of them on screen is a duplicate. */
  others: readonly string[]
}

export const GROUPS: readonly Group[] = [
  { keep: 'Copy and mark chased', others: ['Copy message and mark chased'] },
  { keep: 'Copy and mark reminded', others: ['Copy message and mark reminded'] },
  { keep: 'Add expenses', others: ['Add expense'] },
  { keep: 'Quotations', others: ['Quotes', 'Bids', 'Bid', 'Offers'] },
  { keep: 'Quotation sent', others: ['Bid sent', 'Mark bid sent'] },
  { keep: 'Sent to suppliers', others: ['Enquiry sent', 'Floated'] },
  { keep: 'Ask suppliers', others: ['Float', 'Float to suppliers', 'Float to another supplier', 'Copy & mark floated', 'Copy enquiry'] },
  { keep: 'Paste or photo', others: ['Paste or add a photo', 'Capture'] },
  { keep: 'Export CSV', others: ['Export'] },
  { keep: 'Chase again', others: ['Chase again now'] },
  { keep: 'Who owes us', others: ['Receivables', 'Order balances'] },
  { keep: 'Things to check', others: ['Exceptions'] },
  { keep: 'Revise quotation', others: ['Issue R2'] },
  { keep: 'Supplier orders', others: ['Procurement legs', 'Legs'] },
  { keep: 'Add supplier', others: ['Add leg'] },
  { keep: 'Is GST included?', others: ['Resolve price basis', 'Price basis unknown'] },
  { keep: 'Match bank statement', others: ['Bank tick'] },
  { keep: 'Overdue by age', others: ['Aging'] },
  { keep: 'We owe suppliers', others: ['We owe'] },
  { keep: 'Margin not final', others: ['Provisional margin'] },
  { keep: 'Repeat a past order', others: ['New order'] },
  { keep: 'Not sent to suppliers', others: ['Not floated'] },
  { keep: 'Waiting for prices', others: ['Out for offers'] },
  { keep: 'No price yet', others: ['No offer'] },
]

/**
 * Name -> the screen that still shows it and is expected to retire it (the screen agents' list). Delete an entry when the
 * screen changes; the test says when.
 */
const KNOWN: Record<string, string> = {
  // Today (features/today): the desktop pane's long button names, the tab name, a fact name.
  'Copy message and mark chased': 'Today ContextPane.tsx (desktop) and Orders GoodsChaseDialog.tsx',
  'Copy message and mark reminded': 'Today ContextPane.tsx (desktop)',
  Quotes: 'Today TodayScreen.tsx tab',
  'Enquiry sent': 'Today ContextPane.tsx fact',
  'Chase again now': 'Today ContextPane.tsx',
  // Money and Orders: the one-off cost on an order.
  'Add expense': 'Money MarginPanel.tsx and ExpenseDialog.tsx (order page "Add expense")',
}

const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/')
const HELP = `features${path.sep}help${path.sep}`
/** Files with no words on screen: generated database types and the query-key registry. */
const NOT_UI = ['types/', 'features/queryKeys.ts']

/** Visible name (normalised, lower case) -> the files that draw it as a whole string. */
let index: Map<string, Set<string>> | null = null
function names(): Map<string, Set<string>> {
  if (index) return index
  const out = new Map<string, Set<string>>()
  for (const file of sourceFiles(SRC)) {
    if (file.includes(HELP) || NOT_UI.some(n => rel(file).startsWith(n))) continue
    for (const pieces of visibleStrings(file)) {
      // Whole strings only: a name inside a sentence is not a label ("we owe you" is not the "We owe" report).
      if (pieces.some(p => typeof p !== 'string')) continue
      const s = norm(pieces.join(''))
      if (!s || s.length > 60) continue
      if (!out.has(s)) out.set(s, new Set())
      out.get(s)!.add(rel(file))
    }
  }
  return (index = out)
}

// Case matters: a label is written in sentence case, a query key or a database value in lower case ('receivables', 'aging').
const shown = (name: string) => names().get(norm(name))

/** Every retired name that is on a screen: "[Old name] (files) duplicates [Kept name]". */
export function duplicates(): Array<{ name: string; keep: string; files: string[] }> {
  const out: Array<{ name: string; keep: string; files: string[] }> = []
  for (const g of GROUPS) for (const o of g.others) {
    const files = shown(o)
    if (files) out.push({ name: o, keep: g.keep, files: [...files] })
  }
  return out
}

describe('one name per action (word check)', () => {
  beforeAll(() => {
    names()
  }, 180_000)

  it('no retired name is on a screen, other than the KNOWN ones still being fixed', () => {
    const found = duplicates().filter(d => !KNOWN[d.name])
    expect(found.map(d => `[${d.name}] in ${d.files.join(', ')}: one action, one name; call it [${d.keep}]`)).toEqual([])
  })

  it('every KNOWN duplicate is still on a screen (delete the entry once its screen is fixed)', () => {
    const fixed = Object.keys(KNOWN).filter(n => !shown(n))
    expect(fixed.map(n => `[${n}] (${KNOWN[n]}) is gone from every screen: delete it from KNOWN in oneName.test.ts`)).toEqual([])
  })

  it('every group is well formed: a kept name and other names, none in two groups', () => {
    const all = GROUPS.flatMap(g => [g.keep, ...g.others].map(n => norm(n).toLowerCase()))
    expect(all.length).toBe(new Set(all).size)
    for (const g of GROUPS) expect(g.others.length, g.keep).toBeGreaterThan(0)
  })
})
