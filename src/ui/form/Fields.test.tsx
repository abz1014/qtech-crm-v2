import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { axeViolations } from '@/test/axe'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { businessToday } from '@/lib/dates'
import { formatDateText } from '@/lib/dateInput'
import { Checkbox } from '@/ui/form/Checkbox'
import { DateInput } from '@/ui/form/DateInput'
import { Combobox, type ComboOption } from '@/ui/form/Combobox'
import { Field } from '@/ui/form/Field'
import { NumberInput } from '@/ui/form/NumberInput'
import { Select } from '@/ui/form/Select'
import { TextArea, TextField } from '@/ui/form/TextField'

const COMPANIES: ComboOption[] = [
  { value: 'itm', label: 'Indus Textile Mills', meta: 'Faisalabad · customer' },
  { value: 'ivt', label: 'Indus Valve Traders', meta: 'Karachi · supplier' },
  { value: 'pcl', label: 'Punjab Cement Ltd', meta: 'Lahore · customer' },
]

function ComboDemo({ onCreate }: { onCreate?: (t: string) => void }) {
  const [v, setV] = useState<string | null>(null)
  return (
    <Field label="Company">
      <Combobox options={COMPANIES} value={v} onChange={setV} onCreate={onCreate} createLabel={t => `Add “${t}” as a new company`} />
      <output data-testid="chosen">{v ?? 'none'}</output>
    </Field>
  )
}

describe('Combobox (U07)', () => {
  it('type-ahead filters, the first match is active, Enter picks it', async () => {
    const user = userEvent.setup()
    render(<ComboDemo />)
    const box = screen.getByRole('combobox', { name: 'Company' })
    await user.type(box, 'ind')
    const options = screen.getAllByRole('option')
    expect(options.map(o => o.textContent)).toEqual(['Indus Textile MillsFaisalabad · customer', 'Indus Valve TradersKarachi · supplier'])
    expect(box).toHaveAttribute('aria-activedescendant', options[0].id)
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('chosen')).toHaveTextContent('itm')
    expect(box).toHaveValue('Indus Textile Mills')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('arrow keys move, Esc closes only the list and keeps the choice, Tab leaves without picking', async () => {
    const user = userEvent.setup()
    render(<ComboDemo />)
    const box = screen.getByRole('combobox')
    await user.type(box, 'indus')
    await user.keyboard('{ArrowDown}')
    expect(box).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[1].id)
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('chosen')).toHaveTextContent('ivt')

    await user.clear(box)
    await user.type(box, 'pun')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(box).toHaveValue('Indus Valve Traders') // reverted to the choice
    await user.tab()
    expect(screen.getByTestId('chosen')).toHaveTextContent('ivt')
  })

  it('offers "Add as a new company" for text that matches nothing exactly, and reports it', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    render(<ComboDemo onCreate={onCreate} />)
    await user.type(screen.getByRole('combobox'), 'Ind')
    const add = screen.getByRole('option', { name: /Add “Ind” as a new company/ })
    await user.click(add)
    expect(onCreate).toHaveBeenCalledWith('Ind')
    expect(screen.getByTestId('chosen')).toHaveTextContent('none')
  })

  it('says so when nothing matches', async () => {
    const user = userEvent.setup()
    render(<ComboDemo />)
    await user.type(screen.getByRole('combobox'), 'zzz')
    expect(screen.getByText('No match for “zzz”')).toBeInTheDocument()
  })

  it('has no axe violations open', async () => {
    const user = userEvent.setup()
    const { container } = render(<ComboDemo />)
    await user.type(screen.getByRole('combobox'), 'ind')
    expect(await axeViolations(container)).toEqual([])
  })
})

