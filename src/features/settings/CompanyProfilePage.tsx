import { useRef, type ReactElement, type ReactNode } from 'react'
import { CircleDot, Lock, TriangleAlert } from 'lucide-react'
import { useController, useFormContext, type ControllerRenderProps } from 'react-hook-form'
import { useSession } from '@/app/session'
import {
  missingForPdf,
  profileSchema,
  toFormValues,
  type CompanyProfile,
  type ProfileValues,
} from '@/features/settings/companyProfile'
import { useCompanyProfile, useSaveCompanyProfile } from '@/features/settings/hooks'
import { Banner } from '@/ui/Banner'
import { PageHeader } from '@/ui/PageHeader'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/useToast'
import { Form, FormField } from '@/ui/form/Form'
import { NumberInput } from '@/ui/form/NumberInput'
import { Field } from '@/ui/form/Field'
import { TextArea, TextField } from '@/ui/form/TextField'
import { useSubmitForm } from '@/ui/form/useSubmitForm'

const LABELS: Partial<Record<keyof ProfileValues, string>> = {
  legal_name: 'Legal name',
  address: 'Address',
  phone: 'Phone',
  email: 'Email',
  website: 'Website',
  ntn: 'NTN',
  strn: 'STRN',
  bank_name: 'Bank',
  bank_account_title: 'Account title',
  bank_iban: 'IBAN',
  quotation_validity_days: 'Quotation validity',
  default_payment_terms_days: 'Default payment terms',
  quotation_terms: 'Quotation terms',
  po_terms: 'Purchase order terms',
}

/**
 * Company profile (A06). One record: Q-Tech's letterhead and standard wording. Every staff role
 * reads it; only an admin edits it. Nothing is required: a missing legal name or address blocks
 * issuing a PDF (and the banner says so) but never blocks saving.
 */
export function CompanyProfilePage() {
  const session = useSession()
  const isAdmin = session.status === 'signed-in' && session.user.role === 'admin'
  const q = useCompanyProfile()

  return (
    <div className="grid content-start gap-4">
      <PageHeader
        title="Company profile"
        lede={
          isAdmin
            ? 'Your registered details and standard wording. Only admins can change them.'
            : 'Your registered details and standard wording, as printed on quotations and purchase orders.'
        }
        secondary={
          !isAdmin ? (
            <span className="inline-flex h-6 items-center gap-[6px] rounded bg-selected px-[6px] text-sm font-medium text-fg-2">
              <Icon icon={Lock} size="sm" />
              Only an admin can edit
            </span>
          ) : undefined
        }
      />

      {q.isLoading ? (
        <div role="status" className="grid gap-4" aria-busy="true" aria-label="Loading the company profile">
          <Skeleton className="h-10" />
          <Skeleton className="h-[240px]" />
          <Skeleton className="h-[160px]" />
        </div>
      ) : q.isError || !q.data ? (
        <EmptyState
          mood="error"
          title="Could not load the company profile"
          actions={<Button onClick={() => void q.refetch()}>Try again</Button>}
        >
          Nothing has changed. Check your connection, then try again.
        </EmptyState>
      ) : isAdmin ? (
        <ProfileForm profile={q.data} />
      ) : (
        <ProfileReadOnly profile={q.data} />
      )}
    </div>
  )
}

function MissingBanner({ missing, onAdd }: { missing: string[]; onAdd?: () => void }) {
  if (missing.length === 0) return null
  return (
    <Banner
      tone="warning"
      title="PDFs can't be issued until legal name and address are set"
      action={
        onAdd ? (
          <Button size="sm" onClick={onAdd}>
            Add them
          </Button>
        ) : undefined
      }
    >
      {onAdd
        ? 'Quotations and purchase orders print these at the top. Everything else can wait.'
        : 'Ask an admin to add them in Settings.'}
    </Banner>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 rounded border bg-surface p-5">
      <div className="grid gap-[2px]">
        <h2 className="text-base font-semibold">{title}</h2>
        {hint ? <p className="max-w-[62ch] text-sm text-fg-muted text-pretty">{hint}</p> : null}
      </div>
      {children}
    </section>
  )
}

