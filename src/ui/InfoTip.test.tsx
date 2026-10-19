import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { axeViolations } from '@/test/axe'
import { InfoTip } from '@/ui/InfoTip'

const TEXT = 'The payment slip ID FBR gives for a tax deposit.'

function Tip() {
  return (
    <p>
      PSID <InfoTip label="About PSID">{TEXT}</InfoTip>
    </p>
  )
}

describe('InfoTip (UX 2026-10-19)', () => {
  it('is a button named by its label; the text is not on the page until it is opened', () => {
    render(<Tip />)
    const button = screen.getByRole('button', { name: 'About PSID' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(TEXT)).toBeNull()
  })

  it('a click opens a pop-up named by the label; a second click closes it', async () => {
    const user = userEvent.setup()
    render(<Tip />)
    const button = screen.getByRole('button', { name: 'About PSID' })
    await user.click(button)
    const tip = await screen.findByRole('dialog', { name: 'About PSID' })
    expect(tip).toHaveTextContent(TEXT)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(await axeViolations()).toEqual([])
    await user.click(button)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('opens on a tap (touch pointer), and hovering alone does not open it', async () => {
    const user = userEvent.setup()
    render(<Tip />)
    const button = screen.getByRole('button', { name: 'About PSID' })
    await user.hover(button)
    expect(screen.queryByRole('dialog')).toBeNull()
    await user.pointer({ keys: '[TouchA]', target: button })
    expect(await screen.findByRole('dialog', { name: 'About PSID' })).toHaveTextContent(TEXT)
  })

  it('Enter opens it from the keyboard; Esc closes it and focus returns to the button', async () => {
    const user = userEvent.setup()
    render(<Tip />)
    await user.tab()
    const button = screen.getByRole('button', { name: 'About PSID' })
    expect(button).toHaveFocus()
    await user.keyboard('{Enter}')
    await screen.findByRole('dialog', { name: 'About PSID' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(button).toHaveFocus()
  })

  it('does not trigger a clickable row or card it sits in', async () => {
    const user = userEvent.setup()
    const onRow = vi.fn()
    render(
      <div role="presentation" onClick={onRow}>
        <InfoTip label="About TCS">Tax collected at source.</InfoTip>
      </div>,
    )
    await user.click(screen.getByRole('button', { name: 'About TCS' }))
    expect(await screen.findByRole('dialog', { name: 'About TCS' })).toBeInTheDocument()
    expect(onRow).not.toHaveBeenCalled()
  })

  it('target: 24px with a mouse, a 44px (--hit-touch) area on a coarse pointer; readable text, at most ~32ch wide', async () => {
    const user = userEvent.setup()
    render(<Tip />)
    const button = screen.getByRole('button', { name: 'About PSID' })
    expect(button.className).toContain('size-6')
    expect(button.className).toContain('[@media(pointer:coarse)]:before:h-touch [@media(pointer:coarse)]:before:w-touch')
    await user.click(button)
    const tip = await screen.findByRole('dialog')
    expect(tip.className).toContain('max-w-[32ch]')
    expect(tip.className).toContain('text-sm')
  })
})
