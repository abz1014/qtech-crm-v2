import { useState } from 'react'
import { Printer } from 'lucide-react'
import { useSession } from '@/app/session'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { useToast } from '@/ui/useToast'
import { downloadBlob } from '@/features/quotations/lib/sharePdf'
import { useCompanyProfile } from '@/features/settings/hooks'
import { importWithReload } from '@/lib/importWithReload'
import { loadCreditNotePdfSource } from '@/features/money/invoices/pdf/api'
import { buildCreditNoteDoc, creditNoteFileName } from '@/features/money/invoices/pdf/creditNoteDoc'

/*
 * "Print" on a credit note (0112): reads the credit note, its invoice, order and buyer, builds the document (creditNoteDoc.ts), makes
 * the PDF in the browser (its own lazy chunk, like the invoice) and opens it in a new tab, else downloads it. Admin and sales only.
 */
export function CreditNotePdfButton({ creditNoteId }: { creditNoteId: string }) {
  const session = useSession()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const profileQ = useCompanyProfile()
  const role = session.status === 'signed-in' ? session.user.role : null
  if (role !== 'admin' && role !== 'sales') return null

  const run = async () => {
    if (busy) return
    const profile = profileQ.data
    if (!profile) {
      toast({ title: 'The company details are still loading', body: 'Try again in a moment.' })
      return
    }
    setBusy(true)
    const tab = window.open('', '_blank')
    try {
      const src = await loadCreditNotePdfSource(creditNoteId)
      if (!src) throw new Error('missing')
      const built = buildCreditNoteDoc(src, profile)
      if (!built.ok) {
        tab?.close()
        toast({ title: 'The credit note PDF is not ready', body: built.gaps.join(' '), tone: 'danger' })
        return
      }
      const { renderCreditNotePdf } = await importWithReload(() => import('@/features/money/invoices/pdf/renderCreditNote'))
      const blob = await renderCreditNotePdf(built.doc, profile)
      const url = URL.createObjectURL(blob)
      if (tab) tab.location.href = url
      else downloadBlob(blob, creditNoteFileName(built.doc.number))
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      tab?.close()
      toast({ title: 'Could not make the PDF', body: mapPgError(err, { entity: 'PDF' }).message, tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button size="sm" icon={Printer} onClick={() => void run()} busy={busy} busyLabel="Making PDF" aria-label="Print credit note">
      Print
    </Button>
  )
}
