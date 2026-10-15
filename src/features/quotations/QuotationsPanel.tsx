import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, FilePlus2, FileText, Share2 } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatDay } from '@/lib/formatDay'
import { formatPaisa, toPaisa } from '@/lib/money'
import { mapPgError } from '@/lib/pgErrors'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { Tag } from '@/ui/Tag'
import { useToast } from '@/ui/useToast'
import type { InquiryRow, RfqHeader } from '@/features/rfqs/api'
import { useCompanyProfile } from '@/features/settings/hooks'
import { downloadStoredPdf, loadPdfData, type QuotationRow } from '@/features/quotations/api'
import { useQuotations, useStorePdf } from '@/features/quotations/hooks'
import { useIssueDialog } from '@/features/quotations/useIssueDialog'
import { IssueQuotationDialog } from '@/features/quotations/IssueQuotationDialog'
import { generateQuotationPdf } from '@/features/quotations/pdf/generate'
import { profileGaps } from '@/features/quotations/lib/profileGaps'
import { quotationRef, isExpired } from '@/features/quotations/lib/refs'
import { sharePdf, downloadBlob } from '@/features/quotations/lib/sharePdf'

/*
 * The RFQ page's Quotations block (R19; the slot data-slot="quotations"). Every revision with its validity and state, the
 * PDF of each (open, share), and the Issue action. The dialog is open while the address carries ?issue=1, so the header's
 * Issue button (another component) and this block's own button open the same dialog without sharing state.
 */

const gross = (q: QuotationRow) => toPaisa(q.netTotal) + toPaisa(q.gstTotal)

function StateChip({ kind }: { kind: 'current' | 'superseded' | 'expired' }) {
  const look = {
    current: 'border-tone-success-fg/25 bg-tone-success-bg text-tone-success-fg',
    superseded: 'border-line-strong bg-surface text-fg-muted',
    expired: 'border-tone-warning-fg/25 bg-tone-warning-bg text-tone-warning-fg',
  }[kind]
  const text = { current: 'Current', superseded: 'Superseded', expired: 'Expired' }[kind]
  return <span className={`inline-flex h-5 items-center rounded border px-2 text-xs font-medium ${look}`}>{text}</span>
}

export function IssueQuotationButton({ rfqId, className }: { rfqId: string; className?: string }) {
  const quotations = useQuotations(rfqId)
  const [, setOpen] = useIssueDialog()
  const latest = quotations.data?.[0]
  return (
    <Button icon={FilePlus2} className={className} onClick={() => setOpen(true)} disabled={quotations.isPending}>
      {latest ? `Issue R${latest.revision + 1}` : 'Issue quotation'}
    </Button>
  )
}

