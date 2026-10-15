import { passwordSchema, type PasswordValues } from '@/features/settings/passwordModel'
import { useChangePassword } from '@/features/settings/hooks'
import { Button } from '@/ui/Button'
import { useToast } from '@/ui/useToast'
import { Form, FormField } from '@/ui/form/Form'
import { TextField } from '@/ui/form/TextField'
import { useSubmitForm } from '@/ui/form/useSubmitForm'

const LABELS: Partial<Record<keyof PasswordValues, string>> = {
  current: 'Current password',
  next: 'New password',
  confirm: 'Confirm new password',
}
const EMPTY: PasswordValues = { current: '', next: '', confirm: '' }

/**
 * Change password: any signed-in person, for their own account. Re-checks the current password, then
 * sets the new one. The session stays signed in. Nothing here shows, stores or logs a password.
 */
export function ChangePasswordPage() {
  const { toast } = useToast()
  const change = useChangePassword()
  const sf = useSubmitForm({
    schema: passwordSchema,
    entity: 'password',
    defaultValues: EMPTY,
    onSubmit: v => change.mutateAsync({ current: v.current, next: v.next }),
    routeError: e => (e.code === 'wrong_current' ? { field: 'current', message: e.message } : e.code === 'weak_new' ? { field: 'next', message: e.message } : undefined),
    onSuccess: () => {
      sf.form.reset(EMPTY)
      toast({ title: 'Password changed', body: 'You are still signed in. Use the new password next time.', tone: 'success' })
    },
  })

  return (
    <div className="grid max-w-list content-start gap-4">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Change password</h1>
        <p className="max-w-prose text-sm text-fg-muted">Change the password for your own sign-in. You stay signed in on this device.</p>
      </header>
      <section className="grid gap-4 rounded border bg-surface p-5 sm:max-w-[480px]">
        <Form sf={sf} labels={LABELS} className="grid gap-4">
          <FormField name="current" label="Current password">
            {f => <TextField {...f} type="password" autoComplete="current-password" />}
          </FormField>
          <FormField name="next" label="New password" help="At least 12 characters.">
            {f => <TextField {...f} type="password" autoComplete="new-password" />}
          </FormField>
          <FormField name="confirm" label="Confirm new password">
            {f => <TextField {...f} type="password" autoComplete="new-password" />}
          </FormField>
        </Form>
        <div className="flex justify-end">
          <Button variant="primary" type="submit" form={sf.formId} busy={sf.pending} busyLabel="Changing">
            {sf.failed ? 'Try again' : 'Change password'}
          </Button>
        </div>
      </section>
    </div>
  )
}
