import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setFormDirty } from '@/lib/pwa/dirtyForms'

vi.mock('@/lib/pwa/updates', () => ({ reloadOntoNewVersion: vi.fn(async () => {}) }))
import { reloadOntoNewVersion } from '@/lib/pwa/updates'
import { UpdateNeededBanner } from '@/app/shell/UpdateNeededBanner'

afterEach(() => {
  setFormDirty('typing', false)
  vi.mocked(reloadOntoNewVersion).mockClear()
})

describe('Update needed — tap Reload (owner decision 2026-10-22)', () => {
  it('says saving is paused and reloads onto the new version at once when nothing is being typed', async () => {
    render(<UpdateNeededBanner />)
    expect(screen.getByRole('alert')).toHaveTextContent('Update needed — tap Reload')
    expect(screen.getByRole('alert')).toHaveTextContent(/saving is paused/)
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reloadOntoNewVersion).toHaveBeenCalledTimes(1)
  })

  it('with unsaved typing, the first tap says what a reload clears and the second reloads', async () => {
    setFormDirty('typing', true)
    render(<UpdateNeededBanner />)
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reloadOntoNewVersion).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/New RFQ keeps its draft/)
    await userEvent.click(screen.getByRole('button', { name: 'Reload anyway' }))
    expect(reloadOntoNewVersion).toHaveBeenCalledTimes(1)
  })
})
