import { Suspense, useState } from 'react'
import { ExternalLink, FilePlus2, Share2 } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatDay } from '@/lib/formatDay'
import { formatPaisa, toPaisa } from '@/lib/money'
import { mapPgError } from '@/lib/pgErrors'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { DetailPanel } from '@/features/rfqs/DetailPanel'
import { Skeleton } from '@/ui/Skeleton'
import { StatusBadge } from '@/ui/StatusBadge'
import { Tag } from '@/ui/Tag'
import { useToast } from '@/ui/useToast'
import { useSeesPrices } from '@/app/session'
import type { InquiryRow, RfqHeader } from '@/features/rfqs/api'
import { useCompanyProfile } from '@/features/settings/hooks'
import { SettingsLink } from '@/features/quotations/SettingsLink'
import { downloadStoredPdf, loadPdfData, type QuotationRow } from '@/features/quotations/api'
import { useQuotations, useStorePdf } from '@/features/quotations/hooks'
import { useIssueDialog } from '@/features/quotations/useIssueDialog'
import { InfoTip } from '@/ui/InfoTip'
import { lazyWithReload } from '@/lib/importWithReload'
import { generateQuotationPdf } from '@/features/quotations/pdf/generate'
import { profileGaps } from '@/features/quotations/lib/profileGaps'
import { quotationRef, isExpired } from '@/features/quotations/lib/refs'
import { sharePdf, downloadBlob } from '@/features/quotations/lib/sharePdf'

// The Issue quotation dialog is downloaded when it is opened, not with the RFQ page (perf/lcp).
const IssueQuotationDialog = lazyWithReload(() => import('@/features/quotations/IssueQuotationDialog').then(m => ({ default: m.IssueQuotationDialog })))

/*
 * The RFQ page's Quotations block (R19; the slot data-slot="quotations"). Every version with its validity and state, the PDF of
 * each (open, share), and "Revise quotation" once one is out. The dialog is open while the address carries ?issue=1, so the
 * header's Issue quotation (another component) and this block's own button open the same dialog without sharing state.
 * On screen a version is the number and "Revision 2" (plain words, 2026-10-19); the PDF and its file name keep "QT-26-0042 R2".
 * Mark won is not repeated here: it is the page's one green button once a quotation is out.
 * State per version (consistency spec 1.5): the current one has no mark (the normal state); an older one says "Replaced by
 * revision N" in plain words; an expired current one shows the registry's `bid:expired` chip.
 * An engineer (owner decision 2026-10-22: no prices) sees each version, its dates and state only: no items count (it comes from
 * the priced lines, which are not fetched), no gross or net, no PDF (it is all prices) and no Revise quotation.
 */

const gross = (q: QuotationRow) => toPaisa(q.netTotal) + toPaisa(q.gstTotal)

export function QuotationsPanel({ rfq, inquiries, itemCount }: { rfq: RfqHeader; inquiries: InquiryRow[]; itemCount: number }) {
  const { toast } = useToast()
  const prices = useSeesPrices()
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

  const GRID = prices
    ? 'sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_72px_minmax(0,1.1fr)_minmax(0,1.4fr)]'
    : 'sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]'
  return (
    <DetailPanel
      title="Quotations"
      tip={rows.length > 0 ? <InfoTip label="What revising does">Revising makes a new version under the same number. Earlier versions and their PDFs never change.</InfoTip> : null}
      dataSlot="quotations"
      actions={
        prices && isOpen && rows.length > 0 ? (
          <Button icon={FilePlus2} onClick={() => setOpen(true)}>
            Revise quotation
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
        <p className="px-5 py-5 text-fg-muted">
          {prices
            ? 'Nothing issued yet. Issue quotation sets your price on each item, from a supplier price or one you type, and makes the PDF.'
            : 'Nothing issued yet. Sales issue the quotation.'}
        </p>
      ) : (
        <>
          {prices && lacksPdf && gaps.length > 0 ? (
            <div className="px-5 pt-4">
              <Banner tone="warning" title={`A PDF needs the company's ${gaps.join(' and ')}`}>
                Quotations are saved without one. Their PDFs are made when you open them after the profile is complete. <SettingsLink />
              </Banner>
            </div>
          ) : null}
          <div role="table" aria-label="Issued quotations" className="text-sm">
            <div role="row" className={`hidden gap-4 px-5 py-2 text-sm text-fg-muted sm:grid ${GRID}`}>
              <span role="columnheader">Quotation</span>
              <span role="columnheader">Issued</span>
              <span role="columnheader">Valid until</span>
              {prices ? (
                <>
                  <span role="columnheader">Items</span>
                  <span role="columnheader" className="text-right">
                    Gross, PKR
                  </span>
                  <span role="columnheader" className="sr-only">
                    Actions
                  </span>
                </>
              ) : null}
            </div>
            <div role="rowgroup">
              {rows.map((q, i) => {
                const latest = i === 0
                const expired = latest && isExpired(q.validUntil, today) && isOpen
                const base = quotationRef(q.number, first)
                const gp = gross(q)
                return (
                  <div
                    key={q.id}
                    role="row"
                    data-testid={`quotation-${q.revision}`}
                    aria-label={q.revision > 0 ? `${base}, revision ${q.revision}` : base}
                    className={`grid items-center gap-x-4 gap-y-2 border-t px-5 py-3 ${GRID}`}
                  >
                    <span role="cell" className="flex flex-wrap items-center gap-2">
                      <Tag>{base}</Tag>
                      {q.revision > 0 ? <span className="text-sm text-fg-2">Revision {q.revision}</span> : null}
                      {expired ? (
                        <StatusBadge dimension="bid" value="expired" />
                      ) : latest ? null : (
                        <span className="text-sm text-fg-muted" data-replaced>{`Replaced by revision ${rows[i - 1].revision}`}</span>
                      )}
                    </span>
                    <span role="cell" className="num text-sm">
                      <span className="text-sm text-fg-muted sm:sr-only">Issued </span>
                      {formatDay(q.issuedOn)}
                    </span>
                    <span role="cell" className={`num text-sm ${expired ? 'font-medium text-tone-warning-fg' : ''}`}>
                      <span className="text-sm font-regular text-fg-muted sm:sr-only">{expired ? 'Expired ' : 'Valid until '}</span>
                      {formatDay(q.validUntil)}
                    </span>
                    {prices ? (
                      <>
                        <span role="cell" className="num text-sm">
                          {q.lines.length} of {itemCount}
                          <span className="text-sm text-fg-muted sm:sr-only">{q.lines.length === 1 ? ' item' : ' items'}</span>
                        </span>
                        <span role="cell" className="grid sm:justify-items-end sm:text-right">
                          <span className="num text-sm font-medium">
                            <span className="mr-1 font-sans text-sm font-regular text-fg-muted sm:sr-only">PKR{' '}</span>
                            {formatPaisa(gp, 'auto')}
                          </span>
                          <span className="num text-sm text-fg-muted">net {formatPaisa(toPaisa(q.netTotal), 'auto')}</span>
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
                      </>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
      {open && prices ? (
        <Suspense fallback={null}>
          <IssueQuotationDialog rfq={rfq} inquiries={inquiries} onClose={() => setOpen(false)} />
        </Suspense>
      ) : null}
    </DetailPanel>
  )
}
