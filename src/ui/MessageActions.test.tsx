import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import type { SessionState } from '@/app/session'
import { axeViolations } from '@/test/axe'
import { MessageActions, type MessageActionsProps } from '@/ui/MessageActions'
import { MessageActionsDemo } from '@/ui/MessageActions.demo'
import { ToastProvider } from '@/ui/Toast'

const steps: string[] = []
vi.mock('@/lib/clipboard', () => ({
  copyToClipboard: vi.fn(async (text: string) => {
    steps.push(`copy:${text}`)
    return true
  }),
}))
import { copyToClipboard } from '@/lib/clipboard'

const SIGNED_IN: SessionState = { status: 'signed-in', user: { id: 'u1', name: 'Ayesha Rana', role: 'sales' } }
const TEXT = 'Assalam o Alaikum Ahmed,\nPlease confirm the flange size for RFQ-0177 & item 3.'
const EMAIL = { subject: 'RFQ-0177: flange size', body: 'Dear Ahmed,\nPlease confirm the flange size.' }
const AHMED = { name: 'Ahmed Raza', phone: '+92 300 555 0188', email: 'ahmed.raza@example.invalid' }
const WA = `https://wa.me/923005550188?text=${encodeURIComponent(TEXT)}`
const MAIL = `mailto:ahmed.raza@example.invalid?subject=${encodeURIComponent(EMAIL.subject)}&body=${encodeURIComponent(EMAIL.body.replace('\n', '\r\n'))}`

function show(props: Partial<MessageActionsProps> = {}) {
  return render(
    <SessionProvider value={SIGNED_IN}>
      <ToastProvider>
        <MessageActions to={AHMED} text={TEXT} email={EMAIL} {...props} />
      </ToastProvider>
    </SessionProvider>,
  )
}

const names = () =>
  within(screen.getByRole('group'))
    .getAllByRole('button')
    .map(b => b.textContent)

