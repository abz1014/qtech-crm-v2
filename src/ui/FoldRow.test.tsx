import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Check } from 'lucide-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FoldRow } from '@/ui/FoldRow'

afterEach(cleanup)

function row(open = false, onToggle = vi.fn(), summary = '3 items') {
  render(
    <FoldRow state={{ icon: Check, word: 'Done' }} title="Quotation" summary={summary} open={open} onToggle={onToggle} controlsId="fold-q">
      <p>Body text</p>
    </FoldRow>,
  )
  return onToggle
}

describe('FoldRow', () => {
  it('names the row by its title first, then the state, then the summary', () => {
    row()
    expect(screen.getByRole('button', { name: /^Quotation Done 3 items$/ })).toBeTruthy()
  })

  it('points aria-controls at the body and reports open or closed', () => {
    row(false)
    const btn = screen.getByRole('button')
    expect(btn.getAttribute('aria-controls')).toBe('fold-q')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(document.getElementById('fold-q')).toBeNull()
    cleanup()
    row(true)
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById('fold-q')?.textContent).toBe('Body text')
  })

  it('closed, it is one 44 px line with a hairline: no box, and a long summary wraps instead of being clipped', () => {
    row(false, vi.fn(), 'PO-20481/KHI-0092-A-LONG')
    const btn = screen.getByRole('button')
    expect(btn.className).toContain('min-h-touch')
    expect(btn.className).toContain('py-2')
    expect(btn.className).not.toMatch(/flex-wrap|min-h-\[|\bh-\d/)
    expect(btn.querySelector('.truncate')).toBeNull()
    expect(btn.querySelector('[class*="overflow-wrap"]')).toBeTruthy()
    expect(btn.parentElement?.className).toContain('border-b')
    expect(btn.parentElement?.className).not.toMatch(/rounded|\bborder\b(?!-b)/)
  })

  it('with a chip: the state is drawn as a chip right of the words, title over summary, and named once', () => {
    render(
      <FoldRow state={{ icon: Check, word: 'Done' }} chip={{ icon: Check, word: 'Done', tone: 'success' }} title="Quotation" summary="1 of 1 answered" open={false} onToggle={vi.fn()} controlsId="fold-c" />,
    )
    const btn = screen.getByRole('button', { name: /^Quotation Done 1 of 1 answered$/ })
    expect(btn.className).toContain('grid')
    expect(btn.querySelector('.sr-only')).toBeNull()
    const chip = screen.getByText('Done')
    expect(chip.className).toMatch(/rounded-pill/)
    expect(chip.className).toContain('bg-tone-success-bg')
  })

  it('with a chip that says something other than the state, the state word is still heard first', () => {
    render(
      <FoldRow state={{ icon: Check, word: 'Now' }} chip={{ icon: Check, word: 'Waiting', tone: 'info' }} title="Delivery" summary="2 of 3 delivered" open={false} onToggle={vi.fn()} controlsId="fold-d" />,
    )
    expect(screen.getByRole('button', { name: /^Delivery Now Waiting 2 of 3 delivered$/ })).toBeTruthy()
  })

  it('calls onToggle on a press', async () => {
    const onToggle = row()
    await userEvent.click(screen.getByRole('button'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
