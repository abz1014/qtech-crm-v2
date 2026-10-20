import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRouteFocus } from '@/app/shell/useRouteFocus'
import { Button } from '@/ui/Button'
import { DataTable, type Column } from '@/ui/DataTable'
import { TableFilter } from '@/ui/TableFilter'
import { ShortcutsPanel } from '@/ui/TextSizeControl'
import { ToastProvider } from '@/ui/Toast'
import { useToast } from '@/ui/useToast'
import { Field } from '@/ui/form/Field'
import { TextField } from '@/ui/form/TextField'
import { rovingKeyDown, rovingTabIndex } from '@/ui/roving'
import { SINGLE_KEYS_KEY, setSingleKeyShortcuts, shortcutsEnabled } from '@/ui/useShortcutsSetting'

afterEach(() => {
  setSingleKeyShortcuts(true)
  vi.useRealTimers()
})

interface Row {
  id: string
  name: string
}
const ROWS: Row[] = [
  { id: 'a', name: 'Punjab Cement' },
  { id: 'b', name: 'Indus Textile' },
]
const cols: Column<Row>[] = [{ id: 'name', header: 'Name', value: r => r.name }]

describe('single-key shortcuts can be turned off (SC 2.1.4)', () => {
  it('the Settings switch stores "off" on this device and "/" no longer jumps to the filter', async () => {
    const user = userEvent.setup()
    render(
      <>
        <ShortcutsPanel />
        <DataTable label="Companies" columns={cols} rows={ROWS} getRowId={r => r.id} noun="companies" toolbar={<TableFilter label="Filter companies" value="" onChange={() => undefined} />} />
      </>,
    )
    const box = screen.getByRole('checkbox', { name: 'Single-key shortcuts on' })
    expect(box).toBeChecked()
    expect(shortcutsEnabled()).toBe(true)
    await user.click(box)
    expect(box).not.toBeChecked()
    expect(window.localStorage.getItem(SINGLE_KEYS_KEY)).toBe('off')
    expect(shortcutsEnabled()).toBe(false)
    const ev = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })
    act(() => void document.body.dispatchEvent(ev))
    expect(ev.defaultPrevented).toBe(false)
    expect(screen.getByLabelText('Filter companies')).not.toHaveFocus()
  })
})

describe('busy buttons keep focus (SC 2.4.3)', () => {
  it('is aria-disabled, focusable and ignores clicks while busy', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    function Harness() {
      const [busy, setBusy] = useState(false)
      return (
        <Button busy={busy} busyLabel="Saving" onClick={() => (onClick(), setBusy(true))}>
          Save
        </Button>
      )
    }
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const b = screen.getByRole('button', { name: 'Saving' })
    expect(b).toHaveFocus()
    expect(b).toHaveAttribute('aria-disabled', 'true')
    await user.click(b)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('route change (SC 2.4.3, 2.4.2)', () => {
  function Shell() {
    const navigate = useNavigate()
    return (
      <>
        <button onClick={() => navigate('/b')}>Go</button>
        <main id="main" tabIndex={-1}>
          <Routes>
            <Route path="/a" element={<h1>Page A</h1>} />
            <Route path="/b" element={<h1>RFQ-0177</h1>} />
          </Routes>
        </main>
      </>
    )
  }
  it('moves focus to the new h1, resets the scroll and titles the tab after the page', async () => {
    const user = userEvent.setup()
    function Probe() {
      const [p, setP] = useState('/a')
      useRouteFocus(p, 'RFQs')
      return <button onClick={() => setP('/b')}>Change</button>
    }
    render(
      <MemoryRouter initialEntries={['/a']}>
        <Shell />
        <Probe />
      </MemoryRouter>,
    )
    expect(document.title).toBe('Page A · RFQs · Q-Tech CRM')
    const main = document.getElementById('main')!
    main.scrollTop = 200
    await user.click(screen.getByRole('button', { name: 'Go' }))
    await user.click(screen.getByRole('button', { name: 'Change' }))
    expect(main.scrollTop).toBe(0)
    expect(screen.getByRole('heading', { name: 'RFQ-0177' })).toHaveFocus()
    expect(document.title).toBe('RFQ-0177 · RFQs · Q-Tech CRM')
  })
})

describe('Required is exposed (SC 1.3.1, 3.3.2)', () => {
  it('a Field marked required gives its control aria-required', () => {
    render(
      <Field label="Company name" requirement="required">
        <TextField />
      </Field>,
    )
    expect(screen.getByLabelText('Company name')).toHaveAttribute('aria-required', 'true')
  })
})

describe('filter counts are announced (SC 4.1.3)', () => {
  it('a polite live node says the new count after typing stops', () => {
    vi.useFakeTimers()
    function Harness() {
      const [q, setQ] = useState('')
      const rows = ROWS.filter(r => r.name.toLowerCase().includes(q))
      return (
        <>
          <input aria-label="q" value={q} onChange={e => setQ(e.target.value)} />
          <DataTable label="Companies" columns={cols} rows={rows} getRowId={r => r.id} noun="companies" total={ROWS.length} />
        </>
      )
    }
    const { container } = render(<Harness />)
    const live = container.querySelector('[data-table-count]')!
    expect(live).toHaveAttribute('aria-live', 'polite')
    expect(live.textContent).toBe('')
    fireEvent.change(screen.getByLabelText('q'), { target: { value: 'indus' } })
    act(() => void vi.advanceTimersByTime(600))
    expect(live.textContent).toBe('Showing 1 of 2 companies')
  })
})

describe('toasts (SC 4.1.3)', () => {
  it('sit in one persistent polite region; the countdown is hidden and Control+Z is named', () => {
    function Fire() {
      const { toast } = useToast()
      return <button onClick={() => toast({ title: 'Floated', undo: { onUndo: () => undefined } })}>Fire</button>
    }
    const { container } = render(
      <ToastProvider>
        <Fire />
      </ToastProvider>,
    )
    const live = container.ownerDocument.querySelector('[data-toast-live]')!
    expect(live).toHaveAttribute('aria-live', 'polite')
    fireEvent.click(screen.getByRole('button', { name: 'Fire' }))
    const card = screen.getByRole('status')
    expect(live).toContainElement(card)
    expect(card).toHaveAttribute('aria-live', 'off')
    expect(card).toHaveTextContent('or press Control+Z')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
  })
})

describe('roving arrows (SC 2.1.1)', () => {
  it('one Tab stop; arrows move and, in a radiogroup, choose', () => {
    const pick = vi.fn()
    function Group() {
      const [v, setV] = useState(-1)
      return (
        <div role="radiogroup" aria-label="RFQ" onKeyDown={e => rovingKeyDown(e, { item: '[role=radio]', select: true })}>
          {['A', 'B', 'C'].map((l, i) => (
            <button key={l} role="radio" aria-checked={v === i} tabIndex={rovingTabIndex(i, v)} onClick={() => (pick(l), setV(i))}>
              {l}
            </button>
          ))}
        </div>
      )
    }
    render(<Group />)
    const [a, b, c] = screen.getAllByRole('radio')
    expect([a.tabIndex, b.tabIndex, c.tabIndex]).toEqual([0, -1, -1])
    act(() => a.focus())
    fireEvent.keyDown(a, { key: 'ArrowDown' })
    expect(b).toHaveFocus()
    expect(pick).toHaveBeenLastCalledWith('B')
    fireEvent.keyDown(b, { key: 'End' })
    expect(c).toHaveFocus()
    fireEvent.keyDown(c, { key: 'ArrowDown' })
    expect(a).toHaveFocus()
  })
})
