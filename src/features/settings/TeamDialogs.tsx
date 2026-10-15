import { useRef, type ReactNode } from 'react'
import { FileText, History, KeyRound, LogOut, Pencil, Phone, Shield, UserCheck, UserPlus, UserX } from 'lucide-react'
import { z } from 'zod'
import type { CreatedUser, Role, TeamMember } from '@/features/settings/api'
import {
  useCreatePerson,
  useDeactivatePerson,
  useReactivatePerson,
  useResetPassword,
  useSetJobTitle,
  useSetPhone,
  useSetRole,
} from '@/features/settings/hooks'
import { firstName, isOnlyActiveAdmin, PHONE_MAX, ROLE_OPTIONS, roleLabel } from '@/features/settings/teamModel'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Icon } from '@/ui/Icon'
import { useToast } from '@/ui/useToast'
import { Form, FormField } from '@/ui/form/Form'
import { RadioCard, RadioGroup } from '@/ui/form/Radio'
import { Select } from '@/ui/form/Select'
import { TextField } from '@/ui/form/TextField'
import { useSubmitForm } from '@/ui/form/useSubmitForm'

/*
 * The Team dialogs. Every one is a useSubmitForm (one press is one request, the form keeps what
 * was typed on a failure, the server's plain-language error lands in the banner) and every call
 * goes through the admin-users function (via hooks.ts, which refreshes the list).
 */
interface Base {
  onClose: () => void
}
const none = z.object({})

// ---------------------------------------------------------------- Add person

const addSchema = z.object({
  name: z.string().trim().min(1, 'Enter the name of the person.').max(100, 'Keep the name under 100 characters.'),
  email: z.string().trim().min(1, 'Enter their email address.').email('Enter a valid email address, like name@company.com.'),
  role: z.enum(['admin', 'sales', 'engineer']),
  job_title: z.string().trim().max(100, 'Keep the job title under 100 characters.').optional(),
})

const JOB_TITLE_HELP = 'The job title prints under the signature on quotations and purchase orders.'

