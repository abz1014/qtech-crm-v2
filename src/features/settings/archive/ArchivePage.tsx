import { useEffect, useState } from 'react'
import { BrowseSection } from '@/features/settings/archive/BrowseSection'
import { PreviewTable } from '@/features/settings/archive/PreviewTable'
import { StatusCard } from '@/features/settings/archive/StatusCard'
import { useArchiveSetting } from '@/features/settings/archive/hooks'
import { PageHeader } from '@/ui/PageHeader'

/*
 * Settings > Archive. Admin only (the route is behind AdminOnly; every archive function refuses other roles as well).
 * Old and imported records are kept but hidden from lists; the totals still count them. The preview follows the date as it is typed.
 */
export function ArchivePage() {
  const s = useArchiveSetting()
  const [draft, setDraft] = useState<string | null>(null)
  const [debounced, setDebounced] = useState<string | null>(null)
  const cutoff = draft ?? s.data?.cutoff ?? ''
  useEffect(() => {
    const t = setTimeout(() => setDebounced(/^\d{4}-\d{2}-\d{2}$/.test(cutoff) ? cutoff : null), 400)
    return () => clearTimeout(t)
  }, [cutoff])
  // the first value shows at once; the wait is only for typing
  const previewCutoff = debounced ?? (s.data && draft === null ? s.data.cutoff : null)

  return (
    <div className="grid content-start gap-card-gap" data-testid="archive-page">
      <PageHeader title="Archive" lede={<span className="text-base">Keep old records out of your lists without deleting anything.</span>} />
      {s.isError ? (
        <p role="alert" className="text-base font-medium text-tone-danger-fg">
          Could not read the archive setting. Try again in a moment.
        </p>
      ) : s.data ? (
        <StatusCard setting={s.data} cutoff={cutoff} onCutoff={setDraft} />
      ) : (
        <p className="text-base text-fg-muted">Loading…</p>
      )}
      <PreviewTable cutoff={previewCutoff} />
      <BrowseSection />
    </div>
  )
}
