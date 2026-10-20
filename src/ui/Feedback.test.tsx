import { useState } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ListFilter } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import { axeViolations } from '@/test/axe'
import { Callout, InlineConfirm } from '@/ui/Inline'
import { ToastProvider } from '@/ui/Toast'
import { ToggleButton } from '@/ui/ToggleButton'
import { useToast, type ToastInput } from '@/ui/useToast'
import { Radio, RadioCard, RadioGroup } from '@/ui/form/Radio'

function Fire({ input, label = 'Fire' }: { input: ToastInput; label?: string }) {
  const { toast } = useToast()
  return <button onClick={() => toast(input)}>{label}</button>
}
const setup = (input: ToastInput) =>
  render(
    <ToastProvider>
      <Fire input={input} />
    </ToastProvider>,
  )

describe('Toast (U03)', () => {
  it('an Undo toast shows the ring button with the seconds, which count down', async () => {
    const user = userEvent.setup()
    setup({ title: 'Marked floated', body: '4 suppliers · RFQ-0177', undo: { onUndo: () => {}, seconds: 3 } })
    await user.click(screen.getByText('Fire'))
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Marked floated')
    expect(status).toHaveTextContent('4 suppliers · RFQ-0177')
    const undo = screen.getByRole('button', { name: /Undo/ })
    expect(undo).toHaveTextContent('3s')
    await waitFor(() => expect(undo).toHaveTextContent(/[12]s/), { timeout: 2500 })
    expect(undo.querySelector('svg circle:last-child')).toHaveAttribute('stroke-dashoffset')
  })

  it('Undo runs once, says "Undone.", and the countdown never commits', async () => {
    const user = userEvent.setup()
    const onUndo = vi.fn()
    const onSettle = vi.fn()
    setup({ title: 'Marked floated', undo: { onUndo, onSettle, seconds: 10, undoneBody: 'Nothing was marked.' } })
    await user.click(screen.getByText('Fire'))
    await user.click(await screen.findByRole('button', { name: /Undo/ }))
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Undone.')).toBeInTheDocument()
    expect(screen.getByText('Nothing was marked.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull()
    expect(onSettle).not.toHaveBeenCalled()
  })

  it('when the window closes it settles: the sentence changes to the outcome and Undo goes away', async () => {
    const onSettle = vi.fn()
    const user = userEvent.setup()
    setup({ title: 'Marked floated', undo: { onUndo: () => {}, onSettle, seconds: 1, settledTitle: 'Floated to 4 suppliers', settledBody: 'Sent today' } })
    await user.click(screen.getByText('Fire'))
    expect(await screen.findByText('Floated to 4 suppliers', {}, { timeout: 2500 })).toBeInTheDocument()
    expect(onSettle).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull()
  })

  it('Cmd/Ctrl+Z undoes the newest open Undo', async () => {
    const user = userEvent.setup()
    const onUndo = vi.fn()
    setup({ title: 'Marked chased', undo: { onUndo } })
    await user.click(screen.getByText('Fire'))
    await screen.findByRole('button', { name: /Undo/ })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }))
    })
    await waitFor(() => expect(onUndo).toHaveBeenCalledTimes(1))
  })

  it('hovering pauses the countdown', async () => {
    const user = userEvent.setup()
    setup({ title: 'Marked floated', undo: { onUndo: () => {}, seconds: 3 } })
    await user.click(screen.getByText('Fire'))
    const undo = await screen.findByRole('button', { name: /Undo/ })
    await user.hover(undo)
    const before = undo.textContent
    await new Promise(r => setTimeout(r, 1300))
    expect(undo.textContent).toBe(before)
  })

  it('an error toast is an alert, stays, and offers a retry that runs and dismisses it', async () => {
    const user = userEvent.setup()
    const retry = vi.fn()
    setup({ title: 'Couldn’t save the answer', body: 'Nothing was changed.', tone: 'danger', action: { label: 'Try again', onClick: retry } })
    await user.click(screen.getByText('Fire'))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Nothing was changed.')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('shows at most three, oldest removed first (its open Undo is committed, not lost)', async () => {
    const user = userEvent.setup()
    const onSettle = vi.fn()
    render(
      <ToastProvider>
        <Fire input={{ title: 'first', undo: { onUndo: () => {}, onSettle } }} label="one" />
        <Fire input={{ title: 'second' }} label="two" />
        <Fire input={{ title: 'third' }} label="three" />
        <Fire input={{ title: 'fourth' }} label="four" />
      </ToastProvider>,
    )
    for (const l of ['one', 'two', 'three', 'four']) await user.click(screen.getByText(l))
    expect(screen.getAllByRole('status')).toHaveLength(3)
    expect(screen.queryByText('first')).toBeNull()
    expect(onSettle).toHaveBeenCalledTimes(1)
  })

  it('dismissing an Undo toast commits it; axe is clean', async () => {
    const user = userEvent.setup()
    const onSettle = vi.fn()
    const { container } = setup({ title: 'Marked floated', undo: { onUndo: () => {}, onSettle } })
    await user.click(screen.getByText('Fire'))
    await screen.findByRole('status')
    expect(await axeViolations(container)).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onSettle).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })
})

