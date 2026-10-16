// Gallery sections for the primitives added after U09: DateRail, StepList, ProgressBar, InlineEditRow, the four
// EmptyState cards and the Tooltip variants (g2-components "Date rail", "More primitives", "Empty state", "Tooltip").
import { useState } from 'react'
import { ClipboardPaste, FileText, Info, Plus, Send } from 'lucide-react'
import { Panel, Section } from '@/dev/gallery/layout'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { DateRail, type DateRailState } from '@/ui/DateRail'
import { EmptyState } from '@/ui/EmptyState'
import { Select } from '@/ui/form/Select'
import { TextField } from '@/ui/form/TextField'
import { InlineEditRow, type InlineEditColumn } from '@/ui/InlineEditRow'
import { StatusBadge } from '@/ui/StatusBadge'
import { StepList } from '@/ui/StepList'
import { ProgressBar, ProgressSegments } from '@/ui/Tag'
import { Tooltip } from '@/ui/Tooltip'

const noop = () => {}

// ---------------------------------------------------------------- components-12: date rail
interface RailCase {
  title: string
  note: string
  state: DateRailState
  start: string
  due: string | null
  today: string
  doneOn?: string
  todayLabel?: string
}
const RAILS: RailCase[] = [
  { title: 'On track', note: 'Neutral. The marker is today, the fill is time already spent.', state: 'on-track', start: '2026-11-25', due: '2026-12-03', today: '2026-11-27' },
  { title: 'Due soon', note: 'Warning, as on Today B.', state: 'due-soon', start: '2026-11-21', due: '2026-12-01', today: '2026-11-27' },
  { title: 'Due today', note: 'Danger. The label flips to the left of the marker near the end.', state: 'due-today', start: '2026-11-23', due: '2026-11-27', today: '2026-11-27', todayLabel: 'Today · 17:00' },
  { title: 'Overdue', note: 'The track turns red and the label says how late.', state: 'overdue', start: '2026-11-15', due: '2026-11-24', today: '2026-11-27' },
  { title: 'Done', note: 'Success. Names the date it was done.', state: 'done', start: '2026-11-20', due: '2026-11-27', today: '2026-11-27', doneOn: '2026-11-25' },
  { title: 'No date', note: 'A dashed line and an honest label. No invented date.', state: 'no-date', start: '2026-11-20', due: null, today: '2026-11-27' },
]

