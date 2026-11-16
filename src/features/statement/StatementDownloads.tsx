import { useId, useState } from 'react'
import { FileDown, FileSpreadsheet } from 'lucide-react'
import { useSeesPrices, useSession } from '@/app/session'
import { businessToday } from '@/lib/dates'
import { mapPgError } from '@/lib/pgErrors'
import { rfqRef } from '@/lib/refs'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { Button } from '@/ui/Button'
import { useToast } from '@/ui/useToast'
import { jobLabel } from '@/features/jobs/lib/listModel'
import { downloadBlob } from '@/features/quotations/lib/sharePdf'
import { useRfqHeader, useRfqInquiries, useRfqItems } from '@/features/rfqs/hooks'
import { useCompanyProfile } from '@/features/settings/hooks'
import { buildStatement, statementFileName } from '@/features/statement/model'
import { generateStatementXlsx } from '@/features/statement/excel/generate'
import { generateStatementPdf } from '@/features/statement/pdf/generate'

/*
 * The Comparative Statement as two downloads (owner, 2026-11-16: "It should only be exportable via Excel and PDF"; the on-screen
 * table is gone, and /jobs/<key>/statement now sends a person to the job page). Both files are made from the same buildStatement(),
 * so they hold the same rows and columns: every supplier quote per item, in supplier-name order, with unit cost, total cost, lead
 * time, unit and total weight, country of origin and note, the suppliers that did not reply, and the totals per supplier per
 * currency. Like the page it replaces, it selects nothing.
 *
 * Admin and sales only: for an engineer this draws nothing and asks the database for nothing (separate markup, not hidden by CSS;
 * the database refuses an engineer the prices as well, 0081 and 0111).
 *
 * "panel": the job page's slim section (a title, a line under it, the two buttons; stacked full width when narrow). "inline": one compact line and the two buttons,
 * for the Issue quotation dialog.
 */
type Kind = 'xlsx' | 'pdf'

export function StatementDownloads(props: { jobKey: string; rfqId: string; look?: 'panel' | 'inline' }) {
  const sees = useSeesPrices()
  if (!sees) return null
  return <Downloads {...props} />
}

function Downloads({ jobKey, rfqId, look = 'panel' }: { jobKey: string; rfqId: string; look?: 'panel' | 'inline' }) {
  const { toast } = useToast()
  const session = useSession()
  const phone = useMediaQuery('(max-width: 767px)')
  const header = useRfqHeader(rfqId)
  const items = useRfqItems(rfqId)
  const inquiries = useRfqInquiries(rfqId)
  const profile = useCompanyProfile()
  const [making, setMaking] = useState<Kind | null>(null)
  const headingId = useId()

  const ready = Boolean(header.data && items.data && inquiries.data && profile.data) && (items.data ?? []).length > 0
  const label = jobLabel(jobKey)

  const download = async (kind: Kind) => {
    if (!ready || making || !header.data || !profile.data) return
    setMaking(kind)
    try {
      const rfq = header.data
      const data = {
        statement: buildStatement(items.data ?? [], inquiries.data ?? [], { showNoReply: true }),
        reference: `${label} (${rfqRef(rfq.number)})`,
        customer: rfq.company.name,
        date: businessToday(),
        preparedBy: session.status === 'signed-in' ? session.user.name : '',
        showNoReply: true,
      }
      const blob = kind === 'xlsx' ? await generateStatementXlsx(data, profile.data) : await generateStatementPdf(data, profile.data)
      const name = statementFileName(label, kind)
      downloadBlob(blob, name)
      toast({ title: 'Comparative statement downloaded', body: name, tone: 'success' })
    } catch (err) {
      toast({ title: kind === 'xlsx' ? 'Could not make the Excel file' : 'Could not make the PDF', body: mapPgError(err).message, tone: 'danger' })
    } finally {
      setMaking(null)
    }
  }

  const size = look === 'inline' ? 'sm' : phone ? 'touch' : undefined
  const buttons = (
    <>
      <Button
        size={size}
        icon={FileSpreadsheet}
        onClick={() => void download('xlsx')}
        busy={making === 'xlsx'}
        busyLabel="Making the Excel file"
        disabled={!ready || making === 'pdf'}
        className="w-full md:w-auto"
      >
        Download Excel
      </Button>
      <Button
        size={size}
        icon={FileDown}
        onClick={() => void download('pdf')}
        busy={making === 'pdf'}
        busyLabel="Making the PDF"
        disabled={!ready || making === 'xlsx'}
        className="w-full md:w-auto"
      >
        Download PDF
      </Button>
    </>
  )

  if (look === 'inline') {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="statement-downloads">
        <p className="min-w-0 flex-1 basis-[14rem] text-sm text-fg-muted">Comparative statement of every supplier reply</p>
        <div className={PAIR}>{buttons}</div>
      </div>
    )
  }
  return (
    <section aria-labelledby={headingId} className="min-w-0" data-testid="statement-downloads">
      {/* The look of a DetailPanel header (title, muted line, actions on the right), but the pair may take the full width: on a phone
          and at 200% zoom two buttons side by side do not fit, so they stack (DetailPanel's actions never shrink or wrap). */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b py-2">
        <div className="min-w-0 flex-1 basis-[16rem]">
          <h2 id={headingId} className="type-section">
            Comparative statement
          </h2>
          <p className="mt-[2px] text-base text-fg-muted">Every supplier price for each item, side by side, as an Excel file or a PDF.</p>
        </div>
        <div className={PAIR}>{buttons}</div>
      </header>
    </section>
  )
}

/** The two buttons: stacked full width on a narrow screen (a phone, or 200% zoom), side by side from 30rem, at their own width from md. */
const PAIR = 'grid w-full min-w-0 grid-cols-1 gap-2 min-[30rem]:grid-cols-2 md:flex md:w-auto md:shrink-0'
