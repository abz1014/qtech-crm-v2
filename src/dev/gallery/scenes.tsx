import { useEffect, useRef, useState, type ReactNode } from 'react'
import { SceneFrame } from '@/dev/gallery/layout'
import { z } from 'zod'
import { Building2, CalendarDays, Copy, FileText, ListFilter, Package, Mail, MessageSquare, Plus, Send, Trash2 } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { Banner } from '@/ui/Banner'
import { Breadcrumb } from '@/ui/Breadcrumb'
import { Button } from '@/ui/Button'
import { CommandPalette } from '@/ui/CommandPalette'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Callout, InlineConfirm } from '@/ui/Inline'
import { ToastProvider } from '@/ui/Toast'
import { ToggleButton } from '@/ui/ToggleButton'
import { useToast } from '@/ui/useToast'
import type { AddedFile } from '@/lib/fileIntake'
import { Checkbox } from '@/ui/form/Checkbox'
import { FileDrop } from '@/ui/form/FileDrop'
import { FileRow } from '@/ui/form/FileRow'
import { Radio, RadioGroup } from '@/ui/form/Radio'
import { Combobox, type ComboOption } from '@/ui/form/Combobox'
import { DateInput } from '@/ui/form/DateInput'
import { Field } from '@/ui/form/Field'
import { Form, FormField } from '@/ui/form/Form'
import { NumberInput } from '@/ui/form/NumberInput'
import { Select } from '@/ui/form/Select'
import { TextArea, TextField } from '@/ui/form/TextField'
import { useSubmitForm } from '@/ui/form/useSubmitForm'
import type { PaletteSource } from '@/ui/paletteSources'
import { filterItems } from '@/ui/paletteSources'
import { MenuItem, MenuSeparator, Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { Tab, TabList, TabPanel, Tabs } from '@/ui/Tabs'
import { Tooltip } from '@/ui/Tooltip'

/* eslint-disable react-refresh/only-export-components -- a dev page, not a hot-reloaded module */
/*
 * Overlay and interaction scenes for /dev/gallery (U09). Dialogs, the palette and toasts cannot sit
 * on the page beside everything else, so each is rendered on its own at /dev/gallery?scene=<name>.
 * The gallery page links every scene; the Playwright suites visit each one.
 */
const Ghost = () => (
  <div aria-hidden="true" className="fixed inset-0 grid content-start gap-3 bg-canvas p-6">
    {[28, 90, 70, 80, 45].map((w, i) => (
      <div key={i} className="h-[14px] rounded bg-selected" style={{ width: `${w}%` }} />
    ))}
  </div>
)

const noop = () => {}

function DialogDefault({ state }: { state: 'default' | 'busy' | 'error' | 'confirm' | 'long' }) {
  const busy = state === 'busy'
  if (state === 'confirm') {
    return (
      <Dialog open onOpenChange={noop}>
        <DialogContent
          size="sm"
          title="Delete this question?"
          context="Question 2 on RFQ-0177"
          icon={Trash2}
          tone="danger"
          footer={
            <>
              <Button data-cancel>Cancel</Button>
              <Button variant="danger" icon={Trash2}>
                Delete question
              </Button>
            </>
          }
        >
          <p>“Fluid temperature range” and its answer are removed. The photo attached to the answer stays on the RFQ.</p>
        </DialogContent>
      </Dialog>
    )
  }
  if (state === 'long') {
    return (
      <Dialog open onOpenChange={noop}>
        <DialogContent
          size="lg"
          title="Quotation terms"
          context="Applies to every new quotation"
          lead="Body scrolls. Header and footer stay."
          className="max-h-[420px]"
          footer={
            <>
              <Button>Cancel</Button>
              <Button variant="primary">Save</Button>
            </>
          }
        >
          {[
            'Prices are in PKR and exclusive of sales tax unless stated.',
            'Delivery is ex-works Karachi unless stated.',
            'Payment: advance with order, balance against delivery.',
            'Warranty is as per the manufacturer’s terms.',
            'Prices are valid for the number of days shown on the quotation.',
            'Cancellation after the supplier has confirmed the order may carry a charge.',
          ].map((t, i) => (
            <p key={t}>{`${i + 1}. ${t}`}</p>
          ))}
        </DialogContent>
      </Dialog>
    )
  }
  return (
    <Dialog open onOpenChange={noop} busy={busy}>
      <DialogContent
        title="Mark as floated"
        context={
          <>
            <span className="num">RFQ-0177</span> · Indus Textile Mills
          </>
        }
        icon={Send}
        tone="info"
        footer={
          <>
            <Button data-cancel disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" busy={busy} busyLabel="Marking">
              {state === 'error' ? 'Try again' : 'Mark as floated'}
            </Button>
          </>
        }
      >
        {state === 'error' ? (
          <Banner tone="danger" title="Couldn’t mark the suppliers">
            Nothing was changed. Check your connection and try again.
          </Banner>
        ) : null}
        <p>
          {state === 'error'
            ? 'Four suppliers on the shortlist will be marked as sent today.'
            : 'Four suppliers on the shortlist will be marked as sent today. No message is sent from here.'}
        </p>
      </DialogContent>
    </Dialog>
  )
}

const companySchema = z.object({
  name: z.string().trim().min(1, 'Enter the company name.'),
  city: z.string().min(1, 'Choose a city.'),
  role: z.string(),
  ntn: z.string().optional(),
})
type CompanyIn = z.input<typeof companySchema>

export function CompanyForm({ mode }: { mode: 'validation' | 'unique' | 'submitting' | 'failure' | 'resting' }) {
  const sf = useSubmitForm({
    schema: companySchema,
    entity: 'company',
    defaultValues: {
      name: mode === 'unique' ? 'Indus Textile Mills' : mode === 'submitting' ? 'Mehran Paper Board' : '',
      city: mode === 'validation' ? '' : 'Hyderabad',
      role: 'customer',
      ntn: '1234567-8',
    },
    onSubmit: () => {
      if (mode === 'submitting') return new Promise<void>(noop)
      if (mode === 'failure') return Promise.reject(new TypeError('Failed to fetch'))
      return Promise.reject({ code: '23505', message: 'duplicate key value violates unique constraint "companies_name_key"' })
    },
    routeError: e =>
      e.kind === 'unique'
        ? { field: 'name', message: 'A company called Indus Textile Mills already exists. Open it, or add a second site to it instead.' }
        : undefined,
  })
  const submitRef = useRef(sf.submit)
  submitRef.current = sf.submit
  useEffect(() => {
    if (mode !== 'resting') void submitRef.current()
  }, [mode])
  return (
    <div className="w-[427px] max-w-full rounded border bg-surface">
      <div className="p-5">
        <Form sf={sf} labels={{ name: 'Company name', city: 'City' }}>
          <FormField<CompanyIn, 'name'>
            name="name"
            label="Company name"
            requirement="required"
            renderError={m => (
              m.includes('Open it') ? (
                <>
                  {m.split('Open it')[0]}
                  <a href="#existing" className="underline underline-offset-2">
                    Open it
                  </a>
                  {m.split('Open it')[1]}
                </>
              ) : (
                m
              )
            )}
          >
            {f => <TextField {...f} />}
          </FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField<CompanyIn, 'city'> name="city" label="City" requirement="required">
              {f => (
                <Select
                  {...f}
                  placeholder="Choose a city"
                  options={[
                    { value: 'Hyderabad', label: 'Hyderabad' },
                    { value: 'Karachi', label: 'Karachi' },
                  ]}
                />
              )}
            </FormField>
            <FormField<CompanyIn, 'role'> name="role" label="Role">
              {f => (
                <SegmentedControl
                  aria-label="Role"
                  fill
                  value={f.value}
                  onValueChange={f.onChange}
                  options={[
                    { value: 'customer', label: 'Customer' },
                    { value: 'supplier', label: 'Supplier' },
                    { value: 'both', label: 'Both' },
                  ]}
                />
              )}
            </FormField>
          </div>
          <FormField<CompanyIn, 'ntn'> name="ntn" label="NTN" requirement="optional">
            {f => <TextField {...f} value={f.value ?? ''} />}
          </FormField>
        </Form>
      </div>
      <div className="flex justify-end gap-2 border-t bg-sunken px-5 py-3">
        <Button disabled={sf.pending}>Cancel</Button>
        <Button type="submit" form={sf.formId} variant="primary" busy={sf.pending} busyLabel="Saving">
          {sf.failed && mode === 'failure' ? 'Try again' : 'Add company'}
        </Button>
      </div>
    </div>
  )
}

const COMPANIES: ComboOption[] = [
  { value: 'itm', label: 'Indus Textile Mills', meta: 'Faisalabad · customer' },
  { value: 'ivt', label: 'Indus Valve Traders', meta: 'Karachi · supplier' },
]

export function ComboScene() {
  const [co, setCo] = useState<string | null>(null)
  return (
    <div className="grid w-[427px] max-w-full gap-2 rounded border bg-surface p-5">
      <Field label="Company">
        <Combobox
          options={COMPANIES}
          value={co}
          onChange={setCo}
          onCreate={noop}
          createLabel={t => `Add “${t}” as a new company`}
          data-preview-combo
        />
      </Field>
      <div className="h-[130px]" />
    </div>
  )
}

export function Controls() {
  const [rate, setRate] = useState<number | null>(278.4)
  const [a, setA] = useState(true)
  return (
    <div className="grid w-full gap-6 rounded border bg-surface p-6 grid-cols-1 md:grid-cols-3">
      <div className="grid content-start gap-4">
        <Field label="Default">
          <TextField placeholder="Placeholder, 5.7:1" />
        </Field>
        <Field label="Filled">
          <TextField defaultValue="Karachi Glassworks" />
        </Field>
        <Field label="Focus">
          <TextField defaultValue="Karachi Glassworks" data-preview-focus />
        </Field>
      </div>
      <div className="grid content-start gap-4">
        <Field label="Invalid" error="Customer ref must start with RFQ.">
          <TextField defaultValue="74037" />
        </Field>
        <Field label="Disabled">
          <TextField defaultValue="RFQ-0177" disabled />
        </Field>
        <Field label="Read only">
          <TextField defaultValue="RFQ-0177" readOnly />
        </Field>
        <Field label="Numeric, mono">
          <NumberInput value={rate} onChange={setRate} decimals={2} suffix="PKR per USD" />
        </Field>
      </div>
      <div className="grid content-start gap-4">
        <Field label="Select">
          <Select options={[{ value: 'c', label: 'Customer' }]} defaultValue="c" />
        </Field>
        <Field label="Text area" requirement="optional">
          <TextArea defaultValue="Spec to be confirmed with the customer." />
        </Field>
        <Checkbox label="Float to supplier shortlist" checked={a} onCheckedChange={v => setA(v === true)} />
        <Checkbox label="Include item 4" />
        <Checkbox label="Disabled option" disabled />
        <RadioGroup aria-label="Role" defaultValue="customer" className="gap-[10px]">
          <Radio value="customer" label="Customer" />
          <Radio value="supplier" label="Supplier" />
        </RadioGroup>
      </div>
    </div>
  )
}

const places = [
  { id: 'rfq', label: 'Indus Textile Mills — Faisalabad · RFQ-0177', meta: 'RFQ · bid due Tue 1 Dec', icon: FileText, href: '/rfqs/177' },
  { id: 'po', label: 'PO 253102 · Indus Valve Traders', meta: 'Order · goods late', icon: Package, href: '/orders/2' },
  { id: 'co1', label: 'Indus Textile Mills — Faisalabad', meta: 'Company · customer', icon: Building2, href: '/companies/3' },
  { id: 'co2', label: 'Indus Valve Traders', meta: 'Company · supplier', icon: Building2, href: '/companies/4' },
]
const previewSources: PaletteSource[] = [
  { id: 'places', group: 'Jump to', order: 1, idle: () => places.slice(0, 1), search: q => filterItems(places, q) },
  {
    id: 'actions',
    group: 'Actions',
    order: 2,
    idle: () => [
      { id: 'new', label: 'New RFQ', meta: 'Go to intake', icon: Plus, shortcut: ['N'], onSelect: noop },
      { id: 'cap', label: 'Capture a message or photo', shortcut: ['C'], onSelect: noop },
    ],
    search: q => filterItems([{ id: 'new', label: 'New RFQ for Indus Textile Mills', meta: 'Go to intake', icon: Plus, onSelect: noop }], q),
  },
]

function Palette() {
  const [open, setOpen] = useState(true)
  return (
    <>
      <Ghost />
      <CommandPalette open={open} onOpenChange={setOpen} sources={previewSources} onNavigate={noop} emptyHint="Search covers RFQs, orders, companies and items. Try one word, or press N to start an RFQ." />
    </>
  )
}

export function Misc() {
  const [ch, setCh] = useState('whatsapp')
  const [stateSeg, setStateSeg] = useState('selected')
  const [filter, setFilter] = useState('all')
  const [role, setRole] = useState('customer')
  return (
    <div className="grid w-full gap-6 rounded border bg-surface p-6">
      <section className="grid gap-3">
        <h2 className="text-base font-semibold">Segmented control</h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="grid gap-3">
            <SegmentedControl aria-label="Message channel" value={ch} onValueChange={setCh} options={[{ value: 'whatsapp', label: 'WhatsApp', icon: MessageSquare }, { value: 'email', label: 'Email', icon: Mail }]} />
          </div>
          <SegmentedControl
            aria-label="States"
            value={stateSeg}
            onValueChange={setStateSeg}
            fill
            options={[
              { value: 'resting', label: 'Resting' },
              { value: 'hover', label: 'Hover' },
              { value: 'selected', label: 'Selected' },
              { value: 'focus', label: 'Focus' },
              { value: 'disabled', label: 'Disabled', disabled: true },
            ]}
          />
          <div className="grid gap-3">
            <SegmentedControl
              aria-label="Filter"
              value={filter}
              onValueChange={setFilter}
              options={[
                { value: 'all', label: 'All', count: 9 },
                { value: 'bids', label: 'Bids', count: 3 },
                { value: 'chases', label: 'Chases', count: 4 },
                { value: 'orders', label: 'Orders', count: 2 },
              ]}
            />
            <SegmentedControl large fill aria-label="Role" value={role} onValueChange={setRole} options={[{ value: 'customer', label: 'Customer' }, { value: 'supplier', label: 'Supplier' }, { value: 'both', label: 'Both' }]} />
          </div>
        </div>
      </section>
      <section className="grid gap-3">
        <h2 className="text-base font-semibold">Tabs and breadcrumb</h2>
        <Tabs defaultValue="suppliers" className="max-w-[420px]">
          <TabList aria-label="RFQ sections">
            <Tab value="items">Items</Tab>
            <Tab value="suppliers" data-preview-tab>
              Suppliers
            </Tab>
            <Tab value="questions" count={2}>
              Questions
            </Tab>
            <Tab value="history">History</Tab>
          </TabList>
          <TabPanel value="suppliers">Supplier rows</TabPanel>
        </Tabs>
        <Breadcrumb items={[{ label: 'RFQs', to: '/rfqs' }, { label: 'RFQ-0177', to: '/rfqs/177', mono: true }, { label: 'Item 2' }]} />
      </section>
    </div>
  )
}

export function Overlays() {
  return (
    <div className="grid w-[420px] max-w-full gap-3 rounded border bg-surface p-6">
      <section className="grid gap-3 pb-[170px]">
        <div className="flex flex-wrap items-start gap-6">
          <Tooltip content="Capture" shortcut="C" side="bottom">
            <Button icon={Copy} aria-label="Capture" variant="secondary" data-preview-tip />
          </Tooltip>
          <Popover>
            <PopoverTrigger asChild>
              <Button data-preview-menu>Snooze</Button>
            </PopoverTrigger>
            <PopoverContent variant="menu" aria-label="Snooze options">
              <MenuItem hint="Sat 28 Nov">Snooze to tomorrow</MenuItem>
              <MenuItem hint="Mon 30 Nov">Snooze to Monday</MenuItem>
              <MenuItem hint={<CalendarDays size={14} />}>Pick a date</MenuItem>
              <MenuSeparator />
              <MenuItem>Stop reminding me</MenuItem>
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <Button data-preview-info>Indus Valve Traders</Button>
            </PopoverTrigger>
            <PopoverContent aria-label="Supplier summary">
              <p className="font-medium">Indus Valve Traders</p>
              <p className="mt-2 text-fg-muted">
                Quoted <b className="num font-medium text-fg">4</b> of <b className="num font-medium text-fg">6</b> enquiries · last reply 3 Oct
              </p>
            </PopoverContent>
          </Popover>
        </div>
      </section>
    </div>
  )
}

/** Record payment: pre-filled amount and date with where they came from (g2-money.html, FE-2). */
function MoneyDialog() {
  const sf = useSubmitForm({
    schema: z.object({ amount: z.number().min(1), on: z.string().min(1) }),
    defaultValues: { amount: 1600764, on: businessToday() },
    onSubmit: noop,
  })
  type In = { amount: number; on: string }
  return (
    <Dialog open onOpenChange={noop}>
      <DialogContent
        title="Record payment"
        context={
          <>
            <span className="num">ORD-0038</span> · Punjab Cement Ltd
          </>
        }
        size="md"
        className="md:w-[520px]"
        footer={
          <>
            <Button variant="quiet">Cancel</Button>
            <Button type="submit" form={sf.formId} variant="primary">
              Save payment
            </Button>
          </>
        }
      >
        <Form sf={sf}>
          <div className="grid grid-cols-2 gap-4">
            <FormField<In, 'amount'> name="amount" label="Amount received, PKR" source="Balance due on ORD-0038">
              {f => <NumberInput {...f} />}
            </FormField>
            <FormField<In, 'on'> name="on" label="Date received" source={{ label: 'Today', plain: true }}>
              {f => <DateInput {...f} />}
            </FormField>
          </div>
        </Form>
        <p className="text-xs text-fg-muted">Add a reference, optional: transfer or cheque number.</p>
      </DialogContent>
    </Dialog>
  )
}

function ToastScene({ kind }: { kind: 'undo' | 'error' | 'settled' | 'plain' }) {
  const { toast } = useToast()
  const fired = useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    if (kind === 'undo') toast({ title: 'Marked floated', body: '4 suppliers · RFQ-0177', tone: 'success', undo: { onUndo: noop } })
    if (kind === 'settled') toast({ title: 'Marked floated', undo: { onUndo: noop, seconds: 1, settledTitle: 'Floated to 4 suppliers', settledBody: 'Sent today, Fri 27 Nov' } })
    if (kind === 'error') toast({ title: 'Couldn’t save the answer', body: 'Nothing was changed.', tone: 'danger', action: { label: 'Try again', onClick: noop } })
    if (kind === 'plain') toast({ title: 'Copied', body: 'Message is on your clipboard', tone: 'success' })
  }, [kind, toast])
  return <div className="h-[60px]" />
}

