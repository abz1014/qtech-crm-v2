import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { VersionLabel } from '@/app/shell/VersionLabel'
import { versionLabel } from '@/lib/pwa/buildInfo'
import { axeViolations } from '@/test/axe'

describe('version label (Settings)', () => {
  it('shows "Version <sha> · <date>" and a "Check for update now" button, accessibly', async () => {
    const { container } = render(<VersionLabel check={async () => 'latest'} />)
    expect(screen.getByText(versionLabel())).toBeInTheDocument()
    expect(screen.getByText(/^Version /)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Check for update now/ })).toBeInTheDocument()
    expect(await axeViolations(container)).toEqual([])
  })

  it('tapping it checks, and says what it found', async () => {
    const check = vi.fn(async () => 'latest' as const)
    render(<VersionLabel check={check} />)
    await userEvent.click(screen.getByRole('button', { name: /Check for update now/ }))
    expect(check).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('status')).toHaveTextContent('You have the latest version.')
  })

  it('says to save first when typing blocks the update, and that it cannot check offline', async () => {
    const check = vi.fn<() => Promise<'blocked' | 'offline'>>().mockResolvedValueOnce('blocked').mockResolvedValueOnce('offline')
    render(<VersionLabel check={check} />)
    const button = screen.getByRole('button', { name: /Check for update now/ })
    await userEvent.click(button)
    expect(await screen.findByText('Save your changes first, then check again.')).toBeInTheDocument()
    await userEvent.click(button)
    expect(await screen.findByText('Cannot check: no connection.')).toBeInTheDocument()
  })
})
