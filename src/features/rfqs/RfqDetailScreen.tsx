import { useMemo, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { FileQuestion } from 'lucide-react'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Skeleton } from '@/ui/Skeleton'
import { useFxLatest, useRfqHeader, useRfqInquiries, useRfqItems } from '@/features/rfqs/hooks'
import { toRateTable } from '@/features/rfqs/lib'
import { RfqHeaderBlock } from '@/features/rfqs/RfqHeaderBlock'
import { ItemsPanel } from '@/features/rfqs/ItemsPanel'
import { SupplierReplies } from '@/features/rfqs/SupplierReplies'
import { QuotationsPanel } from '@/features/quotations/QuotationsPanel'
import { ClarificationsPanel } from '@/features/rfqs/ClarificationsPanel'
import { AttachmentsPanel } from '@/features/rfqs/AttachmentsPanel'

/*
 * RFQ detail (R07; g2-rfq-detail.html). Replaces the placeholder at /rfqs/:id.
 *
 * What is on the page: the header with its state chips and one-tap actions (mark bid sent, close or lose); the items
 * with every supplier's price side by side and the lowest marked (comparePrices, at today's rate); one inline reply row
 * per supplier asked (a price per item, the currency pre-filled and never typed, lead time, stock, one-tap "can't quote"
 * with a reason, one-tap chase); the questions for the customer (R09), the files (R10), and the quotations with the Issue quotation dialog (R19).
 *
 * FE-2 entry burden, listed for the commit:
 *   required     a price (greater than zero) for each item the supplier quoted. Nothing else is required.
 *   pre-filled   currency (supplier's last currency, else the country map, else PKR), the supplier's lead time and stock
 *                when they were saved before, the close reason (from the RFQ's state), the date (today).
 *   optional     lead time, stock, a note on closing, a per-item "can't quote" reason.
 *   interactions supplier reply: one typed price per item, then "Save reply" (currency never typed).
 *                can't quote: 1 tap. chase: 1 tap. mark bid sent: 1 tap. close or lose: 2 taps.
 *
 * A missing exchange rate never blocks anything (BUILD_PLAN A3/A4): the line shows "not compared, no rate".
 */

function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-6 md:px-8">{children}</div>
}

function PageSkeleton() {
  return (
    <Shell>
      <div className="grid gap-4" aria-busy="true" aria-label="Loading RFQ">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-96 max-w-full" />
        <Skeleton className="h-5 w-72 max-w-full" />
        <Skeleton className="h-20 w-full" />
        <div className="mt-2 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    </Shell>
  )
}

export default function RfqDetailScreen() {
  const { id } = useParams()
  const header = useRfqHeader(id)
  const items = useRfqItems(id)
  const inquiries = useRfqInquiries(id)
  const fx = useFxLatest()
  const rates = useMemo(() => toRateTable(fx.data ?? []), [fx.data])

  if (header.isPending) return <PageSkeleton />
  if (header.isError) {
    return (
      <Shell>
        <EmptyState
          mood="error"
          title="Couldn't load this RFQ"
          actions={
            <Button variant="primary" onClick={() => void header.refetch()}>
              Try again
            </Button>
          }
        >
          Nothing was changed. Check your connection and try again.
        </EmptyState>
      </Shell>
    )
  }
  if (!header.data) {
    return (
      <Shell>
        <EmptyState
          icon={FileQuestion}
          title="This RFQ isn't here"
          actions={
            <Link to="/rfqs" className="inline-flex h-control items-center rounded border border-primary bg-primary px-3 text-sm font-medium text-primary-foreground">
              All RFQs
            </Link>
          }
        >
          The link may be wrong, or the RFQ was removed. Open the RFQ list to find it.
        </EmptyState>
      </Shell>
    )
  }

  const rfq = header.data
  const loadError = items.isError || inquiries.isError
  return (
    <Shell>
      <RfqHeaderBlock rfq={rfq} />
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 gap-6">
          {loadError ? (
            <EmptyState
              mood="error"
              title="Couldn't load the items and replies"
              actions={
                <Button
                  variant="primary"
                  onClick={() => {
                    void items.refetch()
                    void inquiries.refetch()
                  }}
                >
                  Try again
                </Button>
              }
            >
              Nothing was changed. Check your connection and try again.
            </EmptyState>
          ) : items.isPending || inquiries.isPending ? (
            <div className="grid gap-4" aria-busy="true" aria-label="Loading items and replies">
              <Skeleton className="h-56 w-full" />
              <Skeleton className="h-56 w-full" />
            </div>
          ) : (
            <>
              <SupplierReplies rfq={rfq} items={items.data} inquiries={inquiries.data} rates={rates} />
              <ItemsPanel items={items.data} inquiries={inquiries.data} rates={rates} />
            </>
          )}
        </div>
        <aside className="grid min-w-0 gap-6" aria-label="Questions and quotations">
          <ClarificationsPanel rfq={rfq} inquiries={inquiries.data ?? []} />
          <QuotationsPanel rfq={rfq} inquiries={inquiries.data ?? []} />
          <AttachmentsPanel rfqId={rfq.id} />
        </aside>
      </div>
    </Shell>
  )
}