export function QuotationsPanel({ rfq, inquiries }: { rfq: RfqHeader; inquiries: InquiryRow[] }) {
  const { toast } = useToast()
  const quotations = useQuotations(rfq.id)
  const profileQ = useCompanyProfile()
  const storePdf = useStorePdf(rfq.id)
  const [open, setOpen] = useIssueDialog()
  const [working, setWorking] = useState<string | null>(null)
  const today = businessToday()
  const profile = profileQ.data
  const gaps = profileGaps(profile)
  const rows = quotations.data ?? []
  const first = rows.length > 0 ? rows[rows.length - 1].issuedOn : today
  const isOpen = (rfq.state?.outcome ?? 'open') === 'open'
  const lacksPdf = rows.some(q => !q.pdfPath)

  /** The stored PDF, or (when none was made yet) a new one, stored for next time. Null when the profile is incomplete. */
  const pdfFor = async (q: QuotationRow): Promise<Blob | null> => {
    if (q.pdfPath) return downloadStoredPdf(q.pdfPath)
    if (!profile || profileGaps(profile).length > 0) return null
    const blob = await generateQuotationPdf(await loadPdfData(q.id), profile)
    await storePdf.mutateAsync({ quotation: q, pdf: blob })
    return blob
  }

  const run = async (q: QuotationRow, what: 'open' | 'share') => {
    setWorking(`${what}-${q.id}`)
    // A tab opened inside the tap is not blocked as a pop-up; it is pointed at the PDF once the PDF is in hand.
    const tab = what === 'open' ? window.open('', '_blank') : null
    try {
      const blob = await pdfFor(q)
      if (!blob) {
        tab?.close()
        toast({ title: 'The PDF needs the company profile', body: `Add the ${gaps.join(' and ')} in Settings, Company.`, tone: 'danger' })
        return
      }
      const name = `${quotationRef(q.number, first, q.revision).replace(/ /g, '-')}.pdf`
      if (what === 'open') {
        const url = URL.createObjectURL(blob)
        if (tab) tab.location.href = url
        else downloadBlob(blob, name)
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
      } else {
        const result = await sharePdf(blob, name, `${quotationRef(q.number, first, q.revision)} for ${rfq.company.name}`)
        if (result === 'downloaded') toast({ title: 'PDF downloaded', body: name })
      }
    } catch (err) {
      tab?.close()
      toast({ title: 'Could not get the PDF', body: mapPgError(err, { entity: 'PDF' }).message, tone: 'danger' })
    } finally {
      setWorking(null)
    }
  }

  return (
    <section data-slot="quotations" aria-label="Quotations" className="rounded border bg-surface">
      <div className="flex items-center gap-2 px-4 pt-4 text-sm font-semibold text-fg-2">
        <Icon icon={FileText} className="text-fg-muted" />
        Quotations
        {isOpen && rows.length > 0 ? (
          <Button size="sm" className="ml-auto" icon={FilePlus2} onClick={() => setOpen(true)}>
            Issue R{rows[0].revision + 1}
          </Button>
        ) : null}
      </div>
      <div className="grid gap-3 px-4 pb-4 pt-2">
        {quotations.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : quotations.isError ? (
          <Banner tone="danger" title="Couldn't load the quotations" action={<Button onClick={() => void quotations.refetch()}>Try again</Button>}>
            Nothing was changed.
          </Banner>
        ) : rows.length === 0 ? (
          <>
            <p className="text-sm text-fg-muted">No quotation has been issued yet. Re-issuing later makes a new revision under the same number.</p>
            {isOpen ? (
              <Button variant="primary" icon={FilePlus2} className="justify-self-start" onClick={() => setOpen(true)}>
                Issue quotation
              </Button>
            ) : null}
          </>
        ) : (
          <>
            {lacksPdf && gaps.length > 0 ? (
              <Banner
                tone="warning"
                title={`A PDF needs the company's ${gaps.join(' and ')}`}
                action={
                  <Link to="/settings/company" className="inline-flex h-control items-center rounded border border-line-strong bg-surface px-3 text-sm font-medium text-fg hover:bg-sunken">
                    Open Settings, Company
                  </Link>
                }
              >
                Quotations are saved without one. Their PDFs are made when you open them after the profile is complete.
              </Banner>
            ) : null}
            <p className="text-xs text-fg-muted">Re-issuing makes a new revision under the same number. Earlier revisions and their PDFs never change.</p>
            <ul className="grid gap-2" aria-label="Issued quotations">
              {rows.map((q, i) => {
                const latest = i === 0
                const expired = latest && isExpired(q.validUntil, today) && isOpen
                const ref = quotationRef(q.number, first, q.revision)
                return (
                  <li key={q.id} className="grid gap-2 rounded border p-3" data-testid={`quotation-${q.revision}`} aria-label={ref}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Tag>{ref}</Tag>
                      <StateChip kind={expired ? 'expired' : latest ? 'current' : 'superseded'} />
                      <span className="num ml-auto text-sm font-medium text-fg">PKR {formatPaisa(gross(q), 'auto')}</span>
                    </div>
                    <p className="text-xs text-fg-muted">
                      Issued {formatDay(q.issuedOn)} · {expired ? 'expired' : 'valid until'} <span className={expired ? 'font-medium text-tone-warning-fg' : ''}>{formatDay(q.validUntil)}</span> · {q.lines.length}{' '}
                      {q.lines.length === 1 ? 'item' : 'items'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" icon={ExternalLink} busy={working === `open-${q.id}`} busyLabel="Opening" disabled={!q.pdfPath && gaps.length > 0} onClick={() => void run(q, 'open')}>
                        Open PDF
                      </Button>
                      <Button size="sm" icon={Share2} busy={working === `share-${q.id}`} busyLabel="Sharing" disabled={!q.pdfPath && gaps.length > 0} onClick={() => void run(q, 'share')}>
                        Share
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
      {open ? <IssueQuotationDialog rfq={rfq} inquiries={inquiries} onClose={() => setOpen(false)} /> : null}
    </section>
  )
}
