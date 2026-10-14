import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { axeViolations } from '@/test/axe'
import { Checkbox } from '@/ui/form/Checkbox'
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
