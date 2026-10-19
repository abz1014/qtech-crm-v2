// Prints SQL that builds a stand-in for the OLD database from a dump.json, in a scratch schema:
//   node import/dump/make-old-schema.mjs <dump.json> <schema>
// Used by the load test to prove that dump.sql turns a real database back into the JSON the reader expects. Columns are typed
// numeric, boolean or text from the values (the old text-date columns are text). Local test stacks only.
import { readFileSync } from 'node:fs'

const [file, schema] = process.argv.slice(2)
if (!file || !/^[a-z_][a-z0-9_]*$/.test(schema ?? '')) {
  console.error('usage: make-old-schema.mjs <dump.json> <schema>')
  process.exit(2)
}
const dump = JSON.parse(readFileSync(file, 'utf8'))
const q = (s) => `"${s.replace(/"/g, '""')}"`
const out = [`drop schema if exists ${q(schema)} cascade;`, `create schema ${q(schema)};`]
for (const [table, rows] of Object.entries(dump.tables)) {
  const cols = new Map()
  const typed = new Set()
  for (const r of rows) {
    for (const [k, v] of Object.entries(r)) {
      if (!cols.has(k)) cols.set(k, 'text')
      if (v !== null && !typed.has(k)) {
        typed.add(k)
        cols.set(k, typeof v === 'number' ? 'numeric' : typeof v === 'boolean' ? 'boolean' : 'text')
      }
    }
  }
  if (cols.size === 0) cols.set('id', 'text')
  out.push(`create table ${q(schema)}.${q(table)} (${[...cols].map(([c, t]) => `${q(c)} ${t}`).join(', ')});`)
  if (rows.length) {
    out.push(`insert into ${q(schema)}.${q(table)} select * from jsonb_populate_recordset(null::${q(schema)}.${q(table)}, $json$${JSON.stringify(rows)}$json$::jsonb);`)
  }
}
console.log(out.join('\n'))
