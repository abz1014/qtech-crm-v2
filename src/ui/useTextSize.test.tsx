import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TextSizeControl, TextSizePanel } from '@/ui/TextSizeControl'
import { applyStoredTextSize, readTextSize, setTextSize, TEXT_SIZE_KEY } from '@/ui/useTextSize'

/* The "Smaller text" choice (DECISIONS 2026-10-19): data-text="small" on <html>, kept per device, applied before React draws. */
const html = () => document.documentElement

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  delete html().dataset.text
})

describe('text size store', () => {
  it('is Normal when nothing is stored, and no attribute is set', () => {
    expect(readTextSize()).toBe('normal')
    expect(applyStoredTextSize()).toBe('normal')
    expect(html().hasAttribute('data-text')).toBe(false)
  })

  it('applies a stored Smaller before anything renders (the bootstrap step in main.tsx)', () => {
    window.localStorage.setItem(TEXT_SIZE_KEY, 'small')
    expect(applyStoredTextSize()).toBe('small')
    expect(html().dataset.text).toBe('small')
  })

  it('ignores anything that is not "small"', () => {
    window.localStorage.setItem(TEXT_SIZE_KEY, 'huge')
    expect(readTextSize()).toBe('normal')
  })

  it('setTextSize stores and applies; Normal removes both the key and the attribute', () => {
    setTextSize('small')
    expect(window.localStorage.getItem(TEXT_SIZE_KEY)).toBe('small')
    expect(html().dataset.text).toBe('small')
    setTextSize('normal')
    expect(window.localStorage.getItem(TEXT_SIZE_KEY)).toBeNull()
    expect(html().hasAttribute('data-text')).toBe(false)
  })

  it('still applies the choice when storage throws (private window, blocked site data)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readTextSize()).toBe('normal')
    expect(() => setTextSize('small')).not.toThrow()
    expect(html().dataset.text).toBe('small')
  })

  it('follows another tab through the storage event', () => {
    render(<TextSizeControl />)
    window.localStorage.setItem(TEXT_SIZE_KEY, 'small')
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: TEXT_SIZE_KEY, newValue: 'small' }))
    })
    expect(html().dataset.text).toBe('small')
    expect(screen.getByRole('radio', { name: 'Smaller' })).toBeChecked()
  })
})

describe('TextSizeControl and the Your details panel', () => {
  it('a radio group named Text size, Normal first and checked', () => {
    render(<TextSizeControl />)
    const group = screen.getByRole('radiogroup', { name: 'Text size' })
    expect(group).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Normal' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Smaller' })).not.toBeChecked()
  })

  it('one tap on Smaller applies at once, and every control on the page agrees', async () => {
    const user = userEvent.setup()
    render(
      <>
        <TextSizePanel />
        <TextSizeControl />
      </>,
    )
    expect(screen.getByRole('heading', { name: 'Text size' })).toBeInTheDocument()
    await user.click(screen.getAllByRole('radio', { name: 'Smaller' })[0])
    expect(html().dataset.text).toBe('small')
    expect(window.localStorage.getItem(TEXT_SIZE_KEY)).toBe('small')
    for (const r of screen.getAllByRole('radio', { name: 'Smaller' })) expect(r).toBeChecked()
    await user.click(screen.getAllByRole('radio', { name: 'Normal' })[1])
    expect(html().hasAttribute('data-text')).toBe(false)
    for (const r of screen.getAllByRole('radio', { name: 'Normal' })) expect(r).toBeChecked()
  })
})
