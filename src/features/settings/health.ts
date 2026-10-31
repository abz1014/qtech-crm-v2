/*
 * Backups and usage (migration 0120): the pure part. What the free plan allows, how full we are, how old the last backup is.
 * The numbers come from the admin_health() function (healthApi.ts); nothing here reads the database.
 */

/** Supabase Free plan: 500 MB of database, 1 GB of file storage. */
export const FREE_DB_BYTES = 500 * 1024 * 1024
export const FREE_STORAGE_BYTES = 1024 * 1024 * 1024
/** From this share of either limit, Today warns the admin. */
export const USAGE_WARN_AT = 0.7
/** A nightly backup older than this many days is a failure the admin must see. */
export const BACKUP_STALE_DAYS = 2
/** The key-custody check (open a backup with the private key) is due every this many days. */
export const DECRYPT_TEST_EVERY_DAYS = 31

export interface HealthRow {
  lastBackupAt: string | null
  lastBackupBytes: number | null
  lastBackupStorageBytes: number | null
  lastBackupObjects: number | null
  lastDrillAt: string | null
  lastDrillOk: boolean | null
  lastDecryptTestAt: string | null
  trackingSince: string
  dbBytes: number
  storageBytes: number
  storageObjects: number
  trashFiles: number
  trashOldest: string | null
}

export const usageShare = (used: number, limit: number): number => (limit > 0 ? used / limit : 0)

/** "12.4 MB", "1.02 GB": binary units, one or two decimals. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${i === 0 ? v : v < 10 ? v.toFixed(2) : v.toFixed(1)} ${units[i]}`
}

export const percentText = (share: number): string => `${Math.round(share * 100)}%`

/** The larger of the two shares, and which one it is. */
export function fullestUsage(dbBytes: number, storageBytes: number): { share: number; what: 'database' | 'file storage' } {
  const db = usageShare(dbBytes, FREE_DB_BYTES)
  const st = usageShare(storageBytes, FREE_STORAGE_BYTES)
  return db >= st ? { share: db, what: 'database' } : { share: st, what: 'file storage' }
}