export function Feedback() {
  const [on, setOn] = useState(true)
  return (
    <div className="grid w-full gap-6 rounded border bg-surface p-6 grid-cols-1 md:grid-cols-2">
      <div className="grid content-start gap-3">
        <div className="flex flex-wrap gap-2">
          <ToggleButton pressed={false} onPressedChange={noop} icon={ListFilter}>
            Lowest only
          </ToggleButton>
          <ToggleButton pressed={on} onPressedChange={setOn} icon={ListFilter}>
            Lowest only
          </ToggleButton>
          <ToggleButton pressed={false} onPressedChange={noop} icon={ListFilter} disabled>
            Disabled
          </ToggleButton>
        </div>
      </div>
      <div className="grid content-start gap-3">
        <Callout title="No message is sent from here.">The text is copied and you send it yourself in WhatsApp or email.</Callout>
      </div>
      <div className="grid content-start gap-3">
        <InlineConfirm onUndo={noop}>Copied. Marked as chased today, Fri 27 Nov.</InlineConfirm>
        <InlineConfirm variant="line">Chased Fri 27 Nov</InlineConfirm>
      </div>
    </div>
  )
}

export function Files({ mode }: { mode: 'resting' | 'rows' }) {
  const [rows] = useState<AddedFile[]>([
    { id: '1', file: new File([new Uint8Array(640 * 1024)], 'nameplate-flowmeter.jpg', { type: 'image/jpeg' }), originalSize: 3.8 * 1024 * 1024 },
    { id: '2', file: new File([new Uint8Array(10)], 'datasheet-scan.pdf', { type: 'application/pdf' }), originalSize: 0, error: '7.2 MB. The limit is 5 MB.' },
  ])
  return mode === 'resting' ? (
    <div className="w-[427px] max-w-full">
      <FileDrop onAdd={noop} />
    </div>
  ) : (
    <div className="grid w-[427px] max-w-full gap-2">
      {rows.map(r => (
        <FileRow key={r.id} item={r} onRemove={noop} />
      ))}
    </div>
  )
}

