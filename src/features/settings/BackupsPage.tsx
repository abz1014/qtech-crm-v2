import { useConfirmDecryptTest, useHealth } from '@/features/settings/hooks'
import {
  BACKUP_STALE_DAYS,
  DECRYPT_TEST_EVERY_DAYS,
  FREE_DB_BYTES,
  FREE_STORAGE_BYTES,
  USAGE_WARN_AT,
  formatBytes,
  percentText,
  usageShare,
  type HealthRow,
} from '@/features/settings/health'
import { daysBetween } from '@/features/rfqs/lib/dateText'
import { businessToday, toBusinessDate } from '@/lib/dates'
import { formatDay } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { PageHeader } from '@/ui/PageHeader'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/useToast'

/*
 * Settings > Backups and usage (migration 0120). Admin only. Three things the owner must be able to see without opening GitHub or
 * Supabase: is the nightly backup alive, how full the free plan is (500 MB database, 1 GB files), and the monthly "can I really open
 * a backup with my key" check. The numbers come from admin_health(); the backup job writes the times (scripts/backup).
 */
export function BackupsPage() {
  const q = useHealth()
  return (
    <div className="grid content-start gap-4">
      <PageHeader title="Backups and usage" lede="Is the nightly backup alive, how full the free plan is, and the monthly check that your key opens a backup." />
      {q.isPending ? (
        <div role="status" aria-busy="true" aria-label="Loading backups and usage" className="grid gap-4">
          <Skeleton className="h-[140px]" />
          <Skeleton className="h-[160px]" />
        </div>
      ) : q.isError || !q.data ? (
        <EmptyState mood="error" title="Could not load backups and usage" actions={<Button onClick={() => void q.refetch()}>Try again</Button>}>
          Nothing has changed. Check your connection, then try again.
        </EmptyState>
      ) : (
        <>
          <BackupSection h={q.data} />
          <UsageSection h={q.data} />
          <DecryptSection h={q.data} />
        </>
      )}
    </div>
  )
}

function Section({ title, hint, children, testId }: { title: string; hint?: string; children: React.ReactNode; testId: string }) {
  return (
    <section className="grid gap-4 rounded-panel border bg-surface p-5" data-testid={testId}>
      <div className="grid gap-[2px]">
        <h2 className="text-base font-semibold">{title}</h2>
        {hint ? <p className="max-w-[62ch] text-sm text-fg-muted text-pretty">{hint}</p> : null}
      </div>
      {children}
    </section>
  )
}

const dayOf = (iso: string) => toBusinessDate(new Date(iso))

function BackupSection({ h }: { h: HealthRow }) {
  const today = businessToday()
  const since = dayOf(h.lastBackupAt ?? h.trackingSince)
  const age = Math.max(0, daysBetween(since, today))
  const stale = age > BACKUP_STALE_DAYS
  return (
    <Section
      testId="backup-status"
      title="Nightly backup"
      hint="Every night the whole database and every stored file is copied, encrypted with your public key, and kept for 30 days in GitHub. Only your private key can open it."
    >
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <dt className="text-sm text-fg-muted">Last backup</dt>
          <dd className={stale ? 'text-base font-medium text-tone-danger-fg' : 'text-base'} data-testid="backup-last">
            {h.lastBackupAt ? `${formatDay(since)}${age === 0 ? ' (today)' : ` (${age} ${age === 1 ? 'day' : 'days'} ago)`}` : `None recorded yet. Watching since ${formatDay(since)}.`}
          </dd>
        </div>
        <div className="grid gap-1">
          <dt className="text-sm text-fg-muted">Size of the last backup</dt>
          <dd className="text-base">
            {h.lastBackupBytes === null
              ? 'Not known yet'
              : h.lastBackupStorageBytes === null
                ? `${formatBytes(h.lastBackupBytes)} database. The files were NOT backed up (the storage keys are not set in GitHub).`
                : `${formatBytes(h.lastBackupBytes)} database, ${formatBytes(h.lastBackupStorageBytes)} files (${h.lastBackupObjects ?? 0})`}
          </dd>
        </div>
        <div className="grid gap-1">
          <dt className="text-sm text-fg-muted">Weekly restore drill</dt>
          <dd className="text-base" data-testid="backup-drill">
            {h.lastDrillAt ? `${h.lastDrillOk ? 'Passed' : 'FAILED'} on ${formatDay(dayOf(h.lastDrillAt))}` : 'Not run yet'}
          </dd>
        </div>
        <div className="grid gap-1">
          <dt className="text-sm text-fg-muted">Files waiting in the 30-day trash</dt>
          <dd className="text-base" data-testid="backup-trash">
            {h.trashFiles === 0
              ? 'None'
              : `${h.trashFiles} ${h.trashFiles === 1 ? 'file' : 'files'}, oldest deleted ${h.trashOldest ? formatDay(dayOf(h.trashOldest)) : ''}. They are removed 30 days after the record was deleted.`}
          </dd>
        </div>
      </dl>
      {stale ? (
        <p role="alert" className="text-sm text-tone-danger-fg">
          The last backup is more than {BACKUP_STALE_DAYS} days old. Open GitHub, Actions, Backup, and look at the latest run.
        </p>
      ) : null}
    </Section>
  )
}