describe('NumberInput (U07)', () => {
  function Num({ decimals }: { decimals?: number }) {
    const [v, setV] = useState<number | null>(1600764)
    return (
      <Field label="Amount">
        <NumberInput value={v} onChange={setV} decimals={decimals} suffix={decimals ? 'PKR per USD' : undefined} />
        <output data-testid="n">{String(v)}</output>
      </Field>
    )
  }

  it('is mono, tabular and right aligned, and shows grouping at rest', () => {
    render(<Num />)
    const input = screen.getByLabelText('Amount')
    expect(input).toHaveValue('1,600,764')
    expect(input.className).toMatch(/\bnum\b/)
    expect(input.className).toMatch(/text-right/)
  })

  it('types raw, groups on blur, and reports a number', async () => {
    const user = userEvent.setup()
    render(<Num />)
    const input = screen.getByLabelText('Amount')
    await user.clear(input)
    await user.type(input, '2300764')
    expect(input).toHaveValue('2300764')
    expect(screen.getByTestId('n')).toHaveTextContent('2300764')
    await user.tab()
    expect(input).toHaveValue('2,300,764')
  })

  it('fixed decimals on blur, and junk reports null', async () => {
    const user = userEvent.setup()
    render(<Num decimals={2} />)
    const input = screen.getByLabelText('Amount')
    await user.clear(input)
    await user.type(input, '278.4')
    await user.tab()
    expect(input).toHaveValue('278.40')
    await user.clear(input)
    await user.type(input, 'abc')
    expect(screen.getByTestId('n')).toHaveTextContent('null')
  })

  it('leaving the field keeps typed text that is not a usable number (junk, or below min) on screen', async () => {
    function Min() {
      const [v, setV] = useState<number | null>(null)
      return (
        <Field label="Qty">
          <NumberInput value={v} onChange={setV} min={0} />
          <output data-testid="q">{String(v)}</output>
        </Field>
      )
    }
    const user = userEvent.setup()
    render(<Min />)
    const input = screen.getByLabelText('Qty')
    await user.type(input, '-5')
    await user.tab()
    expect(screen.getByTestId('q')).toHaveTextContent('null')
    expect(input).toHaveValue('-5')
    await user.clear(input)
    await user.type(input, '12abc')
    await user.tab()
    expect(input).toHaveValue('12abc')
  })

  it('still follows an outside change (form reset) after leaving the field', async () => {
    function Reset() {
      const [v, setV] = useState<number | null>(5)
      return (
        <Field label="Qty">
          <NumberInput value={v} onChange={setV} />
          <button type="button" onClick={() => setV(null)}>Reset</button>
        </Field>
      )
    }
    const user = userEvent.setup()
    render(<Reset />)
    const input = screen.getByLabelText('Qty')
    await user.clear(input)
    await user.type(input, '1200')
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(input).toHaveValue('')
  })
})

describe('Select, TextField, TextArea, Checkbox (U07)', () => {
  it('Field wires label, error and help to the control', async () => {
    render(
      <Field label="City" requirement="required" error="Choose a city." help="Where the site is.">
        <Select placeholder="Choose a city" options={[{ value: 'khi', label: 'Karachi' }]} />
      </Field>,
    )
    const select = screen.getByLabelText(/City/)
    expect(select).toHaveAttribute('aria-invalid', 'true')
    expect(select).toHaveAccessibleDescription('Choose a city. Where the site is.')
    expect(screen.getByText('Required')).toBeInTheDocument()
  })

  it('TextField has an adornment, TextArea an optional label; both are axe clean with Checkbox', async () => {
    const { container } = render(
      <>
        <Field label="Rate">
          <TextField suffix="PKR per USD" defaultValue="278.40" />
        </Field>
        <Field label="Notes" requirement="optional">
          <TextArea defaultValue="Spec to be confirmed with the customer." />
        </Field>
        <Checkbox label="Float to supplier shortlist" defaultChecked />
        <Checkbox label="Disabled option" disabled />
      </>,
    )
    expect(screen.getByText('PKR per USD')).toBeInTheDocument()
    expect(screen.getByText('Optional')).toBeInTheDocument()
    expect(await axeViolations(container)).toEqual([])
  })

  it('Checkbox toggles with Space and by its label', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Checkbox label="Include item 4" onCheckedChange={onChange} />)
    await user.tab()
    await user.keyboard(' ')
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(true))
    await user.click(screen.getByText('Include item 4'))
    expect(onChange).toHaveBeenLastCalledWith(false)
  })
})

