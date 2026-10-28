import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSyncExternalStore } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'

/*
 * A tap on a popover trigger before the Radix half has arrived must open the popover when it arrives, also when the owner passes
 * defaultOpen={false} (the shell's New and account menus do), which used to beat the remembered tap.
 */
const holder = vi.hoisted(() => ({ mod: null as unknown, listeners: new Set<() => void>() }))
vi.mock('@/ui/popoverStore', async importOriginal => {
  const real = await importOriginal<typeof import('@/ui/popoverStore')>()
  return {
    ...real,
    preloadPopover: () => Promise.resolve(),
    usePopoverImpl: () =>
      useSyncExternalStore(
        l => {
          holder.listeners.add(l)
          return () => void holder.listeners.delete(l)
        },
        () => holder.mod as ReturnType<typeof real.usePopoverImpl>,
      ),
  }
})

describe('Popover tapped before its Radix half is loaded', () => {
  it('opens once Radix arrives, even with defaultOpen={false} from the owner', async () => {
    const user = userEvent.setup()
    render(
      <Popover defaultOpen={false}>
        <PopoverTrigger asChild>
          <button type="button">Open it</button>
        </PopoverTrigger>
        <PopoverContent>Menu body</PopoverContent>
      </Popover>,
    )
    await user.click(screen.getByRole('button', { name: 'Open it' }))
    expect(screen.queryByText('Menu body')).toBeNull()
    holder.mod = await import('@/ui/popoverImpl')
    act(() => holder.listeners.forEach(l => l()))
    expect(await screen.findByText('Menu body')).toBeInTheDocument()
  })
})
