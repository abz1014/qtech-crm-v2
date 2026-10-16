import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { LegacyDump, LegacyTables, StorageObjectMeta } from '../types'
import type { Extractor } from './extractor'

// A dump is one JSON file (see docs/IMPORT.md for the query that makes it):
//   { "meta": {...}, "tables": { "clients": [...], "orders": [...], ... }, "storage": [ { bucket, path, size_bytes, mime_type } ] }
// next to an optional folder  storage/<bucket>/<path>  holding the receipt files themselves.

const KNOWN = new Set([
  'users', 'clients', 'prospects', 'vendors', 'rfqs', 'rfq_line_items', 'supplier_inquiries', 'supplier_quotes', 'orders', 'order_engineers',
  'gst_invoices', 'invoices', 'payment_records', 'order_payments', 'supplier_payments', 'payables', 'payable_payments', 'expenses',
  'recurring_expenses', 'follow_up_actions', 'quarterly_targets', 'cost_lines', 'costing_config', 'budgets', 'employees', 'attendance',
  'audit_log', 'documents',
])

export interface ParsedDump {
  dump: LegacyDump
  warnings: string[]
}

export function parseDump(text: string): ParsedDump {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    throw new Error(`The dump is not valid JSON: ${(e as Error).message}`)
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The dump must be a JSON object with a "tables" key.')
  const o = raw as Record<string, unknown>
  const tablesRaw = o['tables']
  if (!tablesRaw || typeof tablesRaw !== 'object' || Array.isArray(tablesRaw)) throw new Error('The dump has no "tables" object.')

  const warnings: string[] = []
  const tables: LegacyTables = {}
  for (const [name, rows] of Object.entries(tablesRaw as Record<string, unknown>)) {
    if (!Array.isArray(rows)) throw new Error(`tables.${name} must be an array of rows.`)
    if (!KNOWN.has(name)) warnings.push(`Unknown table "${name}" in the dump: ignored.`)
    tables[name] = rows.map((r, i) => {
      if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error(`tables.${name}[${i}] is not a row object.`)
      return r as Record<string, unknown>
    })
  }
  for (const needed of ['clients', 'orders', 'rfqs']) {
    if (!tables[needed]) warnings.push(`The dump has no "${needed}" table.`)
  }

  const storageRaw = o['storage']
  const storage: StorageObjectMeta[] = []
  if (storageRaw !== undefined) {
    if (!Array.isArray(storageRaw)) throw new Error('"storage" must be an array.')
    for (const s of storageRaw as Record<string, unknown>[]) {
      storage.push({
        bucket: String(s['bucket'] ?? ''),
        path: String(s['path'] ?? ''),
        size_bytes: Number(s['size_bytes'] ?? 0),
        mime_type: String(s['mime_type'] ?? ''),
      })
    }
  }
  const meta = o['meta'] && typeof o['meta'] === 'object' ? (o['meta'] as Record<string, unknown>) : {}
  return { dump: { tables, storage, meta }, warnings }
}

/** Reads a dump from a .json file, or from a folder that holds dump.json (and storage/). */
export function readDump(path: string): ParsedDump & { storageDir: string | null } {
  if (!existsSync(path)) throw new Error(`No such file or folder: ${path}`)
  const isDir = statSync(path).isDirectory()
  const file = isDir ? join(path, 'dump.json') : path
  if (!existsSync(file)) throw new Error(`No dump.json in ${path}`)
  const parsed = parseDump(readFileSync(file, 'utf8'))
  const storageDir = isDir && existsSync(join(path, 'storage')) ? join(path, 'storage') : null
  return { ...parsed, storageDir }
}

export class DumpExtractor implements Extractor {
  constructor(private readonly path: string) {}
  async extract(): Promise<LegacyDump> {
    return readDump(this.path).dump
  }
}
