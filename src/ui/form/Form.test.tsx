import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { businessToday } from '@/lib/dates'
import { formatDateText } from '@/lib/dateInput'
import { axeViolations } from '@/test/axe'
import { Button } from '@/ui/Button'
import { DateInput } from '@/ui/form/DateInput'
import { Form, FormField } from '@/ui/form/Form'
import { useSubmitForm, type SubmitContext } from '@/ui/form/useSubmitForm'
import { NumberInput } from '@/ui/form/NumberInput'
import { TextField } from '@/ui/form/TextField'

const schema = z.object({
  name: z.string().trim().min(1, 'Enter the company name.'),
  amount: z.number({ invalid_type_error: 'Enter an amount.', required_error: 'Enter an amount.' }).min(1, 'Enter an amount.'),
  on: z.string().min(1, 'Choose a date.'),
})
type In = z.input<typeof schema>

type Save = (v: z.output<typeof schema>, ctx: SubmitContext) => Promise<unknown>

function Harness({ save, defaults }: { save: Save; defaults?: Partial<In> }) {
  const sf = useSubmitForm({
    schema,
    entity: 'company',
    defaultValues: { name: '', amount: 1600764, on: businessToday(), ...defaults },
    onSubmit: save,
    routeError: e =>
      e.kind === 'unique'
        ? { field: 'name', message: 'A company called Indus Textile Mills already exists. Open it, or add a second site to it instead.' }
        : undefined,
  })
  return (
    <>
      <Form sf={sf} labels={{ name: 'Company name', amount: 'Amount' }}>
        <FormField<In, 'name'> name="name" label="Company name" requirement="required">
          {f => <TextField {...f} />}
        </FormField>
        <FormField<In, 'amount'> name="amount" label="Amount received, PKR" source="Balance due on ORD-0038">
          {f => <NumberInput {...f} />}
        </FormField>
        <FormField<In, 'on'> name="on" label="Date received" source={{ label: 'Today', plain: true }}>
          {f => <DateInput {...f} />}
        </FormField>
      </Form>
      <Button type="submit" form={sf.formId} variant="primary" busy={sf.pending} busyLabel="Saving">
        {sf.failed ? 'Try again' : 'Add company'}
      </Button>
    </>
  )
}

