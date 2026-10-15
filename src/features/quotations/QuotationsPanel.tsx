import { useState } from 'react'
import { Circle, CircleCheck, Clock, ExternalLink, FilePlus2, Share2 } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatDay } from '@/lib/formatDay'
import { formatPaisa, toPaisa } from '@/lib/money'
import { mapPgError } from '@/lib/pgErrors'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { DetailPanel } from '@/features/rfqs/DetailPanel'
import { Skeleton } from '@/ui/Skeleton'
import { Tag } from '@/ui/Tag'
import { useToast } from '@/ui/useToast'
import type { InquiryRow, RfqHeader } from '@/features/rfqs/api'
import { useCompanyProfile } from '@/features/settings/hooks'
import { SettingsLink } from '@/features/quotations/SettingsLink'
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
  const glyph = { current: CircleCheck, superseded: Circle, expired: Clock }[kind]
  return (
    <span className={`inline-flex h-5 items-center gap-[5px] rounded border pl-[6px] pr-2 text-xs font-medium ${look}`}>
      <Icon icon={glyph} size="chip" />
      {text}
    </span>
  )
}

/** The header's Issue quotation: always that label (the revision is in the panel's own button and in the dialog), and off until some item has a price (C-12). */
export function IssueQuotationButton({ rfqId, className, disabled }: { rfqId: string; className?: string; disabled?: boolean }) {
  const quotations = useQuotations(rfqId)
  const [, setOpen] = useIssueDialog()
  return (
    <Button icon={FilePlus2} className={className} onClick={() => setOpen(true)} disabled={quotations.isPending || disabled}>
      Issue quotation
    </Button>
  )
}

export function QuotationsPanel({ rfq, inquiries, itemCount }: { rfq: RfqHeader; inquiries: InquiryRow[]; itemCount: number }) {
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

  const GRID = 'sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_72px_minmax(0,1.1fr)_minmax(0,1.4fr)]'
  return (
    <DetailPanel
      title="Quotations"
      dataSlot="quotations"
      meta={rows.length > 0 ? 'Re-issuing makes a new revision under the same number. Earlier revisions and their PDFs never change.' : undefined}
      actions={
        isOpen && rows.length > 0 ? (
          <Button icon={FilePlus2} onClick={() => setOpen(true)}>
            Issue R{rows[0].revision + 1}
          </Button>
        ) : undefined
      }
    >
      {quotations.isPending ? (
        <div className="p-5">
          <Skeleton className="h-16 w-full" />
        </div>
      ) : quotations.isError ? (
        <div className="p-5">
          <Banner tone="danger" title="Couldn't load the quotations" action={<Button onClick={() => void quotations.refetch()}>Try again</Button>}>
            Nothing was changed.
          </Banner>
        </div>
      ) : rows.length === 0 ? (
        <p className="px-5 py-5 text-sm text-fg-muted">Nothing issued. Once supplier prices are in, set your price on each item and issue the first quotation.</p>
      ) : (
        <>
          {lacksPdf && gaps.length > 0 ? (
            <div className="px-5 pt-4">
              <Banner tone="warning" title={`A PDF needs the company's ${gaps.join(' and ')}`}>
                Quotations are saved without one. Their PDFs are made when you open them after the profile is complete. <SettingsLink />
              </Banner>
            </div>
          ) : null}
          <div role="table" aria-label="Issued quotations" className="text-sm">
            <div role="row" className={`hidden gap-4 px-5 py-2 text-xs text-fg-muted sm:grid ${GRID}`}>
              <span role="columnheader">Quotation</span>
              <span role="columnheader">Issued</span>
              <span role="columnheader">Valid until</span>
              <span role="columnheader">Items</span>
              <span role="columnheader" className="text-right">
                Gross, PKR
              </span>
              <span role="columnheader" className="sr-only">
                Actions
              </span>
            </div>
            <div role="rowgroup">
              {rows.map((q, i) => {
                const latest = i === 0
                const expired = latest && isExpired(q.validUntil, today) && isOpen
                const ref = quotationRef(q.number, first, q.revision)
                const gp = gross(q)
                return (
                  <div key={q.id} role="row" data-testid={`quotation-${q.revision}`} aria-label={ref} className={`grid items-center gap-x-4 gap-y-2 border-t px-5 py-3 ${GRID}`}>
                    <span role="cell" className="flex flex-wrap items-center gap-2">
                      <Tag>{ref}</Tag>
                      <StateChip kind={expired ? 'expired' : latest ? 'current' : 'superseded'} />
                    </span>
                    <span role="cell" className="num text-sm">
                      <span className="text-xs text-fg-muted sm:sr-only">Issued </span>
                      {formatDay(q.issuedOn)}
                    </span>
                    <span role="cell" className={`num text-sm ${expired ? 'font-medium text-tone-warning-fg' : ''}`}>
                      <span className="text-xs font-regular text-fg-muted sm:sr-only">{expired ? 'Expired ' : 'Valid until '}</span>
                      {formatDay(q.validUntil)}
                    </span>
                    <span role="cell" className="num text-sm">
                      {q.lines.length} of {itemCount}
                      <span className="text-xs text-fg-muted sm:sr-only">{q.lines.length === 1 ? ' item' : ' items'}</span>
                    </span>
                    <span role="cell" className="grid sm:justify-items-end sm:text-right">
                      <span className="num text-sm font-medium">
                        <span className="mr-1 font-sans text-xs font-regular text-fg-muted sm:sr-only">PKR{' '}</span>
                        {formatPaisa(gp, 'auto')}
                      </span>
                      <span className="num text-xs text-fg-muted">net {formatPaisa(toPaisa(q.netTotal), 'auto')}</span>
                    </span>
                    <span role="cell" className="flex flex-wrap items-center gap-2 sm:justify-end">
                      <Button
                        size="sm"
                        variant={latest ? 'secondary' : 'quiet'}
                        icon={ExternalLink}
                        busy={working === `open-${q.id}`}
                        busyLabel="Opening"
                        disabled={!q.pdfPath && gaps.length > 0}
                        onClick={() => void run(q, 'open')}
                      >
                        Open PDF
                      </Button>
                      {latest ? (
                        <Button size="sm" icon={Share2} busy={working === `share-${q.id}`} busyLabel="Sharing" disabled={!q.pdfPath && gaps.length > 0} onClick={() => void run(q, 'share')}>
                          Share
                        </Button>
                      ) : null}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
      {open ? <IssueQuotationDialog rfq={rfq} inquiries={inquiries} onClose={() => setOpen(false)} /> : null}
    </DetailPanel>
  )
}