beforeEach(() => {
  steps.length = 0
  vi.mocked(copyToClipboard).mockClear()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    steps.push(`open:${this.href}`)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('MessageActions (owner decision 2026-10-20)', () => {
  it('WhatsApp, email, Copy; named by their verbs and described by who they go to', () => {
    show()
    expect(screen.getByRole('group', { name: 'Send to Ahmed Raza' })).toBeInTheDocument()
    expect(names()).toEqual(['Open in WhatsApp', 'Open in email', 'Copy message'])
    expect(screen.getByRole('button', { name: 'Open in WhatsApp' })).toHaveAccessibleDescription(
      'Opens WhatsApp with the message filled in, to Ahmed Raza on 0300 5550188. You press Send there.',
    )
    expect(screen.getByRole('button', { name: 'Open in email' })).toHaveAccessibleDescription(
      'Opens your email app with the message filled in, to ahmed.raza@example.invalid. You press Send there.',
    )
  })

  it('Open in WhatsApp opens wa.me with the message, copies nothing, marks nothing, and remembers WhatsApp', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    show({ onOpen })
    await user.click(screen.getByRole('button', { name: 'Open in WhatsApp' }))
    expect(steps).toEqual([`open:${WA}`])
    expect(onOpen).toHaveBeenCalledWith('whatsapp')
    expect(copyToClipboard).not.toHaveBeenCalled()
    expect(window.localStorage.getItem('qtech.channel.u1')).toBe('whatsapp')
  })

  it('Open in email opens mailto: with subject and body, and next time email comes first', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const first = show({ onOpen })
    await user.click(screen.getByRole('button', { name: 'Open in email' }))
    expect(steps).toEqual([`open:${MAIL}`])
    expect(onOpen).toHaveBeenCalledWith('email')
    expect(window.localStorage.getItem('qtech.channel.u1')).toBe('email')
    expect(names()).toEqual(['Open in email', 'Open in WhatsApp', 'Copy message'])
    first.unmount()
    show()
    expect(names()).toEqual(['Open in email', 'Open in WhatsApp', 'Copy message'])
  })

  it('without an email version, Open in email sends the WhatsApp text with no subject', async () => {
    const user = userEvent.setup()
    show({ email: undefined })
    await user.click(screen.getByRole('button', { name: 'Open in email' }))
    expect(steps).toEqual([`open:mailto:ahmed.raza@example.invalid?body=${encodeURIComponent(TEXT.replace('\n', '\r\n'))}`])
  })

  it('variant="primary": only the first button that works is primary; the default is all secondary', () => {
    const { unmount } = show({ variant: 'primary' })
    expect(screen.getByRole('button', { name: 'Open in WhatsApp' })).toHaveClass('bg-primary')
    expect(screen.getByRole('button', { name: 'Open in email' })).not.toHaveClass('bg-primary')
    expect(screen.getByRole('button', { name: 'Copy message' })).not.toHaveClass('bg-primary')
    unmount()
    show()
    for (const b of within(screen.getByRole('group')).getAllByRole('button')) expect(b).not.toHaveClass('bg-primary')
  })

  it('no mobile saved: WhatsApp stays, disabled, with the reason; email moves first and takes the primary', async () => {
    const user = userEvent.setup()
    const onFixContact = vi.fn()
    show({ to: { name: 'Bilal Khan', phone: null, email: 'bilal@example.invalid' }, variant: 'primary', onFixContact })
    const wa = screen.getByRole('button', { name: 'Open in WhatsApp' })
    expect(wa).toBeDisabled()
    expect(wa).toHaveAccessibleDescription('No mobile number saved for Bilal Khan — add one')
    expect(names()).toEqual(['Open in email', 'Open in WhatsApp', 'Copy message'])
    expect(screen.getByRole('button', { name: 'Open in email' })).toHaveClass('bg-primary')
    await user.click(screen.getByRole('button', { name: 'add one' }))
    expect(onFixContact).toHaveBeenCalledTimes(1)
  })

  it('only a landline and no email: no email button, and Copy is the primary', () => {
    show({ to: { name: 'Ghani Glass', phone: '+92 42 555 0138', email: null }, variant: 'primary' })
    expect(names()).toEqual(['Open in WhatsApp', 'Copy message'])
    expect(screen.getByRole('button', { name: 'Open in WhatsApp' })).toBeDisabled()
    expect(screen.getByText('Only a landline saved for Ghani Glass — add a mobile number')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy message' })).toHaveClass('bg-primary')
    expect(screen.queryByRole('button', { name: 'add a mobile number' })).toBeNull() // plain words without onFixContact
  })

  it('a number that is not a mobile, and no contact at all, say so', () => {
    const { unmount } = show({ to: { name: 'Naveed Akhtar', phone: '12345' } })
    expect(screen.getByText('The number saved for Naveed Akhtar is not a mobile number — check it')).toBeInTheDocument()
    unmount()
    show({ to: null })
    expect(screen.getByRole('group', { name: 'Send the message' })).toBeInTheDocument()
    expect(screen.getByText('No contact saved — add one')).toBeInTheDocument()
    expect(names()).toEqual(['Open in WhatsApp', 'Copy message'])
  })

  it('several numbers in the field: the one labelled WhatsApp is used and named', async () => {
    const user = userEvent.setup()
    show({ to: { name: 'Naveed Akhtar', phone: 'Off: 042-35761234 / WhatsApp: 0321 7654321' } })
    const wa = screen.getByRole('button', { name: 'Open in WhatsApp' })
    expect(wa).toHaveAccessibleDescription(/on 0321 7654321\./)
    await user.click(wa)
    expect(steps[0]).toMatch(/^open:https:\/\/wa\.me\/923217654321\?text=/)
  })

  it('Copy copies the last-used channel’s text and says where to paste it', async () => {
    const user = userEvent.setup()
    const { unmount } = show()
    await user.click(screen.getByRole('button', { name: 'Copy message' }))
    expect(steps).toEqual([`copy:${TEXT}`])
    expect(await screen.findByText('Paste it into WhatsApp.')).toBeInTheDocument()
    unmount()
    steps.length = 0
    show({ channel: 'email' })
    await user.click(screen.getByRole('button', { name: 'Copy message' }))
    expect(steps).toEqual([`copy:${EMAIL.body}`])
    expect(await screen.findByText('Paste it into your email.')).toBeInTheDocument()
  })

  it('a refused copy says so', async () => {
    const user = userEvent.setup()
    vi.mocked(copyToClipboard).mockResolvedValueOnce(false)
    show()
    await user.click(screen.getByRole('button', { name: 'Copy message' }))
    expect(await screen.findByText('Could not copy the message')).toBeInTheDocument()
  })

  it('the screen’s own copy (copy and mark) replaces the plain one; busy shows its label', async () => {
    const user = userEvent.setup()
    const onCopy = vi.fn()
    const { rerender } = show({ copy: { label: 'Copy and mark chased', onCopy } })
    await user.click(screen.getByRole('button', { name: 'Copy and mark chased' }))
    expect(onCopy).toHaveBeenCalledTimes(1)
    expect(copyToClipboard).not.toHaveBeenCalled()
    rerender(
      <SessionProvider value={SIGNED_IN}>
        <ToastProvider>
          <MessageActions to={AHMED} text={TEXT} copy={{ label: 'Copy and mark chased', onCopy, busy: true, busyLabel: 'Marking' }} />
        </ToastProvider>
      </SessionProvider>,
    )
    expect(screen.getByRole('button', { name: 'Marking' })).toBeDisabled()
  })

  it('copy={false} leaves Copy to the screen', () => {
    show({ copy: false })
    expect(names()).toEqual(['Open in WhatsApp', 'Open in email'])
  })

  it('too long for a link: the message is copied first, then the empty chat opens, and a toast says to paste', async () => {
    const user = userEvent.setup()
    const long = `${TEXT}\n${'Item: 2" ball valve, SS316, PN40. '.repeat(80)}`
    show({ text: long })
    const wa = screen.getByRole('button', { name: 'Open in WhatsApp' })
    expect(wa).toHaveAccessibleDescription(/too long to fill in: it is copied for you to paste/)
    await user.click(wa)
    expect(steps).toEqual([`copy:${long}`, 'open:https://wa.me/923005550188'])
    expect(await screen.findByText('It is too long to fill in. Paste it into the chat.')).toBeInTheDocument()
  })

  it('too long and the copy is refused: nothing opens', async () => {
    const user = userEvent.setup()
    vi.mocked(copyToClipboard).mockResolvedValueOnce(false)
    const onOpen = vi.fn()
    show({ email: { subject: 'S', body: 'x '.repeat(1500) }, onOpen })
    await user.click(screen.getByRole('button', { name: 'Open in email' }))
    expect(steps).toEqual([])
    expect(onOpen).not.toHaveBeenCalled()
    expect(await screen.findByText('Could not copy the message')).toBeInTheDocument()
  })

  it('a controlled channel goes to the screen, not to its own storage', async () => {
    const user = userEvent.setup()
    const onChannelChange = vi.fn()
    show({ channel: 'whatsapp', onChannelChange })
    await user.click(screen.getByRole('button', { name: 'Open in email' }))
    expect(onChannelChange).toHaveBeenCalledWith('email')
    expect(window.localStorage.getItem('qtech.channel.u1')).toBeNull()
  })

  it('fill: the buttons share a phone row', () => {
    show({ fill: true })
    for (const b of within(screen.getByRole('group')).getAllByRole('button')) expect(b).toHaveClass('flex-1')
  })
})

describe('MessageActionsDemo', () => {
  it('shows every state, each titled, with no axe violations', async () => {
    render(
      <SessionProvider value={SIGNED_IN}>
        <MessageActionsDemo />
      </SessionProvider>,
    )
    expect(screen.getAllByRole('region')).not.toHaveLength(0)
    const titles = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)
    expect(titles).toHaveLength(8)
    expect(titles).toContain('No mobile number: WhatsApp disabled with the reason')
    expect(await axeViolations()).toEqual([])
  })

  it('one state on its own; opening says the screen offers its own mark tap', async () => {
    const user = userEvent.setup()
    render(<MessageActionsDemo only="ready" />)
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Open in WhatsApp' }))
    expect(screen.getByRole('status')).toHaveTextContent('The screen now offers its own "Mark chased" tap.')
  })
})
