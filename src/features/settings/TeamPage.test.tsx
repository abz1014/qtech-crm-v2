import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import type { SessionState } from '@/app/session'
import { PlainError } from '@/lib/pgErrors'
import type { TeamMember } from '@/features/settings/api'
import { TeamPage } from '@/features/settings/TeamPage'
import { useMobileBarConfig } from '@/app/shell/MobileBarContext'
import { MobileBarProvider } from '@/app/shell/MobileBarProvider'
import { ToastProvider } from '@/ui/Toast'
import { axeViolations } from '@/test/axe'

const h = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  resetPassword: vi.fn(),
  setRole: vi.fn(),
  setJobTitle: vi.fn(),
  setPhone: vi.fn(),
  deactivate: vi.fn(),
  reactivate: vi.fn(),
}))
vi.mock('@/features/settings/api', () => ({
  listTeam: h.list,
  createPerson: h.create,
  resetPassword: h.resetPassword,
  setRole: h.setRole,
  setJobTitle: h.setJobTitle,
  setPhone: h.setPhone,
  deactivatePerson: h.deactivate,
  reactivatePerson: h.reactivate,
}))

const member = (id: string, name: string, role: TeamMember['role'], extra: Partial<TeamMember> = {}): TeamMember => ({
  id,
  name,
  email: `${id}@qtech.example`,
  role,
  job_title: null,
  phone: null,
  deactivated_at: null,
  created_at: '2026-01-01T00:00:00Z',
  ...extra,
})

const TEAM = [
  member('bilal', 'Bilal Chaudhry', 'admin', { job_title: 'Director' }),
  member('ayesha', 'Ayesha Rana', 'sales', { job_title: 'Sales engineer' }),
  member('usman', 'Usman Tariq', 'sales'),
  member('saad', 'Saad Hussain', 'sales', { deactivated_at: '2026-02-01T00:00:00Z' }),
]

const me: SessionState = { status: 'signed-in', user: { id: 'bilal', name: 'Bilal Chaudhry', role: 'admin' } }