/** Scene name to what it renders. The order is the order on the gallery page. */
export const SCENES: Record<string, { label: string; group: string; node: () => ReactNode }> = {
  'dialog-default': { group: 'Dialog', label: 'Default', node: () => (<><Ghost /><DialogDefault state="default" /></>) },
  'dialog-busy': { group: 'Dialog', label: 'Busy', node: () => (<><Ghost /><DialogDefault state="busy" /></>) },
  'dialog-error': { group: 'Dialog', label: 'With error', node: () => (<><Ghost /><DialogDefault state="error" /></>) },
  'dialog-confirm': { group: 'Dialog', label: 'Destructive confirm', node: () => (<><Ghost /><DialogDefault state="confirm" /></>) },
  'dialog-long': { group: 'Dialog', label: 'Long body scrolls', node: () => (<><Ghost /><DialogDefault state="long" /></>) },
  'dialog-money': { group: 'Dialog', label: 'Record payment (pre-filled, with source)', node: () => (<><Ghost /><MoneyDialog /></>) },
  'palette-idle': { group: 'Command palette', label: 'Idle: recent, actions, jump to', node: () => <Palette /> },
  'palette-typing': { group: 'Command palette', label: 'Searching', node: () => <Palette /> },
  'palette-empty': { group: 'Command palette', label: 'No results', node: () => <Palette /> },
  'toast-undo': { group: 'Toast', label: 'With Undo (10 s)', node: () => <ToastHost kind="undo" /> },
  'toast-settled': { group: 'Toast', label: 'Settled after the countdown', node: () => <ToastHost kind="settled" /> },
  'toast-error': { group: 'Toast', label: 'Error with retry', node: () => <ToastHost kind="error" /> },
  'toast-plain': { group: 'Toast', label: 'Plain', node: () => <ToastHost kind="plain" /> },
  'combobox-open': { group: 'Combobox', label: 'Open with the Add new row', node: () => <ComboScene /> },
  'overlays': { group: 'Tooltip and Popover', label: 'Tooltip, menu and information popover', node: () => <Overlays /> },
}

function ToastHost({ kind }: { kind: 'undo' | 'error' | 'settled' | 'plain' }) {
  return (
    <ToastProvider>
      <ToastScene kind={kind} />
    </ToastProvider>
  )
}

export function SceneView({ name }: { name: string }) {
  const scene = SCENES[name]
  if (!scene) return <p className="p-6 text-sm">No scene called {name}.</p>
  return (
    <SceneFrame title={`${scene.group}: ${scene.label}`}>{scene.node()}</SceneFrame>
  )
}