const NEEDED = <span className="ml-2 text-xs font-regular text-fg-muted">Needed for PDFs</span>

/**
 * The two fields a PDF cannot be issued without. While one is empty it is drawn invalid with its own
 * sentence (the mockup's "Admin, not yet complete"), before any submit; saving is still never blocked.
 */
function NeededField({
  name,
  label,
  message,
  children,
}: {
  name: 'legal_name' | 'address'
  label: string
  message: string
  children: (f: ControllerRenderProps<ProfileValues, 'legal_name' | 'address'>) => ReactElement
}) {
  const { control } = useFormContext<ProfileValues>()
  const { field, fieldState } = useController({ control, name })
  const blank = String(field.value ?? '').trim() === ''
  return (
    <Field
      label={
        <>
          {label}
          {NEEDED}
        </>
      }
      error={fieldState.error?.message ?? (blank ? message : undefined)}
      edited={fieldState.isDirty}
    >
      {children(field)}
    </Field>
  )
}

function ProfileForm({ profile }: { profile: CompanyProfile }) {
  const { toast } = useToast()
  const save = useSaveCompanyProfile()
  const saved = useRef<CompanyProfile | null>(null)
  const sf = useSubmitForm({
    schema: profileSchema,
    entity: 'company profile',
    defaultValues: toFormValues(profile),
    onSubmit: async v => {
      saved.current = await save.mutateAsync(v)
    },
    onSuccess: () => {
      const row = saved.current
      if (!row) return
      sf.form.reset(toFormValues(row))
      toast({
        title: 'Company profile saved',
        body: missingForPdf(row).length === 0 ? 'PDFs can be issued now.' : 'Add the legal name and address to issue PDFs.',
        tone: 'success',
      })
    },
  })
  const dirty = Object.keys(sf.form.formState.dirtyFields) as (keyof ProfileValues)[]
  const missing = missingForPdf({ legal_name: sf.form.watch('legal_name'), address: sf.form.watch('address') })

  return (
    <>
      <MissingBanner missing={missing} onAdd={() => sf.form.setFocus(missing[0] ?? 'legal_name')} />
      <Form sf={sf} labels={LABELS} className="grid gap-4">
        <Section title="Business details" hint="Printed in the letterhead of every quotation and purchase order.">
          <NeededField name="legal_name" label="Legal name" message="Add the legal name before issuing a PDF.">
            {f => <TextField {...f} placeholder="As registered with SECP" autoComplete="organization" />}
          </NeededField>
          <NeededField name="address" label="Address" message="Add the address before issuing a PDF.">
            {f => <TextArea {...f} rows={2} autoComplete="street-address" />}
          </NeededField>
          <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
            <FormField name="phone" label="Phone" requirement="optional">
              {f => <TextField {...f} type="tel" className="num" autoComplete="tel" />}
            </FormField>
            <FormField name="email" label="Email" requirement="optional">
              {f => <TextField {...f} type="email" autoComplete="email" />}
            </FormField>
            <FormField name="website" label="Website" requirement="optional">
              {f => <TextField {...f} autoComplete="url" />}
            </FormField>
          </div>
        </Section>

        <Section title="Tax registration" hint="Printed on quotations and purchase orders.">
          <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
            <FormField name="ntn" label="NTN" requirement="optional">
              {f => <TextField {...f} className="num" autoComplete="off" />}
            </FormField>
            <FormField name="strn" label="STRN" requirement="optional">
              {f => <TextField {...f} className="num" autoComplete="off" />}
            </FormField>
          </div>
        </Section>

        <Section title="Bank details" hint="Printed on quotations only when filled in. Leave them blank to print nothing.">
          <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
            <FormField name="bank_name" label="Bank" requirement="optional">
              {f => <TextField {...f} autoComplete="off" />}
            </FormField>
            <FormField name="bank_account_title" label="Account title" requirement="optional">
              {f => <TextField {...f} autoComplete="off" />}
            </FormField>
          </div>
          <FormField name="bank_iban" label="IBAN" requirement="optional" className="sm:max-w-[320px]">
            {f => <TextField {...f} className="num" autoComplete="off" />}
          </FormField>
        </Section>

        <Section
          title="Payment terms"
          hint="Used for any order that has no terms of its own, so the payment-overdue reminder always has a due date."
        >
          <FormField
            name="default_payment_terms_days"
            label="Default payment terms"
            help="Days after the invoice date. An order with its own terms keeps them."
            className="sm:max-w-[200px]"
          >
            {f => <NumberInput {...f} suffix="days" min={0} decimals={0} />}
          </FormField>
        </Section>

        <Section
          title="Quotations and purchase orders"
          hint="Standard wording that is added to every document. You can still edit it on each document before issuing."
        >
          <FormField
            name="quotation_validity_days"
            label="Quotation validity"
            help="A new quotation is valid for this many days from its date."
            className="sm:max-w-[200px]"
          >
            {f => <NumberInput {...f} suffix="days" min={1} decimals={0} />}
          </FormField>
          <FormField name="quotation_terms" label="Quotation terms" requirement="optional">
            {f => <TextArea {...f} rows={5} />}
          </FormField>
          <FormField name="po_terms" label="Purchase order terms" requirement="optional">
            {f => <TextArea {...f} rows={4} />}
          </FormField>
        </Section>
      </Form>

      <div className="flex flex-wrap items-center gap-3 rounded border bg-surface px-5 py-3">
        {dirty.length > 0 ? <Icon icon={CircleDot} size="sm" className="text-fg-muted" /> : null}
        <p role="status" className="text-sm text-fg-muted">
          {dirty.length === 0
            ? 'Nothing to save yet'
            : `${dirty.length} unsaved ${dirty.length === 1 ? 'change' : 'changes'}: ${dirty.map(k => LABELS[k]).join(', ')}`}
        </p>
        <div className="ml-auto flex gap-2">
          <Button disabled={dirty.length === 0 || sf.pending} onClick={() => sf.form.reset(toFormValues(profile))}>
            Discard
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={sf.formId}
            busy={sf.pending}
            busyLabel="Saving"
            disabled={dirty.length === 0}
          >
            {sf.failed ? 'Try again' : 'Save changes'}
          </Button>
        </div>
      </div>
    </>
  )
}

