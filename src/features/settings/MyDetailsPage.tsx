import { useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { CircleDot } from 'lucide-react'
import { z } from 'zod'
import { useSession } from '@/app/session'
import { useMyDetails, useSetPhone } from '@/features/settings/hooks'
import type { MyDetails } from '@/features/settings/api'
import { PHONE_MAX } from '@/features/settings/teamModel'
import { phoneText } from '@/lib/formRules'
import { Button } from '@/ui/Button'
import { PageHeader } from '@/ui/PageHeader'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { ShortcutsPanel, TextSizePanel } from '@/ui/TextSizeControl'
import { useToast } from '@/ui/useToast'
import { Form, FormField } from '@/ui/form/Form'
import { TextField } from '@/ui/form/TextField'
import { useSubmitForm } from '@/ui/form/useSubmitForm'

const schema = z.object({ phone: z.string().trim().max(PHONE_MAX, `Keep the phone number under ${PHONE_MAX} characters.`).pipe(phoneText) })

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
    <section className="grid gap-4 border-t pt-4" data-work="">
      <div className="grid gap-[2px]">
        <h2 className="type-section">{title}</h2>
        {hint ? <p className="max-w-[62ch] text-base text-fg-muted text-pretty">{hint}</p> : null}
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
          {/* Label left, value right: the same shape as the Company profile (the section's hint says an admin sets these). */}
          <dl className="grid gap-x-4 gap-y-2 text-base sm:grid-cols-[160px_minmax(0,1fr)]" data-testid="your-facts">
            <dt className="text-fg-muted">Name</dt>
            <dd className="min-w-0 [overflow-wrap:anywhere]">{details.name}</dd>
            <dt className="text-fg-muted">Email</dt>
            <dd className="num min-w-0 [overflow-wrap:anywhere]">{details.email ?? '—'}</dd>
            <dt className="text-fg-muted">Job title</dt>
            <dd className={cn('min-w-0', !details.job_title && 'text-fg-muted')}>{details.job_title || 'Not set'}</dd>
          </dl>
          <FormField name="phone" label="Phone" requirement="optional" className="sm:max-w-[320px]">
            {f => <TextField {...f} type="tel" className="num" placeholder="0300 1234567" autoComplete="tel" />}
          </FormField>
        </Section>
      </Form>

      {/* With unsaved changes the bar sticks above the phone's bottom tabs (the page scrolls inside <main>, which ends where the tabs start). */}
      <div data-sticky-bar="" data-save-bar className={cn('flex flex-wrap items-center gap-3 border-t py-3', dirty && 'sticky bottom-0 z-10 bg-surface')}>
        {dirty ? <Icon icon={CircleDot} size="sm" className="text-fg-muted" /> : null}
        <p role="status" className="text-base text-fg-muted">
          {dirty ? '1 unsaved change: Phone' : 'Nothing to save yet'}
        </p>
        <div className="ml-auto flex gap-2">
          <Button disabled={!dirty || sf.pending} className="disabled:bg-sunken disabled:text-fg-disabled" onClick={() => sf.form.reset({ phone: details.phone ?? '' })}>
            Discard
          </Button>
          {/* nothing changed: Save is disabled, so it is plain that there is nothing to save */}
          <Button variant="primary" type="submit" form={sf.formId} busy={sf.pending} busyLabel="Saving" disabled={!dirty} className="disabled:bg-sunken disabled:text-fg-disabled">
            {sf.failed ? 'Try again' : 'Save changes'}
          </Button>
        </div>
      </div>
    </>
  )
}