export function AddPersonDialog({
  members,
  onClose,
  onCreated,
}: Base & { members: readonly TeamMember[]; onCreated: (c: CreatedUser) => void }) {
  const create = useCreatePerson()
  const created = useRef<CreatedUser | null>(null)
  const tried = useRef('')
  const sf = useSubmitForm({
    schema: addSchema,
    entity: 'account',
    // Sales is the commonest new person, so it is pre-filled (FE-2). Name and email are the only required fields.
    defaultValues: { name: '', email: '', role: 'sales' as Role, job_title: '' },
    // The generated password leaves useSubmitForm only through this ref, straight into the reveal dialog.
    onSubmit: async v => {
      tried.current = v.email.toLowerCase()
      created.current = await create.mutateAsync({ name: v.name, email: v.email, role: v.role, job_title: v.job_title || undefined })
    },
    onSuccess: () => {
      if (created.current) onCreated(created.current)
      created.current = null
    },
    routeError: e => {
      if (e.code !== 'email_taken') return undefined
      const owner = members.find(m => m.email?.toLowerCase() === tried.current)
      return {
        field: 'email',
        message: owner
          ? `${owner.name} already uses this email. Use a different address, or change their details from the Team list.`
          : 'Someone already uses this email. Use a different address.',
      }
    },
  })
  return (
    <Dialog open onOpenChange={open => !open && !sf.pending && onClose()} busy={sf.pending}>
      <DialogContent
        title="Add person"
        context="They sign in with the email below and a password we generate."
        icon={UserPlus}
        lead={
          <>
            <Icon icon={KeyRound} size="sm" />
            Password is generated for you
          </>
        }
        footer={
          <>
            <Button data-cancel disabled={sf.pending} onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form={sf.formId}
              busy={sf.pending}
              busyLabel="Creating account"
            >
              Create account
            </Button>
          </>
        }
      >
        <Form sf={sf} labels={{ name: 'Full name', email: 'Email' }}>
          <FormField name="name" label="Full name" requirement="required">
            {f => <TextField {...f} autoComplete="off" />}
          </FormField>
          <FormField name="email" label="Email" requirement="required">
            {f => <TextField {...f} type="email" autoComplete="off" inputMode="email" />}
          </FormField>
          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <FormField name="role" label="Role">
              {f => <Select {...f} options={ROLE_OPTIONS.map(r => ({ value: r.value, label: r.label }))} />}
            </FormField>
            <FormField name="job_title" label="Job title" requirement="optional">
              {f => <TextField {...f} placeholder="Sales coordinator" autoComplete="off" />}
            </FormField>
          </div>
          <p className="text-xs text-fg-muted">{JOB_TITLE_HELP}</p>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- Edit job title

const titleSchema = z.object({ job_title: z.string().trim().max(100, 'Keep the job title under 100 characters.') })

export function EditJobTitleDialog({ member, onClose }: Base & { member: TeamMember }) {
  const { toast } = useToast()
  const setTitle = useSetJobTitle()
  const sf = useSubmitForm({
    schema: titleSchema,
    entity: 'job title',
    defaultValues: { job_title: member.job_title ?? '' },
    onSubmit: v => setTitle.mutateAsync({ userId: member.id, jobTitle: v.job_title || null }),
    onSuccess: v => {
      toast({ title: v.job_title ? 'Job title saved' : 'Job title cleared', body: member.name, tone: 'success' })
      onClose()
    },
  })
  return (
    <Dialog open onOpenChange={open => !open && !sf.pending && onClose()} busy={sf.pending}>
      <DialogContent
        title="Edit job title"
        context={member.name}
        icon={Pencil}
        size="sm"
        footer={
          <>
            <Button data-cancel disabled={sf.pending} onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form={sf.formId} busy={sf.pending} busyLabel="Saving">
              {sf.failed ? 'Try again' : 'Save'}
            </Button>
          </>
        }
      >
        <Form sf={sf} labels={{ job_title: 'Job title' }}>
          <FormField name="job_title" label="Job title" help="Prints under the signature on quotations and purchase orders.">
            {f => <TextField {...f} placeholder="Sales engineer" autoComplete="off" />}
          </FormField>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- Edit phone

const phoneSchema = z.object({ phone: z.string().trim().max(PHONE_MAX, `Keep the phone number under ${PHONE_MAX} characters.`) })

export function EditPhoneDialog({ member, onClose }: Base & { member: TeamMember }) {
  const { toast } = useToast()
  const setPhone = useSetPhone()
  const sf = useSubmitForm({
    schema: phoneSchema,
    entity: 'phone',
    defaultValues: { phone: member.phone ?? '' },
    onSubmit: v => setPhone.mutateAsync({ userId: member.id, phone: v.phone || null }),
    onSuccess: v => {
      toast({ title: v.phone ? 'Phone saved' : 'Phone cleared', body: member.name, tone: 'success' })
      onClose()
    },
  })
  return (
    <Dialog open onOpenChange={open => !open && !sf.pending && onClose()} busy={sf.pending}>
      <DialogContent
        title="Edit phone"
        context={member.name}
        icon={Phone}
        size="sm"
        footer={
          <>
            <Button data-cancel disabled={sf.pending} onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form={sf.formId} busy={sf.pending} busyLabel="Saving">
              {sf.failed ? 'Try again' : 'Save'}
            </Button>
          </>
        }
      >
        <Form sf={sf} labels={{ phone: 'Phone' }}>
          <FormField name="phone" label="Phone" requirement="optional" help="Printed under the signature on chase texts and quotations.">
            {f => <TextField {...f} type="tel" className="num" placeholder="0300 1234567" autoComplete="off" />}
          </FormField>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- Change role

const roleSchema = z.object({ role: z.enum(['admin', 'sales', 'engineer']) })

export function ChangeRoleDialog({ member, members, onClose }: Base & { member: TeamMember; members: readonly TeamMember[] }) {
  const { toast } = useToast()
  const changeRole = useSetRole()
  const locked = isOnlyActiveAdmin(member, members)
  const sf = useSubmitForm({
    schema: roleSchema,
    entity: 'role',
    defaultValues: { role: member.role },
    onSubmit: v => changeRole.mutateAsync({ userId: member.id, role: v.role }),
    onSuccess: v => {
      toast({ title: `Role changed to ${roleLabel(v.role)}`, body: member.name, tone: 'success' })
      onClose()
    },
  })
  const unchanged = sf.form.watch('role') === member.role
  return (
    <Dialog open onOpenChange={open => !open && !sf.pending && onClose()} busy={sf.pending}>
      <DialogContent
        title={`Change ${member.name}’s role`}
        context="Takes effect immediately."
        icon={Shield}
        footer={
          <>
            <Button data-cancel disabled={sf.pending} onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form={sf.formId}
              busy={sf.pending}
              busyLabel="Changing role"
              disabled={locked || unchanged}
            >
              {sf.failed ? 'Try again' : 'Change role'}
            </Button>
          </>
        }
      >
        {locked ? (
          <Banner tone="warning" title={`${firstName(member.name)} is the only active admin`}>
            Make someone else an admin first. Q-Tech CRM always needs at least one.
          </Banner>
        ) : null}
        <Form sf={sf}>
          <FormField name="role" label={<span className="sr-only">Role</span>}>
            {f => (
              <RadioGroup value={f.value} onValueChange={f.onChange} onBlur={f.onBlur} aria-label="Role">
                {ROLE_OPTIONS.map(r => (
                  <RadioCard key={r.value} value={r.value} label={r.label} help={r.help} disabled={locked && r.value !== member.role} />
                ))}
              </RadioGroup>
            )}
          </FormField>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- Reset password

export function ResetPasswordDialog({
  member,
  onClose,
  onReset,
}: Pick<Base, 'onClose'> & { member: TeamMember; onReset: (password: string) => void }) {
  const reset = useResetPassword()
  const password = useRef<string | null>(null)
  const sf = useSubmitForm({
    schema: none,
    entity: 'password',
    defaultValues: {},
    onSubmit: async () => {
      password.current = (await reset.mutateAsync(member.id)).password
    },
    onSuccess: () => {
      if (password.current) onReset(password.current)
      password.current = null
    },
  })
  return (
    <Dialog open onOpenChange={open => !open && !sf.pending && onClose()} busy={sf.pending}>
      <DialogContent
        title={`Reset ${member.name}’s password?`}
        icon={KeyRound}
        tone="warning"
        size="sm"
        footer={
          <>
            <Button data-cancel disabled={sf.pending} onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" icon={KeyRound} type="submit" form={sf.formId} busy={sf.pending} busyLabel="Resetting">
              {sf.failed ? 'Try again' : 'Reset password'}
            </Button>
          </>
        }
      >
        <Form sf={sf}>
          <p className="max-w-prose">
            We generate a new password and show it to you once. {firstName(member.name)}&apos;s current password stops working and they
            are signed out on every device.
          </p>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- Deactivate / reactivate

export function DeactivateDialog({ member, members, onClose }: Base & { member: TeamMember; members: readonly TeamMember[] }) {
  const { toast } = useToast()
  const deactivate = useDeactivatePerson()
  const locked = isOnlyActiveAdmin(member, members)
  const first = firstName(member.name)
  const sf = useSubmitForm({
    schema: none,
    entity: 'person',
    defaultValues: {},
    onSubmit: () => deactivate.mutateAsync(member.id),
    onSuccess: () => {
      toast({ title: `${member.name} deactivated`, body: 'They are signed out everywhere.', tone: 'success' })
      onClose()
    },
  })
  return (
    <Dialog open onOpenChange={open => !open && !sf.pending && onClose()} busy={sf.pending}>
      <DialogContent
        title={`Deactivate ${member.name}?`}
        icon={UserX}
        tone="danger"
        size="sm"
        footer={
          <>
            <Button data-cancel disabled={sf.pending} onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="danger"
              icon={UserX}
              type="submit"
              form={sf.formId}
              busy={sf.pending}
              busyLabel="Deactivating"
              disabled={locked}
            >
              {sf.failed ? 'Try again' : locked ? 'Deactivate' : `Deactivate ${first}`}
            </Button>
          </>
        }
      >
        <Form sf={sf}>
          {locked ? (
            <Banner tone="danger" title="You can't deactivate the only active admin">
              Make another person an admin first, then try again.
            </Banner>
          ) : (
            <ul className="grid gap-3">
              <Consequence icon={LogOut}>
                {first} is signed out on every device straight away, and can&apos;t sign in again until you reactivate them.
              </Consequence>
              <Consequence icon={FileText}>
                Their RFQs, orders and notes stay exactly as they are, with their name as the author.
              </Consequence>
              <Consequence icon={History}>You can reactivate them at any time. Their role and job title are kept.</Consequence>
            </ul>
          )}
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function Consequence({ icon, children }: { icon: typeof LogOut; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <Icon icon={icon} className="mt-[2px] text-fg-muted" />
      <span className="min-w-0 text-pretty">{children}</span>
    </li>
  )
}

export function ReactivateDialog({ member, onClose }: Base & { member: TeamMember }) {
  const { toast } = useToast()
  const reactivate = useReactivatePerson()
  const sf = useSubmitForm({
    schema: none,
    entity: 'person',
    defaultValues: {},
    onSubmit: () => reactivate.mutateAsync(member.id),
    onSuccess: () => {
      toast({ title: `${member.name} reactivated`, body: `They can sign in again as ${roleLabel(member.role)}.`, tone: 'success' })
      onClose()
    },
  })
  return (
    <Dialog open onOpenChange={open => !open && !sf.pending && onClose()} busy={sf.pending}>
      <DialogContent
        title={`Reactivate ${member.name}?`}
        icon={UserCheck}
        tone="success"
        size="sm"
        footer={
          <>
            <Button data-cancel disabled={sf.pending} onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" icon={UserCheck} type="submit" form={sf.formId} busy={sf.pending} busyLabel="Reactivating">
              {sf.failed ? 'Try again' : 'Reactivate'}
            </Button>
          </>
        }
      >
        <Form sf={sf}>
          <p className="max-w-prose">
            {firstName(member.name)} can sign in again as {roleLabel(member.role)} with their existing password. If they have forgotten
            it, reset it from their row afterwards.
          </p>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
