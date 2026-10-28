import { useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { mapPgError } from '@/lib/pgErrors'
import { orderRef, rfqRef } from '@/lib/refs'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Field } from '@/ui/form/Field'
import { DateInput } from '@/ui/form/DateInput'
import { Select } from '@/ui/form/Select'
import { TextField } from '@/ui/form/TextField'
import { useToast } from '@/ui/useToast'
import type { RfqHeader } from '@/features/rfqs/api'
import { useUpdateRfqHeader } from '@/features/rfqs/hooks'
import { useOrdersForRfq } from '@/features/orders/forRfq'
import { CompanyPicker, type IntakeCompany } from '@/features/rfqs/CompanyPicker'
import { useCompanyContacts, useCompanySites } from '@/features/companies/hooks'
import { useEntryAccess } from '@/features/records/useEntryAccess'

/*
 * Fix an RFQ's header (W9): customer, site, contact, customer ref, received date. Nothing is required that was not already there.
 * Whose entry it is (0092): sales and engineers change their own, an admin anything; for anyone else every field is disabled and the
 * dialog says "Entered by X: only they or an admin can change this", instead of letting the save fail. Changing the customer
 * clears the site and contact (they belong to the old customer), and says so.
 */
export function EditRfqDialog({ rfq, onClose }: { rfq: RfqHeader; onClose: () => void }) {
  const { toast } = useToast()
  const save = useUpdateRfqHeader(rfq.id)
  const access = useEntryAccess({ createdBy: rfq.createdBy ?? null, ownerId: rfq.owner?.id ?? null })
  const sending = useRef(false)
  const [company, setCompany] = useState<{ id: string; name: string }>({ id: rfq.company.id, name: rfq.company.name })
  const [changingCompany, setChangingCompany] = useState(false)
  const [siteId, setSiteId] = useState<string | null>(rfq.siteId ?? null)
  const [contactId, setContactId] = useState<string | null>(rfq.contactId)
  const [customerRef, setCustomerRef] = useState(rfq.customerRef ?? '')
  const [receivedOn, setReceivedOn] = useState(rfq.receivedOn)
  const [error, setError] = useState<string | null>(null)
  const sites = useCompanySites(company.id)
  const contacts = useCompanyContacts(company.id)
  const locked = !access.can
  // An order keeps the customer it was made for (its invoices and receivables name it): once the RFQ has one, the customer stays.
  const orders = useOrdersForRfq(rfq.id)
  const orderList = orders.data ?? []
  const customerLocked = orders.isPending || orderList.length > 0
  const companyChanged = company.id !== rfq.company.id
  const dirty =
    companyChanged || siteId !== (rfq.siteId ?? null) || contactId !== rfq.contactId || customerRef.trim() !== (rfq.customerRef ?? '') || receivedOn !== rfq.receivedOn

  const pick = (c: IntakeCompany) => {
    setCompany({ id: c.id, name: c.name })
    setSiteId(null)
    setContactId(null)
    setChangingCompany(false)
  }

  const submit = async () => {
    if (locked || sending.current) return
    if (!receivedOn) {
      setError('Choose the date the RFQ was received.')
      return
    }
    sending.current = true
    setError(null)
    try {
      await save.mutateAsync({ companyId: company.id, siteId, contactId, customerRef: customerRef || null, receivedOn })
      toast({ title: 'RFQ updated', body: `${rfqRef(rfq.number)} · ${company.name}`, tone: 'success' })
      onClose()
    } catch (err) {
      setError(mapPgError(err, { entity: 'RFQ' }).message)
    } finally {
      sending.current = false
    }
  }

  return (
    <Dialog open busy={save.isPending} dirty={dirty && !locked} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent
        title="Edit RFQ details"
        context={`${rfqRef(rfq.number)} · ${rfq.company.name}`}
        icon={Pencil}
        footer={
          <>
            <Button data-cancel onClick={onClose} disabled={save.isPending}>
              {locked ? 'Close' : 'Cancel'}
            </Button>
            {locked ? null : (
              <Button variant="primary" busy={save.isPending} busyLabel="Saving" disabled={!dirty} onClick={() => void submit()}>
                Save changes
              </Button>
            )}
          </>
        }
      >
        <form
          className="grid gap-4"
          onSubmit={e => {
            e.preventDefault()
            void submit()
          }}
        >
          {locked && access.note ? (
            <p role="status" className="text-base font-medium text-fg-2" data-slot="not-yours">
              {access.note}
            </p>
          ) : null}
          {changingCompany ? (
            <CompanyPicker onPick={pick} loadingName={false} />
          ) : (
            <Field label="Customer">
              <div className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1 text-base font-medium [overflow-wrap:anywhere]">{company.name}</span>
                <Button type="button" disabled={locked || customerLocked} onClick={() => setChangingCompany(true)}>
                  Change customer
                </Button>
              </div>
            </Field>
          )}
          {orderList.length > 0 ? (
            <p role="status" className="text-base text-fg-2" data-slot="customer-locked">
              The customer cannot be changed: this RFQ has order {orderList.map(o => orderRef(o.number)).join(', ')}, and the order, its invoices and payments belong to {rfq.company.name}.
            </p>
          ) : null}
          {companyChanged ? <p className="text-base text-fg-2">The site and contact were cleared: they belong to the old customer. Choose again below.</p> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Site" requirement="optional">
              <Select
                value={siteId ?? ''}
                disabled={locked}
                onChange={e => setSiteId(e.target.value || null)}
                placeholder="No site"
                options={(sites.data ?? []).map(s => ({ value: s.id, label: s.name }))}
              />
            </Field>
            <Field label="Contact" requirement="optional">
              <Select
                value={contactId ?? ''}
                disabled={locked}
                onChange={e => setContactId(e.target.value || null)}
                placeholder="No contact"
                options={(contacts.data ?? []).map(c => ({ value: c.id, label: c.name }))}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Customer ref" requirement="optional">
              <TextField value={customerRef} disabled={locked} onChange={e => setCustomerRef(e.target.value)} autoComplete="off" />
            </Field>
            <Field label="Received on">
              <DateInput value={receivedOn} disabled={locked} onChange={setReceivedOn} defaultToday={false} />
            </Field>
          </div>
          {error ? (
            <p role="alert" className="text-base font-medium text-tone-danger-fg">
              {error}
            </p>
          ) : null}
          <button type="submit" className="sr-only" tabIndex={-1}>
            Submit
          </button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
