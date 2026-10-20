import { useRef, type ReactNode } from 'react'
import { CircleDot } from 'lucide-react'
import { z } from 'zod'
import { useSession } from '@/app/session'
import { useMyDetails, useSetPhone } from '@/features/settings/hooks'
import type { MyDetails } from '@/features/settings/api'
import { PHONE_MAX } from '@/features/settings/teamModel'
import { Button } from '@/ui/Button'
import { PageHeader } from '@/ui/PageHeader'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { ShortcutsPanel, TextSizePanel } from '@/ui/TextSizeControl'
import { useToast } from '@/ui/useToast'
import { Field } from '@/ui/form/Field'
import { Form, FormField } from '@/ui/form/Form'
import { TextField } from '@/ui/form/TextField'
import { useSubmitForm } from '@/ui/form/useSubmitForm'

const schema = z.object({ phone: z.string().trim().max(PHONE_MAX, `Keep the phone number under ${PHONE_MAX} characters.`) })

/**
 * Your details: the signed-in person's own row, for every role. Name, email and job title are set by
 * an admin (read only here); the phone number is the one thing a person edits themselves. It is
 * printed under the signature on chase texts and quotations. Saves straight to users.phone.
 */
export function MyDetailsPage() {
  const session = useSession()
  const id = session.status === 'signed-in' ? session.user.id : ''
  const q = useMyDetails(id)

  return (
    <div className="grid content-start gap-4">
      <PageHeader
        title="Your details"
        lede="How you appear to customers. Your phone number is printed under your signature on chase texts and quotations."
      />
      {q.isLoading ? (
        <div role="status" className="grid gap-4" aria-busy="true" aria-label="Loading your details">
          <Skeleton className="h-[260px]" />
          <Skeleton className="h-12" />
        </div>
      ) : q.isError || !q.data ? (
        <EmptyState mood="error" title="Could not load your details" actions={<Button onClick={() => void q.refetch()}>Try again</Button>}>
          Nothing has changed. Check your connection, then try again.
        </EmptyState>
      ) : (
        <DetailsForm details={q.data} />
      )}
      <TextSizePanel />
      <ShortcutsPanel />
    </div>
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

function DetailsForm({ details }: { details: MyDetails }) {
  const { toast } = useToast()
  const save = useSetPhone()
  const saved = useRef<string | null>(null)
  const sf = useSubmitForm({
    schema,
    entity: 'details',
    defaultValues: { phone: details.phone ?? '' },
    onSubmit: async v => {
      saved.current = await save.mutateAsync({ userId: details.id, phone: v.phone || null })
    },
    onSuccess: v => {
      sf.form.reset({ phone: saved.current ?? '' })
      toast({ title: v.phone ? 'Phone saved' : 'Phone cleared', tone: 'success' })
    },
  })
  const dirty = Object.keys(sf.form.formState.dirtyFields).length > 0

  return (
    <>
      <Form sf={sf} labels={{ phone: 'Phone' }} className="grid gap-4">
        <Section title="Your details" hint="Your name, email and job title are set by an admin.">
          <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
            <Field label="Name">
              <TextField readOnly value={details.name} />
            </Field>
            <Field label="Email">
              <TextField readOnly value={details.email ?? ''} className="num" />
            </Field>
          </div>
          <Field label="Job title" help="Set by an admin" className="sm:max-w-[320px]">
            <TextField readOnly value={details.job_title ?? ''} placeholder="Not set" />
          </Field>
          <FormField name="phone" label="Phone" requirement="optional" className="sm:max-w-[320px]">
            {f => <TextField {...f} type="tel" className="num" placeholder="0300 1234567" autoComplete="tel" />}
          </FormField>
        </Section>
      </Form>

      <div className="flex flex-wrap items-center gap-3 rounded border bg-surface px-5 py-3">
        {dirty ? <Icon icon={CircleDot} size="sm" className="text-fg-muted" /> : null}
        <p role="status" className="text-sm text-fg-muted">
          {dirty ? '1 unsaved change: Phone' : 'Nothing to save yet'}
        </p>
        <div className="ml-auto flex gap-2">
          <Button disabled={!dirty || sf.pending} onClick={() => sf.form.reset({ phone: details.phone ?? '' })}>
            Discard
          </Button>
          <Button variant="primary" type="submit" form={sf.formId} busy={sf.pending} busyLabel="Saving" disabled={!dirty}>
            {sf.failed ? 'Try again' : 'Save changes'}
          </Button>
        </div>
      </div>
    </>
  )
}