function BackProbe() {
  const c = useMobileBarConfig()
  return <output data-testid="bar-back">{typeof c?.back === 'string' ? c.back : (c?.back?.to ?? '')}</output>
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <SessionProvider value={me}>
        <MobileBarProvider>
          <BackProbe />
          <MemoryRouter>
            <ToastProvider>
              <div data-testid="page">
                <TeamPage />
              </div>
            </ToastProvider>
          </MemoryRouter>
        </MobileBarProvider>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

const writeText = vi.fn()
/** user-event installs its own clipboard on setup(), so the spy goes on after it. */
function setupUser() {
  const user = userEvent.setup()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return user
}

beforeEach(() => {
  Object.values(h).forEach(f => f.mockReset())
  h.list.mockResolvedValue(TEAM)
  writeText.mockReset().mockResolvedValue(undefined)
})

async function openRowMenu(user: ReturnType<typeof setupUser>, name: string, item: string) {
  await user.click(await screen.findByRole('button', { name: `Actions for ${name}` }))
  await user.click(await screen.findByRole('menuitem', { name: item }))
}

describe('Team screen', () => {
  it('warns when there is only one active admin and points to the recovery help', async () => {
    mount()
    expect(await screen.findByText('Only one active admin')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'How to get back in' })).toHaveAttribute('href', '/?help=lone-admin-recovery')
  })

  it('shows no warning once there are two active admins', async () => {
    h.list.mockResolvedValue([...TEAM, member('zain', 'Zain Malik', 'admin')])
    mount()
    expect(await screen.findByText('Ayesha Rana')).toBeInTheDocument()
    expect(screen.queryByText('Only one active admin')).toBeNull()
  })

  it('lists everyone with role and status, marks you, and shows counts', async () => {
    mount()
    expect(await screen.findByText('Ayesha Rana')).toBeInTheDocument()
    expect(screen.getByText('You')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getAllByText('Deactivated').length).toBeGreaterThan(0)
    // an active person reads "Active" as plain text (a blank cell read as missing, audit 2026-10-22); only the exception is a chip
    expect(within(screen.getByRole('table')).getAllByText('Active')).toHaveLength(3)
    expect(screen.getByRole('radio', { name: 'Deactivated' })).toBeInTheDocument()
    expect(screen.getByText('4 people · 3 active, 1 deactivated')).toBeInTheDocument()
    expect(screen.getByText('Deactivated people keep their name on everything they created.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reactivate Saad Hussain' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Actions for Saad Hussain' })).toBeNull()
  })

  it('on a phone the back arrow returns to the Settings list, not to Today', async () => {
    mount()
    await screen.findByText('Ayesha Rana')
    expect(screen.getByTestId('bar-back')).toHaveTextContent('/settings')
  })

  it('searches by name or email and filters by status', async () => {
    const user = setupUser()
    mount()
    await screen.findByText('Ayesha Rana')
    await user.type(screen.getByRole('textbox', { name: 'Search people' }), 'usman@')
    expect(screen.queryByText('Ayesha Rana')).toBeNull()
    expect(screen.getByText('Usman Tariq')).toBeInTheDocument()
    await user.clear(screen.getByRole('textbox', { name: 'Search people' }))
    await user.type(screen.getByRole('textbox', { name: 'Search people' }), 'nobody here')
    expect(screen.getByText('Nothing matches "nobody here"')).toBeInTheDocument()
    // the NoResults action (the field's own x has the same name)
    await user.click(screen.getAllByRole('button', { name: 'Clear search' }).at(-1)!)
    expect(screen.getByText('Ayesha Rana')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /Deactivated/ }))
    expect(screen.queryByText('Ayesha Rana')).toBeNull()
    expect(screen.getByText('Saad Hussain')).toBeInTheDocument()
  })

  it('/ jumps to "Search people" from the list (spec 3.1)', async () => {
    const user = setupUser()
    mount()
    await screen.findByText('Ayesha Rana')
    const row = screen.getByText('Ayesha Rana').closest('tr') as HTMLElement
    row.focus()
    await user.keyboard('/')
    expect(screen.getByRole('textbox', { name: 'Search people' })).toHaveFocus()
  })

  it('shows a plain error with a retry when the list cannot load', async () => {
    h.list.mockRejectedValueOnce(new PlainError('Only an active admin can manage people.'))
    const user = setupUser()
    mount()
    expect(await screen.findByText('Couldn’t load the team')).toBeInTheDocument()
    expect(screen.getByText('Nothing has changed. Check your connection, then try again.')).toBeInTheDocument()
    expect(screen.queryByText('Only an active admin can manage people.')).toBeNull() // never the raw error text
    await user.click(screen.getByRole('button', { name: /try again|retry/i }))
    expect(await screen.findByText('Ayesha Rana')).toBeInTheDocument()
  })

  it('creates a person from name and email only, shows the password once and holds Done until it is copied', async () => {
    h.create.mockResolvedValue({
      user: { id: 'hira', name: 'Hira Siddiqui', email: 'hira@qtech.example', role: 'sales', job_title: null },
      password: 'Vk7xmQ3pRt9wHn2e',
    })
    const user = setupUser()
    mount()
    await user.click(await screen.findByRole('button', { name: 'Add person' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add person' })
    expect(within(dialog).getByLabelText('Role')).toHaveValue('sales') // pre-filled
    await user.type(within(dialog).getByLabelText(/Full name/), 'Hira Siddiqui')
    await user.type(within(dialog).getByLabelText(/Email/), 'hira@qtech.example')
    await user.click(within(dialog).getByRole('button', { name: 'Create account' }))

    expect(h.create).toHaveBeenCalledWith({ name: 'Hira Siddiqui', email: 'hira@qtech.example', role: 'sales', job_title: undefined })
    const secret = await screen.findByRole('dialog', { name: 'Account created' })
    expect(within(secret).getByTestId('generated-password')).toHaveTextContent('Vk7xmQ3pRt9wHn2e')
    expect(within(secret).getByRole('button', { name: 'Done' })).toBeDisabled()
    expect(within(secret).getByText('This password is shown once')).toBeInTheDocument()

    await user.click(within(secret).getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith('Vk7xmQ3pRt9wHn2e') // raw, no separators
    expect(await within(secret).findByRole('button', { name: 'Copied' })).toBeInTheDocument()
    await user.click(within(secret).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByText(/Vk7x/)).toBeNull()
    expect(h.list.mock.calls.length).toBeGreaterThan(1) // list re-read after the change
  })

  it('does not let Esc discard a password that has not been copied', async () => {
    h.create.mockResolvedValue({ user: { id: 'x', name: 'Hira Siddiqui', email: 'h@q.example', role: 'sales', job_title: null }, password: 'Vk7xmQ3pRt9wHn2e' })
    const user = setupUser()
    mount()
    await user.click(await screen.findByRole('button', { name: 'Add person' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add person' })
    await user.type(within(dialog).getByLabelText(/Full name/), 'Hira Siddiqui')
    await user.type(within(dialog).getByLabelText(/Email/), 'h@q.example')
    await user.click(within(dialog).getByRole('button', { name: 'Create account' }))
    await screen.findByRole('dialog', { name: 'Account created' })
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: 'Account created' })).toBeInTheDocument()
  })

  it('copies a WhatsApp sign-in message that carries the password, and unlocks Done', async () => {
    h.create.mockResolvedValue({ user: { id: 'x', name: 'Hira Siddiqui', email: 'h@q.example', role: 'sales', job_title: null }, password: 'Vk7xmQ3pRt9wHn2e' })
    const user = setupUser()
    mount()
    await user.click(await screen.findByRole('button', { name: 'Add person' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add person' })
    await user.type(within(dialog).getByLabelText(/Full name/), 'Hira Siddiqui')
    await user.type(within(dialog).getByLabelText(/Email/), 'h@q.example')
    await user.click(within(dialog).getByRole('button', { name: 'Create account' }))
    const secret = await screen.findByRole('dialog', { name: 'Account created' })
    await user.click(within(secret).getByRole('button', { name: 'Copy sign-in message' }))
    expect(writeText).toHaveBeenCalledTimes(1)
    const text = writeText.mock.calls[0][0] as string
    expect(text).toContain('Hi Hira,')
    expect(text).toContain('Email: h@q.example')
    expect(text).toContain('Password: Vk7xmQ3pRt9wHn2e')
    expect(within(secret).getByRole('button', { name: 'Done' })).toBeEnabled()
  })

  it('unlocks Done when the browser refuses clipboard access, so the admin is not trapped', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    h.create.mockResolvedValue({ user: { id: 'x', name: 'Hira Siddiqui', email: 'h@q.example', role: 'sales', job_title: null }, password: 'Vk7xmQ3pRt9wHn2e' })
    const user = setupUser()
    mount()
    await user.click(await screen.findByRole('button', { name: 'Add person' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add person' })
    await user.type(within(dialog).getByLabelText(/Full name/), 'Hira Siddiqui')
    await user.type(within(dialog).getByLabelText(/Email/), 'h@q.example')
    await user.click(within(dialog).getByRole('button', { name: 'Create account' }))
    const secret = await screen.findByRole('dialog', { name: 'Account created' })
    await user.click(within(secret).getByRole('button', { name: 'Copy' }))
    expect(await within(secret).findByText('Copy it by hand from the box')).toBeInTheDocument()
    expect(within(secret).getByRole('button', { name: 'Done' })).toBeEnabled()
  })

  it('validates name and email on the page and names who already has the email', async () => {
    h.create.mockRejectedValue(new PlainError('Someone already has that email address.', 'email_taken'))
    const user = setupUser()
    mount()
    await user.click(await screen.findByRole('button', { name: 'Add person' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add person' })
    await user.click(within(dialog).getByRole('button', { name: 'Create account' }))
    expect(await within(dialog).findByText('Enter the name of the person.')).toBeInTheDocument()
    expect(h.create).not.toHaveBeenCalled()

    await user.type(within(dialog).getByLabelText(/Full name/), 'Hira Siddiqui')
    await user.type(within(dialog).getByLabelText(/Email/), 'USMAN@qtech.example')
    await user.click(within(dialog).getByRole('button', { name: 'Create account' }))
    expect(await within(dialog).findByText(/Usman Tariq already uses this email/)).toBeInTheDocument()
    // the rest of the form is kept
    expect(within(dialog).getByLabelText(/Full name/)).toHaveValue('Hira Siddiqui')
  })

  it('resets a password: confirm first, then shows it once with a copy button', async () => {
    h.resetPassword.mockResolvedValue({ user_id: 'ayesha', password: 'Nn4pqRs7TtUu8VvW' })
    const user = setupUser()
    mount()
    await openRowMenu(user, 'Ayesha Rana', 'Reset password')
    const confirm = await screen.findByRole('dialog', { name: /Reset Ayesha Rana.s password\?/ })
    expect(h.resetPassword).not.toHaveBeenCalled()
    await user.click(within(confirm).getByRole('button', { name: 'Reset password' }))
    expect(h.resetPassword).toHaveBeenCalledWith('ayesha')
    const secret = await screen.findByRole('dialog', { name: 'Password reset' })
    expect(within(secret).getByText('New password')).toBeInTheDocument()
    await user.click(within(secret).getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith('Nn4pqRs7TtUu8VvW')
  })

  it('changes a role after choosing it, and says what changed', async () => {
    h.setRole.mockResolvedValue({ user_id: 'ayesha', role: 'engineer' })
    const user = setupUser()
    mount()
    await openRowMenu(user, 'Ayesha Rana', 'Change role')
    const dialog = await screen.findByRole('dialog', { name: /Change Ayesha Rana.s role/ })
    const submit = within(dialog).getByRole('button', { name: 'Change role' })
    expect(submit).toBeDisabled() // nothing chosen yet
    await user.click(within(dialog).getByRole('radio', { name: /Engineer/ }))
    await user.click(submit)
    expect(h.setRole).toHaveBeenCalledWith('ayesha', 'engineer')
    expect(await screen.findByText('Role changed to Engineer')).toBeInTheDocument()
  })

  it('blocks demoting the only active admin before asking the server', async () => {
    const user = setupUser()
    mount()
    await openRowMenu(user, 'Bilal Chaudhry', 'Change role')
    const dialog = await screen.findByRole('dialog', { name: /Change Bilal Chaudhry.s role/ })
    expect(within(dialog).getByText('Bilal is the only active admin')).toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: /Sales/ })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Change role' })).toBeDisabled()
  })

  it('blocks deactivating the only active admin', async () => {
    const user = setupUser()
    mount()
    await openRowMenu(user, 'Bilal Chaudhry', 'Deactivate')
    const dialog = await screen.findByRole('dialog', { name: 'Deactivate Bilal Chaudhry?' })
    expect(within(dialog).getByText("You can't deactivate the only active admin")).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Deactivate' })).toBeDisabled() // plain while blocked
    expect(h.deactivate).not.toHaveBeenCalled()
  })

  it("shows the server's last-admin refusal plainly when two admins race", async () => {
    h.setRole.mockRejectedValue(new PlainError('The system must keep at least one active admin.', 'last_admin'))
    h.list.mockResolvedValue([...TEAM, member('second', 'Second Admin', 'admin')])
    const user = setupUser()
    mount()
    await openRowMenu(user, 'Bilal Chaudhry', 'Change role')
    const dialog = await screen.findByRole('dialog', { name: /Change Bilal Chaudhry.s role/ })
    await user.click(within(dialog).getByRole('radio', { name: /Sales/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Change role' }))
    expect(await within(dialog).findByText('The system must keep at least one active admin.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('deactivates after a confirm that explains the three consequences', async () => {
    h.deactivate.mockResolvedValue({ user_id: 'usman' })
    const user = setupUser()
    mount()
    await openRowMenu(user, 'Usman Tariq', 'Deactivate')
    const dialog = await screen.findByRole('dialog', { name: 'Deactivate Usman Tariq?' })
    expect(within(dialog).getByText(/signed out on every device/)).toBeInTheDocument()
    expect(within(dialog).getByText(/RFQs, orders and notes stay/)).toBeInTheDocument()
    expect(within(dialog).getByText(/reactivate them at any time/)).toBeInTheDocument()
    expect(h.deactivate).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate Usman' }))
    expect(h.deactivate).toHaveBeenCalledWith('usman')
    expect(await screen.findByText('Usman Tariq deactivated')).toBeInTheDocument()
  })

  it('reactivates after a quiet confirm', async () => {
    h.reactivate.mockResolvedValue({ user_id: 'saad' })
    const user = setupUser()
    mount()
    await user.click(await screen.findByRole('button', { name: 'Reactivate Saad Hussain' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reactivate Saad Hussain?' })
    await user.click(within(dialog).getByRole('button', { name: 'Reactivate' }))
    expect(h.reactivate).toHaveBeenCalledWith('saad')
    expect(await screen.findByText('Saad Hussain reactivated')).toBeInTheDocument()
  })

  it('edits and clears a job title', async () => {
    h.setJobTitle.mockResolvedValue({ user_id: 'ayesha', job_title: 'Sales manager' })
    const user = setupUser()
    mount()
    await openRowMenu(user, 'Ayesha Rana', 'Edit job title')
    const dialog = await screen.findByRole('dialog', { name: 'Edit job title' })
    const input = within(dialog).getByLabelText('Job title')
    expect(input).toHaveValue('Sales engineer')
    await user.clear(input)
    await user.type(input, 'Sales manager')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(h.setJobTitle).toHaveBeenCalledWith('ayesha', 'Sales manager')

    await openRowMenu(user, 'Ayesha Rana', 'Edit job title')
    const again = await screen.findByRole('dialog', { name: 'Edit job title' })
    await user.clear(within(again).getByLabelText('Job title'))
    await user.click(within(again).getByRole('button', { name: 'Save' }))
    expect(h.setJobTitle).toHaveBeenLastCalledWith('ayesha', null)
  })

  it('edits and clears a phone number (optional, mono)', async () => {
    h.setPhone.mockResolvedValue(null)
    const user = setupUser()
    mount()
    await openRowMenu(user, 'Ayesha Rana', 'Edit phone')
    const dialog = await screen.findByRole('dialog', { name: 'Edit phone' })
    const input = within(dialog).getByLabelText(/Phone/)
    expect(input).toHaveValue('')
    expect(input).toHaveClass('num')
    await user.type(input, '0300 1234567')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(h.setPhone).toHaveBeenCalledWith('ayesha', '0300 1234567')
    expect(await screen.findByText('Phone saved')).toBeInTheDocument()

    await openRowMenu(user, 'Ayesha Rana', 'Edit phone')
    const again = await screen.findByRole('dialog', { name: 'Edit phone' })
    await user.click(within(again).getByRole('button', { name: 'Save' }))
    expect(h.setPhone).toHaveBeenLastCalledWith('ayesha', null)
    expect(await screen.findByText('Phone cleared')).toBeInTheDocument()
  })

  it('refuses a phone number over 30 characters', async () => {
    const user = setupUser()
    mount()
    await openRowMenu(user, 'Ayesha Rana', 'Edit phone')
    const dialog = await screen.findByRole('dialog', { name: 'Edit phone' })
    await user.type(within(dialog).getByLabelText(/Phone/), '1'.repeat(31))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByText('Keep the phone number under 30 characters.')).toBeInTheDocument()
    expect(h.setPhone).not.toHaveBeenCalled()
  })

  it('has no accessibility violations', async () => {
    mount()
    await screen.findByText('Ayesha Rana')
    expect(await axeViolations(screen.getByTestId('page'))).toEqual([])
  })
})
