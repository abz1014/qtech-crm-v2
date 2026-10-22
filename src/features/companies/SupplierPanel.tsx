import { useMemo } from 'react'
import { useSupplierActivity, useSupplierRecordView } from '@/features/companies/hooks'
import { Deliveries, RecentQuotes, type ReplyFact } from '@/features/companies/SupplierRecordPanels'

/*
 * The supplier's history, most useful first (UX audit 2026-10-19, 9b; round 3): one Enquiries list (what used to be "Recent
 * quotes" and "Recent enquiries": every enquiry with the price they quoted, how long they took and what came of it), then how
 * their deliveries went. The counts that were the "What we know" panel are one line under the name (recordLine), with their
 * rules behind its (i). Facts come from our own enquiries, quotes and deliveries; nothing is scored or ranked (DATA_MODEL 5c).
 */
export function SupplierPanel({ companyId }: { companyId: string }) {
  const record = useSupplierRecordView(companyId)
  const activity = useSupplierActivity(companyId)
  const retryRecord = () => void record.query.refetch()
  const replies = useMemo(
    () => new Map<string, ReplyFact>((activity.data ?? []).map(a => [a.inquiryId, { days: a.replyDays, legacy: a.isLegacy }])),
    [activity.data],
  )

  return (
    <>
      <RecentQuotes view={record.view} loading={record.query.isPending} error={record.query.isError} onRetry={retryRecord} replies={replies} />
      <Deliveries view={record.view} loading={record.query.isPending} error={record.query.isError} onRetry={retryRecord} today={record.today} />
    </>
  )
}
