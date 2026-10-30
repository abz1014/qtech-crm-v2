import { describe, expect, it } from 'vitest'
import { buildToday, ruleHealth } from './rules'
import type { HealthFact, TodayInputs } from './types'
import { FREE_DB_BYTES, FREE_STORAGE_BYTES, formatBytes, fullestUsage } from '@/features/settings/health'

/* 0120: the three admin chores for backups and the free plan. Fictional data. */
const MB = 1024 * 1024
const ok: HealthFact = { backupOn: '2026-10-29', backupRecorded: true, decryptOn: '2026-10-20', dbBytes: 40 * MB, storageBytes: 100 * MB }
const ctx = (h: HealthFact | null | undefined, o: Partial<TodayInputs> = {}): TodayInputs => ({
  today: '2026-10-30', user: { id: 'u-admin', role: 'admin' }, roleOf: () => 'admin', rfqs: [], clarifications: [], inquiries: [], legs: [], orders: [], receivables: [],
  monthEnd: null, snoozes: [], health: h, ...o,
})
const rules = (h: HealthFact | null | undefined, o: Partial<TodayInputs> = {}) => ruleHealth(ctx(h, o)).map(r => r.rule)

describe('backup and plan chores', () => {
  it('shows nothing when the backup is fresh, the plan is roomy and the key was checked this month', () => {
    expect(rules(ok)).toEqual([])
  })

  it('warns when the last backup is more than 2 days old, red, and says never when none was recorded', () => {
    expect(rules({ ...ok, backupOn: '2026-10-28' })).toEqual([]) // exactly 2 days: still fine
    const r = ruleHealth(ctx({ ...ok, backupOn: '2026-10-27' }))[0]
    expect(r.rule).toBe('backup_stale')
    expect(r.title).toBe('Backup is 3 days old: check GitHub')
    expect(r.badge.tone).toBe('danger')
    expect(r.group).toBe('now')
    expect(r.href).toBe('/settings/backups')
    const never = ruleHealth(ctx({ ...ok, backupOn: '2026-10-20', backupRecorded: false }))[0]
    expect(never.title).toBe('No backup has reported yet: check GitHub')
  })

  it('warns from 70% of either limit, amber, red from 90%', () => {
    expect(rules({ ...ok, dbBytes: 0.69 * FREE_DB_BYTES })).toEqual([])
    const db = ruleHealth(ctx({ ...ok, dbBytes: 0.7 * FREE_DB_BYTES }))[0]
    expect(db.rule).toBe('usage_high')
    expect(db.title).toBe('Free plan 70% full (database)')
    expect(db.badge.tone).toBe('warning')
    const files = ruleHealth(ctx({ ...ok, storageBytes: 0.95 * FREE_STORAGE_BYTES }))[0]
    expect(files.title).toBe('Free plan 95% full (file storage)')
    expect(files.badge.tone).toBe('danger')
  })

  it('asks for the monthly key check after 31 days, grey, in This week', () => {
    expect(rules({ ...ok, decryptOn: '2026-09-30' })).toEqual([]) // 30 days
    const r = ruleHealth(ctx({ ...ok, decryptOn: '2026-09-29' }))[0] // 31 days
    expect(r.rule).toBe('decrypt_test')
    expect(r.group).toBe('ready')
    expect(r.badge).toEqual({ text: '31 days since', tone: 'neutral' })
  })

  it('is for the admin only', () => {
    const stale = { ...ok, backupOn: '2026-10-01' }
    expect(rules(stale, { user: { id: 'u-sales', role: 'sales' } })).toEqual([])
    expect(rules(stale, { user: { id: 'u-eng', role: 'engineer' } })).toEqual([])
    expect(rules(null)).toEqual([])
    expect(rules(undefined)).toEqual([])
  })

  it('reaches the admin through buildToday', () => {
    const view = buildToday(ctx({ ...ok, backupOn: '2026-10-01' }))
    expect(view.active.some(i => i.rule === 'backup_stale')).toBe(true)
  })
})

describe('byte text', () => {
  it('uses binary units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1536)).toBe('1.50 KB')
    expect(formatBytes(500 * MB)).toBe('500.0 MB')
    expect(formatBytes(FREE_STORAGE_BYTES)).toBe('1.00 GB')
  })
  it('names the fuller of the two limits', () => {
    expect(fullestUsage(100 * MB, 100 * MB).what).toBe('database')
    expect(fullestUsage(10 * MB, 900 * MB).what).toBe('file storage')
  })
})
