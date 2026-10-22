import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MoreMenu } from '@/ui/MoreMenu'
import { MenuItem } from '@/ui/Popover'

/*
 * Hunt HE-19: on a phone, Back with a More menu open closed the page under it. Menus (Popover) now take part in
 * useBackToClose like dialogs and sheets, on phones only.
 */
const sheets = () => ((window.history.state as { __qtechSheets?: string[] } | null)?.__qtechSheets ?? []).length

function phone(on: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: on && q.includes('max-width'),
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }))
}

beforeEach(() => {
  window.history.replaceState({ usr: null, key: 'start', idx: 0 }, '', '/orders/1')
})
afterEach(() => vi.unstubAllGlobals())

describe('Popover and phone Back', () => {
  it('on a phone, Back closes the open menu and the page stays', async () => {
    phone(true)
    render(
      <MoreMenu touch>
        <MenuItem>Cancel order</MenuItem>
      </MoreMenu>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(sheets()).toBe(1)
    await act(async () => window.history.back())
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(window.location.pathname).toBe('/orders/1')
    expect(sheets()).toBe(0)
  })

  it('on a desktop a menu adds no history entry', async () => {
    phone(false)
    render(
      <MoreMenu>
        <MenuItem>Cancel order</MenuItem>
      </MoreMenu>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(sheets()).toBe(0)
  })
})