function Meter({ label, used, limit, testId }: { label: string; used: number; limit: number; testId: string }) {
  const share = usageShare(used, limit)
  const warn = share >= USAGE_WARN_AT
  return (
    <div className="grid gap-1" data-testid={testId}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className={warn ? 'text-sm font-medium text-tone-danger-fg' : 'text-sm text-fg-muted'}>
          {formatBytes(used)} of {formatBytes(limit)} ({percentText(share)})
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.round(share * 100))}
        className="h-2 overflow-hidden rounded bg-selected"
      >
        <div className={warn ? 'h-full bg-tone-danger-fg' : 'h-full bg-primary'} style={{ width: `${Math.min(100, share * 100)}%` }} />
      </div>
    </div>
  )
}

function UsageSection({ h }: { h: HealthRow }) {
  return (
    <Section
      testId="usage"
      title="Free plan usage"
      hint={`The free plan allows ${formatBytes(FREE_DB_BYTES)} of database and ${formatBytes(FREE_STORAGE_BYTES)} of files. To do warns you from ${percentText(USAGE_WARN_AT)}.`}
    >
      <Meter label="Database" used={h.dbBytes} limit={FREE_DB_BYTES} testId="usage-db" />
      <Meter label="File storage" used={h.storageBytes} limit={FREE_STORAGE_BYTES} testId="usage-storage" />
      <p className="text-sm text-fg-muted">{h.storageObjects} stored files.</p>
    </Section>
  )
}

function DecryptSection({ h }: { h: HealthRow }) {
  const { toast } = useToast()
  const confirm = useConfirmDecryptTest()
  const base = dayOf(h.lastDecryptTestAt ?? h.trackingSince)
  const age = daysBetween(base, businessToday())
  const due = age >= DECRYPT_TEST_EVERY_DAYS
  const done = async () => {
    try {
      await confirm.mutateAsync()
      toast({ title: 'Recorded', body: 'Next check in a month', tone: 'success' })
    } catch (err) {
      toast({ title: 'Could not save', body: mapPgError(err, { entity: 'backup check' }).message, tone: 'danger' })
    }
  }
  return (
    <Section
      testId="decrypt-check"
      title="Monthly key check"
      hint="A backup nobody can open is not a backup. Once a month, download last night's backup from GitHub and open it with your private key, then press the button. The steps are in docs/SUPABASE.md, Test-decrypt last night's backup."
    >
      <p className={due ? 'text-base font-medium text-tone-danger-fg' : 'text-base'} data-testid="decrypt-last">
        {h.lastDecryptTestAt ? `Last checked ${formatDay(base)}.` : `Never checked. Watching since ${formatDay(base)}.`}
        {due ? ' It is due.' : ''}
      </p>
      <div>
        <Button variant={due ? 'primary' : 'secondary'} className="h-auto min-h-control whitespace-normal py-2 leading-snug" onClick={() => void done()} busy={confirm.isPending} busyLabel="Saving">
          I opened a backup with my key today
        </Button>
      </div>
    </Section>
  )
}