describe('Form (U07): submit guard', () => {
  it('a double click makes one request', async () => {
    const user = userEvent.setup()
    let resolve!: () => void
    const save = vi.fn<Save>(() => new Promise<void>(r => (resolve = r)))
    render(<Harness save={save} defaults={{ name: 'Mehran Paper Board' }} />)
    await user.dblClick(screen.getByRole('button', { name: 'Add company' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    // Enter in a field while the request is in flight is dropped too
    await user.type(screen.getByLabelText(/Company name/), '{Enter}')
    expect(save).toHaveBeenCalledTimes(1)
    resolve()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add company' })).toBeEnabled())
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('is aria-disabled and busy while pending, keeps focus, and every control is locked', async () => {
    const user = userEvent.setup()
    let resolve!: () => void
    render(<Harness save={() => new Promise<void>(r => (resolve = r))} defaults={{ name: 'Mehran Paper Board' }} />)
    await user.click(screen.getByRole('button', { name: 'Add company' }))
    const busy = await screen.findByRole('button', { name: 'Saving' })
    // WCAG 2.4.3: not `disabled`, so focus is not dropped to <body>.
    expect(busy).not.toBeDisabled()
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    expect(busy).toHaveAttribute('aria-busy', 'true')
    expect(busy).toHaveFocus()
    const field = screen.getByLabelText(/Company name/)
    await user.type(field, 'XYZ')
    expect(field).toHaveValue('Mehran Paper Board')
    resolve()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add company' })).not.toHaveAttribute('aria-disabled'))
  })

  it('passes a client-generated request id; a retry with the same entries reuses it, changed entries get a new one', async () => {
    const user = userEvent.setup()
    const ids: string[] = []
    const save = vi
      .fn<Save>()
      .mockImplementationOnce(async (_v, c) => {
        ids.push(c.requestId)
        throw new TypeError('Failed to fetch')
      })
      .mockImplementationOnce(async (_v, c) => {
        ids.push(c.requestId)
        throw new TypeError('Failed to fetch')
      })
      .mockImplementation(async (_v, c) => {
        ids.push(c.requestId)
      })
    render(<Harness save={save} defaults={{ name: 'Mehran Paper Board' }} />)
    await user.click(screen.getByRole('button', { name: 'Add company' }))
    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(ids[1]).toBe(ids[0])
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/)

    await user.type(screen.getByLabelText(/Company name/), ' Ltd')
    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(3))
    expect(ids[2]).not.toBe(ids[0])
  })

  it('treats a duplicate on the primary key as already saved', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    function H() {
      const sf = useSubmitForm({
        schema,
        defaultValues: { name: 'X', amount: 5, on: businessToday() },
        onSubmit: async () => {
          throw { code: '23505', message: 'duplicate key value violates unique constraint "companies_pkey"' }
        },
        onSuccess,
      })
      return (
        <Form sf={sf}>
          <Button type="submit" variant="primary">
            Save
          </Button>
        </Form>
      )
    }
    render(<H />)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('Form (U07): errors keep the entries and speak plainly', () => {
  it('unique violation: the sentence appears on the field, the other entries stay', async () => {
    const user = userEvent.setup()
    const save = vi.fn<Save>().mockRejectedValue({ code: '23505', message: 'duplicate key value violates unique constraint "companies_name_key"' })
    render(<Harness save={save} defaults={{ name: 'Indus Textile Mills', amount: 4820 }} />)
    await user.click(screen.getByRole('button', { name: 'Add company' }))
    expect(await screen.findByText(/A company called Indus Textile Mills already exists/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Company name/)).toHaveValue('Indus Textile Mills')
    expect(screen.getByLabelText(/Amount received/)).toHaveValue('4,820')
    expect(screen.getByLabelText(/Company name/)).toHaveAttribute('aria-invalid', 'true')
  })

  it.each([
    ['23503', { code: '23503', message: 'x', details: 'Key (company_id)=(1) is not present in table "companies".' }, /no longer exists/],
    ['23514', { code: '23514', message: 'violates check constraint "c"' }, /not allowed/],
    ['P0001', { code: 'P0001', message: 'September 2026 is closed. An admin can reopen it.' }, /^September 2026 is closed\. An admin can reopen it\.$/],
  ])('%s shows a banner with a plain message and keeps what was typed', async (_c, err, text) => {
    const user = userEvent.setup()
    render(<Harness save={vi.fn<Save>().mockRejectedValue(err)} defaults={{ name: 'Mehran Paper Board' }} />)
    await user.click(screen.getByRole('button', { name: 'Add company' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Couldn't save the company")
    expect(screen.getByText(text)).toBeInTheDocument()
    expect(screen.getByLabelText(/Company name/)).toHaveValue('Mehran Paper Board')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
  })

  it('validation: summarises once at the top, each field says what to enter, focus goes to the first', async () => {
    const user = userEvent.setup()
    const save = vi.fn<Save>()
    render(<Harness save={save} defaults={{ name: '', amount: undefined }} />)
    await user.click(screen.getByRole('button', { name: 'Add company' }))
    expect(await screen.findByText('Fix 2 fields to continue')).toBeInTheDocument()
    expect(screen.getByText('Enter the company name.')).toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByLabelText(/Company name/)).toHaveFocus())
  })

  it('HW-21: a field missing from `labels` is named by its FormField label in the summary, never by its code name', async () => {
    const monthSchema = z.object({ startMonth: z.string().regex(/^\d{4}-\d{2}$/, 'Pick the month it starts.') })
    function MonthForm() {
      const sf = useSubmitForm({ schema: monthSchema, entity: 'expense', defaultValues: { startMonth: 'abc' }, onSubmit: vi.fn() })
      return (
        <>
          <Form sf={sf}>
            <FormField<z.input<typeof monthSchema>, 'startMonth'> name="startMonth" label="Starts in">
              {f => <TextField {...f} />}
            </FormField>
          </Form>
          <Button type="submit" form={sf.formId}>
            Save
          </Button>
        </>
      )
    }
    const user = userEvent.setup()
    render(<MonthForm />)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Fix 1 field to continue')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Starts in' })).toBeInTheDocument()
    expect(screen.queryByText(/startMonth/)).toBeNull()
    // HE-6: the summary repeats the field's own message, not a generic "needs a value" (the field has one)
    expect(screen.getByRole('alert').textContent ?? document.body.textContent).toMatch(/Starts in: Pick the month it starts\./)
    expect(screen.queryByText(/needs a value/)).toBeNull()
  })
})

describe('Form (U07): pre-filled values say where they came from (FE-2)', () => {
  it('shows the source, and "Typed by you" once the value is changed', async () => {
    const user = userEvent.setup()
    render(<Harness save={vi.fn<Save>()} />)
    expect(screen.getByText('Balance due on ORD-0038')).toBeInTheDocument()
    expect(screen.getByText('Today')).toBeInTheDocument()
    const amount = screen.getByLabelText(/Amount received/)
    expect(amount).toHaveValue('1,600,764')
    await user.clear(amount)
    await user.type(amount, '700000')
    expect(screen.queryByText('Balance due on ORD-0038')).toBeNull()
    expect(screen.getByText('Typed by you')).toBeInTheDocument()
  })

  it('the date defaults to today (business timezone) with no touch', () => {
    render(<Harness save={vi.fn<Save>()} />)
    expect(screen.getByLabelText('Date received')).toHaveValue(formatDateText(businessToday()))
  })

  it('has no axe violations', async () => {
    const { container } = render(<Harness save={vi.fn<Save>()} />)
    expect(await axeViolations(container)).toEqual([])
  })
})