function Row({ label, value, mono }: { label: string; value: string | number | null; mono?: boolean }) {
  const empty = value === null || value === ''
  return (
    <>
      <dt className="text-fg-muted">{label}</dt>
      {empty ? (
        <dd className="inline-flex min-w-0 items-center gap-[6px] font-medium text-tone-warning-fg">
          <Icon icon={TriangleAlert} size="sm" />
          Not set
        </dd>
      ) : (
        <dd className={cn('min-w-0 whitespace-pre-line [overflow-wrap:anywhere]', mono && 'num')}>{value}</dd>
      )}
    </>
  )
}

const KV = 'grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[160px_minmax(0,1fr)]'

function ProfileReadOnly({ profile: p }: { profile: CompanyProfile }) {
  return (
    <>
      <MissingBanner missing={missingForPdf(p)} />
      <Section title="Business details">
        <dl className={KV}>
          <Row label="Legal name" value={p.legal_name} />
          <Row label="Address" value={p.address} />
          <Row label="Phone" value={p.phone} mono />
          <Row label="Email" value={p.email} />
          <Row label="Website" value={p.website} />
        </dl>
      </Section>
      <Section title="Tax registration">
        <dl className={KV}>
          <Row label="NTN" value={p.ntn} mono />
          <Row label="STRN" value={p.strn} mono />
        </dl>
      </Section>
      <Section title="Bank details">
        <dl className={KV}>
          <Row label="Bank" value={p.bank_name} />
          <Row label="Account title" value={p.bank_account_title} />
          <Row label="IBAN" value={p.bank_iban} mono />
        </dl>
      </Section>
      <Section title="Payment terms">
        <dl className={KV}>
          <Row label="Default payment terms" value={`${p.default_payment_terms_days} days`} />
        </dl>
      </Section>
      <Section title="Quotations and purchase orders">
        <dl className={KV}>
          <Row label="Quotation validity" value={`${p.quotation_validity_days} days`} />
          <Row label="Quotation terms" value={p.quotation_terms} />
          <Row label="Purchase order terms" value={p.po_terms} />
        </dl>
      </Section>
    </>
  )
}