export function DateRailSection() {
  return (
    <Section id="rail" title="DateRail" note="Where today sits between the day something started and the day it is due. Six states; dates are always real days.">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {RAILS.map(r => (
          <div key={r.title} className="grid content-start gap-3 rounded border bg-surface p-4">
            <div className="grid gap-1">
              <p className="text-sm font-medium">{r.title}</p>
              <p className="text-xs text-fg-muted">{r.note}</p>
            </div>
            <div className="rounded bg-canvas p-4">
              <DateRail start={r.start} due={r.due} today={r.today} doneOn={r.doneOn} todayLabel={r.todayLabel} state={r.state} className="[&_em]:ring-canvas" />
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------- components-13: more primitives
const IE_COLS: InlineEditColumn[] = [
  { width: 'minmax(0, 1.4fr)' },
  { width: '110px', align: 'right' },
  { width: '84px' },
  { width: '100px', align: 'right' },
  { width: '104px' },
]
const CURRENCIES = ['USD', 'EUR', 'CNY', 'AED'].map(c => ({ value: c, label: c }))
const STOCK = [
  { value: 'in-stock', label: 'In stock' },
  { value: 'to-order', label: 'To order' },
]

interface Reply {
  name: string
  price: string
  ccy: string
  lead: string
  stock: string
}

/** One supplier reply row, in whichever of the four states the gallery wants to show. */
function ReplyRow({ reply, start, error, saving }: { reply: Reply; start: 'resting' | 'editing'; error?: string; saving?: boolean }) {
  const [mode, setMode] = useState<'resting' | 'editing' | 'saving'>(saving ? 'saving' : start)
  const [price, setPrice] = useState(reply.price)
  const [ccy, setCcy] = useState(reply.ccy)
  const [lead, setLead] = useState(reply.lead)
  const [stock, setStock] = useState(reply.stock)
  const ro = mode === 'saving'
  const stockLabel = STOCK.find(s => s.value === stock)?.label
  return (
    <InlineEditRow
      columns={IE_COLS}
      label={reply.name}
      mode={mode}
      error={error}
      onEdit={() => setMode('editing')}
      onSave={() => setMode('resting')}
      onCancel={() => setMode('resting')}
      cells={[
        <b key="n" className="font-medium">{reply.name}</b>,
        <span key="p" className="num">{price}</span>,
        ccy,
        <span key="l" className="num">{lead}</span>,
        stockLabel,
      ]}
      editCells={[
        <b key="n" className="font-medium">{reply.name}</b>,
        <TextField key="p" aria-label={`Price, ${reply.name}`} className="num" value={price} readOnly={ro} aria-invalid={error ? true : undefined} onChange={e => setPrice(e.target.value)} />,
        ro ? ccy : <Select key="c" aria-label={`Currency, ${reply.name}`} options={CURRENCIES} value={ccy} onChange={e => setCcy(e.target.value)} />,
        <TextField key="l" aria-label={`Lead time, ${reply.name}`} className="num" value={lead} readOnly={ro} onChange={e => setLead(e.target.value)} />,
        ro ? stockLabel : <Select key="s" aria-label={`Stock, ${reply.name}`} options={STOCK} value={stock} onChange={e => setStock(e.target.value)} />,
      ]}
    />
  )
}

function InlineEditDemo() {
  const head = 'grid h-9 items-center gap-2 bg-sunken px-3 text-xs font-medium text-fg-muted'
  return (
    <div className="overflow-hidden rounded border bg-surface">
      <div className={head} style={{ gridTemplateColumns: [...IE_COLS.map(c => c.width), '60px'].join(' ') }} aria-hidden="true">
        <span>Supplier</span>
        <span className="text-right">Price</span>
        <span>Currency</span>
        <span className="text-right">Lead time (days)</span>
        <span>Stock</span>
        <span />
      </div>
      <ReplyRow start="resting" reply={{ name: 'Indus Valve Traders', price: '4,820.00', ccy: 'USD', lead: '14', stock: 'in-stock' }} />
      <ReplyRow start="editing" reply={{ name: 'Karachi Valve House', price: '3,120.00', ccy: 'USD', lead: '21', stock: 'to-order' }} />
      <ReplyRow start="editing" saving reply={{ name: 'Lahore Process Supplies', price: '1,200', ccy: 'USD', lead: '10', stock: 'in-stock' }} />
      <ReplyRow start="editing" error="Price must be a number, for example 4,820.00." reply={{ name: 'Chenab Instruments', price: 'abc', ccy: 'CNY', lead: '30', stock: 'to-order' }} />
    </div>
  )
}

export function MorePrimitivesSection() {
  return (
    <Section
      id="more"
      title="Progress, steps and inline editing"
      note="Progress bar and segments, the step list, and the row that is edited in place: resting, editing, saving, and a validation error under the row."
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel title="Progress: bar, segments and steps">
          <div className="grid gap-2">
            <ProgressBar done={3} total={5} label="3 of 5 items covered" />
            <p className="text-xs text-fg-muted">
              <span className="num">3</span> of <span className="num">5</span> items covered
            </p>
          </div>
          <ProgressSegments done={3} total={5} />
          <StepList
            label="Progress of RFQ-0177"
            steps={[
              { label: 'Floated to 4 suppliers', state: 'done', note: 'Mon 23 Nov' },
              { label: 'Waiting for quotes', state: 'now', note: '2 of 4 back' },
              { label: 'Bid sent', state: 'todo', note: 'due Tue 1 Dec' },
            ]}
          />
        </Panel>
        <Panel title="Banner with its own glyph">
          <Banner tone="info" icon={Send} title="Nothing has been sent">
            The text is copied and you send it yourself.
          </Banner>
          <Banner tone="warning" icon={Info} title="Rate is 14 days old">
            The tone keeps its colour; only the glyph changes.
          </Banner>
        </Panel>
      </div>
      <InlineEditDemo />
    </Section>
  )
}

// ---------------------------------------------------------------- components-09: empty state
export function EmptyCards() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      <EmptyState bordered mood="goal" title="Nothing is waiting on you">
        Every bid is in and every chase is up to date. The next date that matters is Tue 1 Dec.
      </EmptyState>
      <EmptyState
        bordered
        icon={FileText}
        title="No RFQs yet"
        actions={
          <>
            <Button variant="primary" icon={Plus}>New RFQ</Button>
            <Button icon={ClipboardPaste}>Capture a message</Button>
          </>
        }
      >
        Start one from a customer’s message, or paste the enquiry text and we will split it into items.
      </EmptyState>
      <EmptyState bordered title={'No companies match “Belimo”'} actions={<Button>Clear filter</Button>}>
        Belimo is a brand, not a company. Brands are on the company page of the agent who supplies them.
      </EmptyState>
      <EmptyState bordered mood="warning" title="Money is for admins and sales">
        Your role is Engineer. Ask an admin if you need to see invoices or receivables.
      </EmptyState>
    </div>
  )
}

// ---------------------------------------------------------------- components-10: tooltip variants
/** The five tooltip shapes. The e2e scenes focus each in turn (data-preview-* hooks). */
export function TooltipVariants() {
  return (
    <div className="grid w-full gap-6 sm:grid-cols-2 lg:grid-cols-3">
      <div className="grid content-start gap-2">
        <p className="text-sm font-medium">Icon button label</p>
        <Tooltip content="Capture" shortcut="C">
          <Button icon={ClipboardPaste} aria-label="Capture" />
        </Tooltip>
      </div>
      <div className="grid content-start gap-2" data-preview-disabled>
        <p className="text-sm font-medium">Why this is disabled</p>
        <Tooltip forDisabled content="Add the legal name and address in Settings before issuing a PDF.">
          <Button variant="primary" disabled>Issue quotation</Button>
        </Tooltip>
      </div>
      <div className="grid content-start gap-2">
        <p className="text-sm font-medium">Long label, revealed</p>
        <Tooltip content="Indus Textile Mills — Faisalabad plant">
          <span tabIndex={0} data-preview-long className="block max-w-[150px] truncate rounded text-sm font-medium">
            Indus Textile Mills — Faisalabad plant
          </span>
        </Tooltip>
      </div>
      <div className="grid content-start justify-items-start gap-2" data-preview-status>
        <p className="text-sm font-medium">Explaining a status</p>
        <Tooltip forDisabled content="Some costs on this order are still estimates. Margin changes when they are final.">
          <StatusBadge dimension="costs" value="provisional" />
        </Tooltip>
      </div>
      <div className="grid content-start justify-items-start gap-2">
        <p className="text-sm font-medium">Keyboard hint, two lines</p>
        <Tooltip title="Copy and mark chased" content="Copies the message, then stamps today’s date." shortcut={['⌘', '↵']}>
          <Button onClick={noop} data-preview-twoline>Copy message</Button>
        </Tooltip>
      </div>
    </div>
  )
}

export function TooltipSection() {
  return (
    <Section id="tooltip" title="Tooltip variants" note="Hover for 400 ms or focus. The same five are photographed one at a time as scenes (Tooltip variants).">
      <div className="rounded border bg-surface p-6 pb-24">
        <TooltipVariants />
      </div>
    </Section>
  )
}
