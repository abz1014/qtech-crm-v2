import { passwordSchema, type PasswordValues } from '@/features/settings/passwordModel'
import { useChangePassword } from '@/features/settings/hooks'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { CARD } from '@/ui/card'
import { PageHeader } from '@/ui/PageHeader'
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
    <div className="grid content-start gap-card-gap">
      <PageHeader title="Change password" lede="Change the password for your own sign-in. You stay signed in on this device." />
      {/* Mockup 78 #admin-password: one card, the three fields in a reading-width column, the one green button under them. */}
      <Form sf={sf} labels={LABELS} className={cn(CARD, 'grid gap-4 p-card')}>
        <div className="grid gap-4 sm:max-w-md">
          <FormField name="current" label="Current password">
            {f => <TextField {...f} type="password" autoComplete="current-password" />}
          </FormField>
          <FormField name="next" label="New password" help="At least 12 characters.">
            {f => <TextField {...f} type="password" autoComplete="new-password" />}
          </FormField>
          <FormField name="confirm" label="Confirm new password">
            {f => <TextField {...f} type="password" autoComplete="new-password" />}
          </FormField>
        </div>
        <div className="flex border-t pt-4">
          <Button variant="primary" type="submit" busy={sf.pending} busyLabel="Changing">
            {sf.failed ? 'Try again' : 'Change password'}
          </Button>
        </div>
      </Form>
    </div>
  )
}
