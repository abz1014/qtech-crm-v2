import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { RPC_MESSAGES, rpcEntry, rpcMessage } from '@/lib/errors/rpcMessages'
import { mapPgError } from '@/lib/pgErrors'

const migrations = path.resolve(__dirname, '../../../supabase/migrations')
const helpDir = path.resolve(__dirname, '../../../docs/help')

/** Every `raise exception '...'` literal in the migrations, with each % filled by a sample. */
function raisedTexts(): string[] {
  const out = new Set<string>()
  for (const name of readdirSync(migrations).filter(n => n.endsWith('.sql'))) {
    const sql = readFileSync(path.join(migrations, name), 'utf8')
    for (const m of sql.matchAll(/raise\s+exception\s+'((?:[^']|'')*)'/gi)) {
      let i = 0
      out.add(m[1].replace(/''/g, "'").replace(/%/g, () => (i++ === 0 ? 'March 2026' : 'X')))
    }
  }
  return [...out]
}

describe('rpcMessages (learnability spec 3.4)', () => {
  const texts = raisedTexts()

  it('finds the raise exception literals', () => {
    expect(texts.length).toBeGreaterThan(80)
  })

  it('every raise exception in the migrations is mapped or marked internal', () => {
    expect(texts.filter(t => !rpcEntry(t))).toEqual([])
  })

  it('every help id names a recipe that exists', () => {
    for (const e of RPC_MESSAGES) if (e.help) expect(existsSync(path.join(helpDir, `${e.help}.md`)), e.help).toBe(true)
  })

  it('reinserts placeholders and hides internal texts', () => {
    expect(rpcMessage('a quoted price is needed for: Pump P-200')?.message).toBe('Add a price for "Pump P-200", then issue the quotation again.')
    expect(rpcMessage('issue_quotation needs a quotation id and an RFQ id')).toBeNull()
    expect(rpcMessage('The amount must be above zero.')?.message).toBe('The amount must be above zero.')
  })
})

describe('mapPgError uses the table', () => {
  it('P0001 month still open says the fix and links to Month end', () => {
    const m = mapPgError({ code: 'P0001', message: 'March 2026 is still open. Close earlier months first (close_months_through closes them all).' })
    expect(m.message).toBe('Close March 2026 first. Months close in order.')
    expect(m.action?.href).toBe('/money/month-end')
    expect(m.help).toBe('month-end-close')
  })

  it('23514 inactive category no longer gives the wrong advice', () => {
    const m = mapPgError({ code: '23514', message: 'category "Fuel" is inactive; pick an active category' })
    expect(m.kind).toBe('check')
    expect(m.message).toMatch(/^"Fuel" is archived\./)
  })

  it('22023 missing price', () => {
    expect(mapPgError({ code: '22023', message: 'set the currency of this supplier order before issuing a PO' }).message).toBe(
      "Pick the supplier's currency on this supplier order, then issue the PO.",
    )
  })

  it('42501 keeps the permission kind', () => {
    const m = mapPgError({ code: '42501', message: 'only an admin can close a month' })
    expect(m.kind).toBe('permission')
    expect(m.message).toBe('Only an admin can close a month. Ask an admin if it needs doing.')
  })

  it('closed month passthrough is unchanged', () => {
    const m = mapPgError({ code: 'P0001', message: 'March 2026 is closed. An admin can reopen it.' })
    expect(m).toEqual({ kind: 'closed-month', message: 'March 2026 is closed. An admin can reopen it.' })
  })

  it('internal texts still fall back', () => {
    expect(mapPgError({ code: 'P0001', message: 'float_rfq needs at least one item' }).message).toBe('This change was refused. Nothing was saved.')
  })
})
