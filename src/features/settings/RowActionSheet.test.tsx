import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { TeamMember } from '@/features/settings/api'
import { RowActionSheet } from '@/features/settings/RowActionSheet'

const person = (extra: Partial<TeamMember> = {}): TeamMember => ({
  id: 'ayesha',
  name: 'Ayesha Rana',
  email: 'ayesha@qtech.example',
  role: 'sales',
  job_title: 'Sales engineer',
  phone: null,
  deactivated_at: null,
  created_at: '2026-01-01T00:00:00Z',
  ...extra,
})

describe('Team row actions on a phone (bottom sheet)', () => {
  it('shows the person and the four actions, Deactivate last', async () => {
    const onPick = vi.fn()
    const user = userEvent.setup()
    render(<RowActionSheet member={person()} onPick={onPick} onClose={() => undefined} />)
    expect(screen.getByRole('dialog', { name: 'Ayesha Rana' })).toBeInTheDocument()
    expect(screen.getByText('Sales · Sales engineer')).toBeInTheDocument()
    const labels = screen.getAllByRole('button').map(b => b.textContent)
    expect(labels).toEqual(['Edit job title', 'Edit phone', 'Change role', 'Reset password', 'Deactivate'])
    await user.click(screen.getByRole('button', { name: 'Reset password' }))
    expect(onPick).toHaveBeenCalledWith('reset', expect.objectContaining({ id: 'ayesha' }))
  })

  it('offers Reactivate alone for a deactivated person', () => {
    render(<RowActionSheet member={person({ deactivated_at: '2026-02-01T00:00:00Z' })} onPick={() => undefined} onClose={() => undefined} />)
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Reactivate'])
  })
})
