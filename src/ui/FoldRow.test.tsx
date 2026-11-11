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

  it('calls onToggle on a press', async () => {
    const onToggle = row()
    await userEvent.click(screen.getByRole('button'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