describe('InlineConfirm and Callout (U03)', () => {
  it('InlineConfirm says what happened and offers Undo', async () => {
    const user = userEvent.setup()
    const onUndo = vi.fn()
    const { container } = render(
      <>
        <InlineConfirm onUndo={onUndo}>Copied. Marked as chased today, Fri 27 Nov.</InlineConfirm>
        <InlineConfirm variant="line">Chased Fri 27 Nov</InlineConfirm>
        <Callout title="No message is sent from here.">The text is copied and you send it yourself.</Callout>
      </>,
    )
    expect(screen.getAllByRole('status')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(screen.getByText('No message is sent from here.')).toBeInTheDocument()
    expect(await axeViolations(container)).toEqual([])
  })
})

describe('ToggleButton and Radio (U07)', () => {
  it('ToggleButton: aria-pressed flips with Space and Enter, the label stays', async () => {
    const user = userEvent.setup()
    function T() {
      const [on, setOn] = useState(false)
      return (
        <ToggleButton pressed={on} onPressedChange={setOn} icon={ListFilter}>
          Lowest only
        </ToggleButton>
      )
    }
    const { container } = render(<T />)
    const b = screen.getByRole('button', { name: 'Lowest only' })
    expect(b).toHaveAttribute('aria-pressed', 'false')
    await user.tab()
    await user.keyboard(' ')
    expect(b).toHaveAttribute('aria-pressed', 'true')
    await user.keyboard('{Enter}')
    expect(b).toHaveAttribute('aria-pressed', 'false')
    expect(await axeViolations(container)).toEqual([])
  })

  it('Radio and RadioCard: one choice, arrows move and choose, help is the description', async () => {
    const user = userEvent.setup()
    function R() {
      const [v, setV] = useState('customer')
      return (
        <>
          <RadioGroup aria-label="Role" value={v} onValueChange={setV}>
            <Radio value="customer" label="Customer" />
            <Radio value="supplier" label="Supplier" />
          </RadioGroup>
          <RadioGroup aria-label="What to do" defaultValue="chase">
            <RadioCard value="chase" label="Chase" help="Prepares a message" />
            <RadioCard value="log" label="Log a reply" help="Capture what they said" disabled />
          </RadioGroup>
        </>
      )
    }
    const { container } = render(<R />)
    expect(screen.getByRole('radio', { name: 'Customer' })).toBeChecked()
    await user.tab()
    await user.keyboard('{ArrowDown>}')
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Supplier' })).toBeChecked())
    await user.keyboard('{/ArrowDown}')
    const card = screen.getByRole('radio', { name: /Chase/ })
    expect(card).toHaveAccessibleDescription('Prepares a message')
    expect(screen.getByRole('radio', { name: /Log a reply/ })).toBeDisabled()
    expect(await axeViolations(container)).toEqual([])
  })
})

describe('Toast Undo that fails (code review p9)', () => {
  it('does not claim "Undone." when the undo write fails; it says it could not undo, as an alert', async () => {
    const user = userEvent.setup()
    const onUndo = vi.fn(() => Promise.reject(new Error('network down')))
    setup({ title: 'Closed RFQ-0101', undo: { onUndo } })
    await user.click(screen.getByRole('button', { name: 'Fire' }))
    await user.click(await screen.findByRole('button', { name: /Undo/ }))
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not undo/)
    expect(screen.queryByText('Undone.')).toBeNull()
  })

  it('maps the very first undo failure through the lazily loaded error table (perf/trim)', async () => {
    const user = userEvent.setup()
    const onUndo = vi.fn(() => Promise.reject({ code: 'P0001', message: 'March 2026 is still open. Close earlier months first.' }))
    setup({ title: 'Closed RFQ-0101', undo: { onUndo } })
    await user.click(screen.getByRole('button', { name: 'Fire' }))
    await user.click(await screen.findByRole('button', { name: /Undo/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Close March 2026 first. Months close in order.')
  })
})
