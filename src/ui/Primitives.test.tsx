import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Info } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import { axeViolations } from '@/test/axe'
import { Banner } from '@/ui/Banner'
import { DateRail } from '@/ui/DateRail'
import { railState } from '@/ui/dateRailModel'
import { EmptyState } from '@/ui/EmptyState'
import { InlineEditRow } from '@/ui/InlineEditRow'
import { StepList } from '@/ui/StepList'
import { ProgressBar } from '@/ui/Tag'

describe('DateRail (components-12)', () => {
  it('works the six states out from the dates', () => {
    expect(railState('2026-12-03', '2026-11-27')).toBe('on-track')
    expect(railState('2026-12-01', '2026-11-27')).toBe('due-soon')
    expect(railState('2026-11-27', '2026-11-27')).toBe('due-today')
    expect(railState('2026-11-24', '2026-11-27')).toBe('overdue')
    expect(railState('2026-11-27', '2026-11-27', '2026-11-25')).toBe('done')
    expect(railState(null, '2026-11-27')).toBe('no-date')
  })

  it('on track: neutral, today with a real day, both ends named, fill at 25%', () => {
    const { container } = render(<DateRail start="2026-11-25" due="2026-12-03" today="2026-11-27" />)
    const rail = container.firstElementChild as HTMLElement
    expect(rail.dataset.railState).toBe('on-track')
    expect(rail.style.getPropertyValue('--p')).toBe('25%')
    expect(rail).toHaveTextContent('Today · Fri 27 Nov')
    expect(rail).toHaveTextContent('Asked Wed 25 Nov')
    expect(rail).toHaveTextContent('Quotation due Thu 3 Dec')
  })

  it('flips the label to the left of the marker near the end, and says how late when overdue', () => {
    const { container } = render(
      <>
        <DateRail start="2026-11-23" due="2026-11-27" today="2026-11-27" todayLabel="Today · 17:00" />
        <DateRail start="2026-11-15" due="2026-11-24" today="2026-11-27" />
      </>,
    )
    const [dueToday, overdue] = [...container.querySelectorAll<HTMLElement>('[data-rail-state]')]
    expect(dueToday.querySelector('span')!.className).toContain('-translate-x-full')
    expect(dueToday).toHaveTextContent('Today · 17:00')
    expect(overdue).toHaveTextContent('3 days overdue')
    expect(overdue.querySelector('i')!.className).toContain('bg-tone-danger-fg')
  })

  it('done names the day it was done; no date draws a dashed line and invents nothing', () => {
    const { container } = render(
      <>
        <DateRail start="2026-11-20" due="2026-11-27" today="2026-11-27" doneOn="2026-11-25" />
        <DateRail start="2026-11-20" due={null} today="2026-11-27" />
      </>,
    )
    const [done, none] = [...container.querySelectorAll<HTMLElement>('[data-rail-state]')]
    expect(done).toHaveTextContent('Quotation sent Wed 25 Nov')
    expect(none).toHaveTextContent('No quotation date on this RFQ')
    expect(none).toHaveTextContent('No due date')
    expect(none.querySelector('i')).toBeNull()
  })

  it('can be hidden from assistive tech when the page already says it in words', () => {
    const { container } = render(<DateRail decorative state="due-soon" start="2026-11-21" due="2026-12-01" today="2026-11-27" />)
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('StepList (components-13)', () => {
  it('shows done, now and to do, says each in words, and marks the current step', async () => {
    const { container } = render(
      <StepList
        label="Progress of RFQ-0177"
        steps={[
          { label: 'Floated to 4 suppliers', state: 'done', note: 'Mon 23 Nov' },
          { label: 'Waiting for quotes', state: 'now', note: '2 of 4 back' },
          { label: 'Bid sent', state: 'todo', note: 'due Tue 1 Dec' },
        ]}
      />,
    )
    const items = screen.getAllByRole('listitem')
    expect(items.map(i => i.textContent)).toEqual([
      'Done: Floated to 4 suppliersMon 23 Nov',
      'Now: Waiting for quotes2 of 4 back',
      'To do: Bid sentdue Tue 1 Dec',
    ])
    expect(items[1]).toHaveAttribute('aria-current', 'step')
    expect(items[0]).not.toHaveAttribute('aria-current')
    expect(await axeViolations(container)).toEqual([])
  })
})

describe('ProgressBar', () => {
  it('is an image named by its sentence, filled to the share', () => {
    render(<ProgressBar done={3} total={5} label="3 of 5 items covered" />)
    const bar = screen.getByRole('img', { name: '3 of 5 items covered' })
    expect(bar.querySelector('i')).toHaveStyle({ width: '60%' })
  })
})

describe('InlineEditRow (components-13)', () => {
  const columns = [{ width: '1fr' }, { width: '100px', align: 'right' as const }]
  function Harness({ onSave = () => {}, error }: { onSave?: () => void; error?: string }) {
    const [mode, setMode] = useState<'resting' | 'editing' | 'saving'>('resting')
    return (
      <InlineEditRow
        columns={columns}
        label="Karachi Valve House"
        mode={mode}
        error={error}
        cells={['Karachi Valve House', '3,120.00']}
        editCells={['Karachi Valve House', <input key="p" aria-label="Price" defaultValue="3,120.00" />]}
        onEdit={() => setMode('editing')}
        onSave={() => {
          onSave()
          setMode('saving')
        }}
        onCancel={() => setMode('resting')}
      />
    )
  }

  it('clicking a cell edits; Enter saves; Esc cancels', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<Harness onSave={onSave} />)
    const row = () => screen.getByRole('group', { name: 'Karachi Valve House' })
    expect(row()).toHaveAttribute('data-mode', 'resting')
    await user.click(screen.getByText('3,120.00'))
    expect(row()).toHaveAttribute('data-mode', 'editing')
    await user.type(screen.getByLabelText('Price'), '{Escape}')
    expect(row()).toHaveAttribute('data-mode', 'resting')
    await user.click(screen.getByRole('button', { name: 'Edit Karachi Valve House' }))
    await user.type(screen.getByLabelText('Price'), '{Enter}')
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(row()).toHaveAttribute('data-mode', 'saving')
    expect(screen.getByRole('button', { name: 'Save Karachi Valve House' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('button', { name: /Cancel editing/ })).toBeNull()
  })

  it('shows the validation line under the row, as an alert, while editing', async () => {
    const user = userEvent.setup()
    render(<Harness error="Price must be a number, for example 4,820.00." />)
    expect(screen.queryByRole('alert')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Edit Karachi Valve House' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Price must be a number')
  })

  it('while editing on a phone the fields are 16 px, so iOS does not zoom (the 15 px desktop size loses below md)', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Edit Karachi Valve House' }))
    const cls = screen.getByRole('group', { name: 'Karachi Valve House' }).className.split(' ')
    expect(cls).toEqual(expect.arrayContaining(['[&_input]:text-sm', 'max-md:[&_input]:text-[16px]', 'max-md:[&_select]:text-[16px]']))
  })
})

describe('EmptyState (components-09)', () => {
  it('the role-limited state uses the warning tile and the lock', () => {
    const { container } = render(
      <EmptyState bordered mood="warning" title="Money is for admins and sales">
        Your role is Engineer.
      </EmptyState>,
    )
    const card = container.firstElementChild as HTMLElement
    expect(card.dataset.mood).toBe('warning')
    expect(card.querySelector('svg.lucide-lock')).not.toBeNull()
    expect(card.querySelector('span')!.className).toContain('bg-tone-warning-bg')
    expect(card.className).toContain('border-dashed')
  })

  it('bordered is solid for the goal state, dashed otherwise, and absent by default', () => {
    const { container } = render(
      <>
        <EmptyState bordered mood="goal" title="a" />
        <EmptyState bordered title="b" />
        <EmptyState title="c" />
        <EmptyState bordered="solid" title="d" />
      </>,
    )
    const cards = [...container.children] as HTMLElement[]
    expect(cards[0].className).not.toContain('border-dashed')
    expect(cards[0].className).toContain('border')
    expect(cards[1].className).toContain('border-dashed')
    expect(cards[2].className).not.toContain('border')
    expect(cards[3].className).not.toContain('border-dashed')
  })
})

describe('Banner icon', () => {
  it('replaces the tone glyph but keeps the tone colour', () => {
    const { container } = render(<Banner tone="warning" icon={Info} title="Rate is 14 days old" />)
    const svg = container.querySelector('svg')!
    expect(svg.classList.contains('lucide-info')).toBe(true)
    expect(svg.getAttribute('class')).toContain('text-tone-warning-fg')
  })
})
