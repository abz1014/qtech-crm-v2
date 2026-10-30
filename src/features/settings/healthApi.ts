import type { HealthRow } from '@/features/settings/health'
import { requireSupabase, unwrap } from '@/lib/supabase'

/* admin_health() and confirm_backup_decrypt_test() (migration 0120). Admin only: the database refuses everyone else. */

export async function getHealth(): Promise<HealthRow | null> {
  const rows = unwrap(await requireSupabase().rpc('admin_health'))
  const r = rows?.[0]
  if (!r) return null
  return {
    lastBackupAt: r.last_backup_at,
    lastBackupBytes: r.last_backup_bytes,
    lastBackupStorageBytes: r.last_backup_storage_bytes,
    lastBackupObjects: r.last_backup_objects,
    lastDrillAt: r.last_drill_at,
    lastDrillOk: r.last_drill_ok,
    lastDecryptTestAt: r.last_decrypt_test_at,
    trackingSince: r.tracking_since,
    dbBytes: Number(r.db_bytes),
    storageBytes: Number(r.storage_bytes),
    storageObjects: Number(r.storage_objects),
    trashFiles: Number(r.trash_files),
    trashOldest: r.trash_oldest,
  }
}

export async function confirmDecryptTest(): Promise<void> {
  const { error } = await requireSupabase().rpc('confirm_backup_decrypt_test')
  if (error) throw error
}
