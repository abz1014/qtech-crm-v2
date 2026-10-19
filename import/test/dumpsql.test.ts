import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// dump.sql is pasted into the OLD project's SQL editor. These checks run without a database: it must be one read-only
// statement and name every table the reader uses. The load test (db.yml) runs it for real against a stand-in schema.
const sql = readFileSync(fileURLToPath(new URL('../dump/dump.sql', import.meta.url)), 'utf8')
const code = sql
  .split('\n')
  .filter(l => !l.trim().startsWith('--'))
  .map(l => l.replace(/--.*$/, ''))
  .join('\n')

describe('import/dump/dump.sql', () => {
  it('is a single SELECT: it starts with WITH, ends with one semicolon, and has no other statement', () => {
    const body = code.replace(/\$q\$[\s\S]*?\$q\$/g, "''").replace(/'[^']*'/g, "''")
    expect(body.trim()).toMatch(/^with cfg as/i)
    expect(body.trim().endsWith(';')).toBe(true)
    expect(body.trim().slice(0, -1)).not.toContain(';')
  })

  it('contains no statement that writes or changes anything', () => {
    const body = code.replace(/\$q\$[\s\S]*?\$q\$/g, "''").replace(/'[^']*'/g, "''")
    for (const word of ['insert', 'update', 'delete', 'drop', 'alter', 'create', 'truncate', 'grant', 'revoke', 'copy', 'call', 'execute', 'set', 'vacuum', 'comment', 'into']) {
      expect(body, word).not.toMatch(new RegExp(`\\b${word}\\b`, 'i'))
    }
    // the dynamic queries it builds are SELECTs too
    for (const m of sql.matchAll(/\$q\$([\s\S]*?)\$q\$/g)) expect(m[1]!.trim()).toMatch(/^select\b/i)
  })

  it('never copies the plain-text passwords, and does not copy HR data', () => {
    expect(sql).toMatch(/\('users',\s+'\{password\}'/)
    expect(sql).not.toMatch(/\('employees',\s+'\{\}'::?/)
    expect(sql).toMatch(/counted\(key\) as \(values[^)]*'employees'/)
  })

  it('names every old table the transforms read', () => {
    for (const t of [
      'users', 'clients', 'prospects', 'vendors', 'rfqs', 'rfq_line_items', 'supplier_inquiries', 'supplier_quotes', 'orders',
      'order_engineers', 'gst_invoices', 'invoices', 'payment_records', 'order_payments', 'supplier_payments', 'payables',
      'payable_payments', 'expenses', 'recurring_expenses', 'quarterly_targets', 'documents',
    ]) {
      expect(sql, t).toMatch(new RegExp(`\\('${t}',`))
    }
  })

  it('guards each read by whether the table exists, so a missing table cannot stop it', () => {
    expect(sql).toContain('to_regclass(')
    expect(sql).toContain('tables_missing')
  })
})