describe('NumberInput keeps a pre-filled amount grouped (U07)', () => {
  it('on focus the amount stays "1,600,764" and is selected, so typing replaces it', async () => {
    const user = userEvent.setup()
    function N() {
      const [v, setV] = useState<number | null>(1600764)
      return (
        <Field label="Amount">
          <NumberInput value={v} onChange={setV} />
        </Field>
      )
    }
    render(<N />)
    const input = screen.getByLabelText('Amount') as HTMLInputElement
    await user.tab()
    expect(input).toHaveValue('1,600,764')
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('1,600,764'.length)
    await user.keyboard('700000')
    expect(input).toHaveValue('700000')
    await user.tab()
    expect(input).toHaveValue('700,000')
  })
})

describe('DateInput (U07)', () => {
  function D({ initial = '' }: { initial?: string }) {
    const [v, setV] = useState(initial)
    return (
      <Field label="Date received">
        <DateInput value={v} onChange={setV} />
        <output data-testid="iso">{v}</output>
      </Field>
    )
  }

  it('defaults to today and shows it as "Fri 27 Nov 2026"-style text, not a locale format', () => {
    render(<D />)
    expect(screen.getByLabelText('Date received')).toHaveValue(formatDateText(businessToday()))
    expect(screen.getByTestId('iso')).toHaveTextContent(businessToday())
    expect(screen.getByLabelText('Date received').getAttribute('type')).toBe('text')
  })

  it.each([
    ['27 nov', /^\d{4}-11-27$/],
    ['27/11', /^\d{4}-11-27$/],
    ['27/11/2026', /^2026-11-27$/],
    ['3/4/2026', /^2026-04-03$/],
    ['today', new RegExp('^' + businessToday() + '$')],
  ])('typing "%s" is read day-first on Enter', async (typed, expected) => {
    const user = userEvent.setup()
    render(<D initial="2026-01-01" />)
    const input = screen.getByLabelText('Date received')
    await user.click(input)
    await user.keyboard(typed + '{Enter}')
    expect(screen.getByTestId('iso').textContent).toMatch(expected)
    expect(input).toHaveValue(formatDateText(screen.getByTestId('iso').textContent))
  })

  it('"yesterday" is the day before the business today', async () => {
    const user = userEvent.setup()
    render(<D initial="2026-01-01" />)
    await user.click(screen.getByLabelText('Date received'))
    await user.keyboard('yesterday')
    await user.tab()
    const [y, m, d] = businessToday().split('-').map(Number)
    const prev = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)
    expect(screen.getByTestId('iso')).toHaveTextContent(prev)
  })

  it('text that is not a date stays on screen, marks the field invalid and reports an empty value', async () => {
    const user = userEvent.setup()
    render(<D initial="2026-01-01" />)
    const input = screen.getByLabelText('Date received')
    await user.click(input)
    await user.keyboard('31/02/2026')
    await user.tab()
    expect(input).toHaveValue('31/02/2026')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('iso').textContent).toBe('')
  })

  it('after unreadable text, an outside change (form reset) still replaces it and clears the invalid mark', async () => {
    function R() {
      const [v, setV] = useState('2026-01-01')
      return (
        <Field label="Date received">
          <DateInput value={v} onChange={setV} />
          <button type="button" onClick={() => setV('2026-03-05')}>Reset</button>
        </Field>
      )
    }
    const user = userEvent.setup()
    render(<R />)
    const input = screen.getByLabelText('Date received')
    await user.click(input)
    await user.keyboard('31/02/2026')
    await user.tab()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(input).toHaveValue(formatDateText('2026-03-05'))
    expect(input).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('has a calendar button for the native picker', () => {
    render(<D />)
    expect(screen.getByRole('button', { name: 'Choose date from calendar' })).toBeInTheDocument()
  })
})

describe('Combobox list is not clipped by a dialog (U07)', () => {
  it('renders the list in a portal outside the dialog body', async () => {
    const user = userEvent.setup()
    render(
      <Dialog open>
        <DialogContent title="Add contact">
          <Field label="Company">
            <Combobox options={COMPANIES} value={null} onChange={() => {}} />
          </Field>
        </DialogContent>
      </Dialog>,
    )
    const dlg = await screen.findByRole('dialog')
    await user.type(screen.getByRole('combobox'), 'ind')
    const list = await screen.findByRole('listbox')
    expect(dlg.contains(list)).toBe(false)
    await user.click(screen.getAllByRole('option')[1])
    expect(screen.getByRole('combobox')).toHaveValue('')
  })
})
