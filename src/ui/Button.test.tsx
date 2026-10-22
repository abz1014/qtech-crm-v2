import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'

// HW-15: an action button (one with a busy state) runs once per press.
describe('Button double click', () => {
  it('drops the repeat click of a double click on an action button', () => {
    const onClick = vi.fn()
    render(
      <Button busy={false} onClick={onClick}>
        Delivered today
      </Button>,
    )
    const b = screen.getByRole('button', { name: 'Delivered today' })
    fireEvent.click(b, { detail: 1 })
    fireEvent.click(b, { detail: 2 })
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('drops clicks while the promise it returned is running', async () => {
    let finish: () => void = () => undefined
    const onClick = vi.fn(
      () =>
        new Promise<void>(resolve => {
          finish = resolve
        }),
    )
    render(
      <Button busy={false} onClick={onClick}>
        Mark done today
      </Button>,
    )
    const b = screen.getByRole('button', { name: 'Mark done today' })
    fireEvent.click(b, { detail: 1 })
    fireEvent.click(b, { detail: 1 })
    expect(onClick).toHaveBeenCalledTimes(1)
    finish()
    await Promise.resolve()
    await Promise.resolve()
    fireEvent.click(b, { detail: 1 })
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('leaves a plain button (no busy state) alone', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Next month</Button>)
    const b = screen.getByRole('button', { name: 'Next month' })
    fireEvent.click(b, { detail: 1 })
    fireEvent.click(b, { detail: 2 })
    expect(onClick).toHaveBeenCalledTimes(2)
  })
})
