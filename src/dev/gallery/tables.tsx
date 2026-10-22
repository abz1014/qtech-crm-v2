// Gallery sections for U04 DataTable, U05 status module and U06 Money (part of /dev/gallery, dev only).
// Data below is the mockups' own (money-01, money-07, money-08, components-06).
import { useState, type ReactNode } from 'react'
import { ClipboardPaste, Plus, Truck } from 'lucide-react'
import { Row, Section } from '@/dev/gallery/layout'
import { STATUS_ENTRIES, TONE_OF_STEP, type StatusDimension, type StepTone, type Tone } from '@/lib/status'
import { DataTable, type Column } from '@/ui/DataTable'
import { EmptyState } from '@/ui/EmptyState'
import { Button } from '@/ui/Button'
import { Margin, Money, MoneyFx, NetGstGross } from '@/ui/Money'
import { StatusBadge } from '@/ui/StatusBadge'
import { TableFilter } from '@/ui/TableFilter'
import { StatusText } from '@/ui/StatusText'
import { AfterDrawings, ExactEquation, SumBar } from '@/ui/SumBar'
import { formatDay } from '@/lib/formatDay'

const Cell2 = ({ t, s }: { t: ReactNode; s?: ReactNode }) => (
  <span className="grid gap-px">
    <span className="font-medium">{t}</span>
    {s ? <span className="text-xs text-fg-muted">{s}</span> : null}
  </span>
)

// ---------------------------------------------------------------- status vocabulary (DESIGN_SYSTEM section 6)
const STEPS: { step: StepTone; title: string }[] = [
  { step: 'now', title: 'We act next (warning)' },
  { step: 'waiting', title: 'Someone else acts next (info)' },
  { step: 'late', title: 'Past its date (danger)' },
  { step: 'done', title: 'Finished (success)' },
  { step: 'inert', title: 'Closed, not asked, not needed (neutral)' },
]
/** One registry key per visible label, grouped by tone. */
const VOCAB = STATUS_ENTRIES.filter(([, , s]) => !s.hidden).reduce(
  (acc, [d, v, s]) => {
    if (!acc[s.tone].some(([, , l]) => l === s.label)) acc[s.tone].push([d, v, s.label])
    return acc
  },
  { warning: [], info: [], danger: [], success: [], neutral: [] } as Record<Tone, [StatusDimension, string, string][]>,
)
const HIDDEN = STATUS_ENTRIES.filter(([, , s]) => s.hidden)

// ---------------------------------------------------------------- components-06
interface Rfq { id: string; no: string; customer: string; items: number; due: string; sourcing: string; status: string; value: string | null }
const RFQS: Rfq[] = [
  { id: '1', no: 'RFQ-0181', customer: 'Punjab Cement Ltd', items: 6, due: '2026-11-27', sourcing: 'covered', status: 'due-soon', value: '1842500' },
  { id: '2', no: 'RFQ-0183', customer: 'Ravi Steel Works — Lahore', items: 3, due: '2026-11-28', sourcing: 'partly_covered', status: 'due-soon', value: '624000' },
  { id: '3', no: 'RFQ-0177', customer: 'Indus Textile Mills — Faisalabad', items: 4, due: '2026-12-01', sourcing: 'floated_awaiting', status: 'open', value: '2310000' },
  { id: '4', no: 'RFQ-0179', customer: 'Chenab Paper Board — Sialkot', items: 2, due: '2026-12-02', sourcing: 'floated_awaiting', status: 'open', value: '418750' },
  { id: '5', no: 'RFQ-0178', customer: 'Sargodha Dairy Foods', items: 5, due: '2026-12-03', sourcing: 'covered', status: 'to_bid', value: '1126400' },
  { id: '6', no: 'RFQ-0184', customer: 'Mehran Paper Board — Hyderabad', items: 8, due: '2026-12-04', sourcing: 'not_floated', status: 'open', value: null },
  { id: '7', no: 'RFQ-0171', customer: 'Karachi Glassworks (KHI)', items: 3, due: '2026-11-23', sourcing: 'no_offer_anywhere', status: 'closed', value: '286000' },
]
const rfqCols: Column<Rfq>[] = [
  { id: 'no', header: 'RFQ', kind: 'date', value: r => r.no, width: 110 },
  { id: 'customer', header: 'Customer', value: r => r.customer, width: 230 },
  { id: 'items', header: 'Items', kind: 'num', value: r => r.items },
  { id: 'due', header: 'Quotation due', kind: 'date', value: r => r.due, cell: r => `${formatDay(r.due)}, 17:00` },
  { id: 'sourcing', header: 'Sourcing', cell: r => <StatusBadge dimension="sourcing" value={r.sourcing} />, sortable: false },
  {
    id: 'status',
    header: 'Status',
    sortable: false,
    cell: r =>
      r.status === 'due-soon' ? (
        <StatusBadge dimension="deadline" value="due-soon" label={r.due === '2026-11-27' ? 'Due today' : 'Due soon'} />
      ) : r.status === 'closed' ? (
        <StatusBadge dimension="rfq-outcome" value="closed" />
      ) : r.status === 'to_bid' ? (
        <StatusBadge dimension="rfq-stage" value="ready" />
      ) : (
        <StatusBadge dimension="rfq-outcome" value="open" />
      ),
  },
  { id: 'value', header: 'Value (PKR, net)', kind: 'money', value: r => r.value },
]

// ---------------------------------------------------------------- money-01 / 02
interface Inv { id: string; no: string; date: string; month: string; customer: string; order: string; net: string; gst: string; tcs: string; fbr: string; warn?: string }
const INV: Inv[] = [
  { id: 'i1', no: 'INV-2311', date: '2026-11-25', month: 'November 2026', customer: 'Hazara Paper Board', order: 'ORD-0041', net: '860000', gst: '154800', tcs: 'not_started', fbr: 'pending' },
  { id: 'i2', no: 'INV-2308', date: '2026-11-21', month: 'November 2026', customer: 'Margalla Steel Re-rolling', order: 'ORD-0037', net: '312500', gst: '56250', tcs: 'sent', fbr: 'generated' },
  { id: 'i3', no: 'INV-2302', date: '2026-11-06', month: 'November 2026', customer: 'Sindh Pharma Works', order: 'ORD-0033', net: '745000', gst: '134100', tcs: 'delivered_to_client', fbr: 'receipt_received' },
  { id: 'i4', no: 'INV-2299', date: '2026-10-30', month: 'October 2026', customer: 'Lahore Beverage Co.', order: 'ORD-0035', net: '468000', gst: '84240', tcs: 'delivered_to_client', fbr: 'deposited' },
  { id: 'i5', no: 'INV-2291', date: '2026-10-16', month: 'October 2026', customer: 'Karachi Glassworks', order: 'ORD-0034', net: '1054500', gst: '189810', tcs: 'delivered_to_client', fbr: 'receipt_received', warn: 'October invoice, tax not deposited' },
  { id: 'i6', no: 'INV-2284', date: '2026-10-07', month: 'October 2026', customer: 'Margalla Steel Re-rolling', order: 'ORD-0036', net: '2180000', gst: '392400', tcs: 'delivered_to_client', fbr: 'deposited' },
  { id: 'i7', no: 'INV-2271', date: '2026-09-28', month: 'September 2026', customer: 'Lahore Beverage Co.', order: 'ORD-0034', net: '395000', gst: '71100', tcs: 'delivered_to_client', fbr: 'deposited' },
  { id: 'i8', no: 'INV-2256', date: '2026-09-20', month: 'September 2026', customer: 'Indus Textile Mills', order: 'ORD-0030', net: '1620000', gst: '291600', tcs: 'sent', fbr: 'generated', warn: 'September invoice, tax not deposited' },
  { id: 'i9', no: 'INV-2249', date: '2026-09-11', month: 'September 2026', customer: 'Hazara Paper Board', order: 'ORD-0012', net: '540000', gst: '97200', tcs: 'copy_received', fbr: 'deposited', warn: 'Deposit recorded without a PSID' },
]
const money = (v: string) => ({ kind: 'money' as const, value: (r: Inv) => (r as unknown as Record<string, string>)[v], total: true as const })
const invCols: Column<Inv>[] = [
  { id: 'no', header: 'Invoice', kind: 'date', value: r => r.no },
  { id: 'date', header: 'Date', kind: 'date', value: r => r.date, cell: r => formatDay(r.date).replace(/^\w+ /, '') },
  { id: 'customer', header: 'Customer', value: r => r.customer, cell: r => <Cell2 t={r.customer} s={r.warn ? <span className="text-tone-warning-fg">{r.warn}</span> : r.order} /> },
  { id: 'net', header: 'Net', ...money('net') },
  { id: 'gst', header: 'GST', ...money('gst') },
  { id: 'gross', header: 'Gross', kind: 'money', value: r => (Number(r.net) + Number(r.gst)).toFixed(2), total: true },
  { id: 'tcs', header: 'Courier (TCS)', sortable: false, cell: r => <StatusBadge dimension="tcs" value={r.tcs} /> },
  { id: 'fbr', header: 'FBR', sortable: false, cell: r => <StatusBadge dimension="fbr" value={r.fbr} /> },
]

// ---------------------------------------------------------------- money-08
interface Ord { id: string; customer: string; no: string; net: string | null; basis: string; expected: string | null; actual: string; margin: string | null; state: 'final' | 'provisional' | 'basis_unknown'; cost: string }
const ORD: Ord[] = [
  { id: 'o1', customer: 'Punjab Cement Ltd', no: 'ORD-0038', net: '1949800', basis: 'from items', expected: '1480000', actual: '497000', margin: '1452800', state: 'provisional', cost: 'provisional' },
  { id: 'o2', customer: 'Margalla Steel Re-rolling', no: 'ORD-0036', net: '2180000', basis: 'invoiced', expected: '1640000', actual: '1702500', margin: '477500', state: 'final', cost: 'complete' },
  { id: 'o3', customer: 'Margalla Steel Re-rolling', no: 'ORD-0037', net: '312500', basis: 'invoiced', expected: '240000', actual: '236400', margin: '76100', state: 'final', cost: 'complete' },
  { id: 'o4', customer: 'Lahore Beverage Co.', no: 'ORD-0035', net: '468000', basis: 'invoiced', expected: '360000', actual: '285000', margin: '183000', state: 'provisional', cost: 'provisional' },
  { id: 'o5', customer: 'Sindh Pharma Works', no: 'ORD-0033', net: '745000', basis: 'invoiced', expected: '520000', actual: '24800', margin: '720200', state: 'provisional', cost: 'provisional' },
  { id: 'o6', customer: 'Hazara Paper Board', no: 'ORD-0012', net: null, basis: '', expected: null, actual: '640000', margin: null, state: 'basis_unknown', cost: 'basis_unknown' },
]
const ordCols: Column<Ord>[] = [
  { id: 'customer', header: 'Customer and order', value: r => r.customer, cell: r => <Cell2 t={r.customer} s={<span className="num">{r.no}</span>} /> },
  { id: 'net', header: 'Net sale', kind: 'money', value: r => r.net, cell: r => (r.net ? <Cell2 t={<Money value={r.net} prefix={false} className="font-regular" />} s={r.basis} /> : <Money value={null} /> ) },
  { id: 'expected', header: 'Expected cost', kind: 'money', value: r => r.expected },
  { id: 'actual', header: 'Actual cost so far', kind: 'money', value: r => r.actual },
  { id: 'margin', header: 'Margin', kind: 'money', value: r => r.margin, cell: r => <Margin value={r.margin} state={r.state} prefix={false} mark="underline" /> },
  { id: 'cost', header: 'Costs', sortable: false, cell: r => <StatusBadge dimension={r.state === 'basis_unknown' ? 'trust' : 'costs'} value={r.state === 'basis_unknown' ? 'basis_unknown' : r.cost} /> },
]

// ---------------------------------------------------------------- money-07
interface Pay { id: string; day: string; customer: string; ref: string; gross: string; gst: string | null; net: string | null }
const PAY: Pay[] = [
  { id: 'p1', day: '2026-11-02', customer: 'Sindh Pharma Works', ref: 'ORD-0033 · IBFT 20261102-0891', gross: '250000', gst: '38135.59', net: '211864.41' },
  { id: 'p2', day: '2026-11-04', customer: 'Margalla Steel Re-rolling', ref: 'ORD-0036 · Cheque 004471', gross: '1072400', gst: '163586.44', net: '908813.56' },
  { id: 'p3', day: '2026-11-09', customer: 'Punjab Cement Ltd', ref: 'ORD-0038 · IBFT 20261109-4471', gross: '700000', gst: '106779.66', net: '593220.34' },
  { id: 'p4', day: '2026-11-12', customer: 'Lahore Beverage Co.', ref: 'ORD-0035 · IBFT 20261112-2210', gross: '300000', gst: '45762.71', net: '254237.29' },
  { id: 'p5', day: '2026-11-14', customer: 'Hazara Paper Board', ref: 'ORD-0012 · Cheque 118842', gross: '150000', gst: null, net: null },
  { id: 'p6', day: '2026-11-24', customer: 'Margalla Steel Re-rolling', ref: 'ORD-0037 · IBFT 20261124-6638', gross: '368750', gst: '56250.00', net: '312500.00' },
]
const payCols: Column<Pay>[] = [
  { id: 'day', header: 'Received', kind: 'date', value: r => r.day, cell: r => formatDay(r.day).replace(/^\w+ /, '') },
  { id: 'customer', header: 'Customer and reference', value: r => r.customer, cell: r => <Cell2 t={r.customer} s={r.ref} /> },
  { id: 'gross', header: 'Gross', kind: 'money', value: r => r.gross, total: true },
  { id: 'gst', header: 'GST portion', kind: 'money', value: r => r.gst, total: true },
  { id: 'net', header: 'Net portion', kind: 'money', value: r => r.net, total: true, cell: r => (r.net === null ? <StatusBadge dimension="trust" value="basis_unknown" label="Net unresolved" /> : <Money value={r.net} prefix={false} paisa="always" />) },
]

/** The components-06 table: filter, density switch, truncating customer column, "Showing n of n RFQs" and the key legend. */
function RfqTable({ label, density, activeRowId, onOpen }: { label: string; density?: 'compact'; activeRowId: string | null; onOpen: (id: string) => void }) {
  const [text, setText] = useState('')
  const q = text.trim().toLowerCase()
  const shown = q ? RFQS.filter(r => `${r.no} ${r.customer}`.toLowerCase().includes(q)) : RFQS
  return (
    <DataTable
      label={label}
      noun="RFQs"
      total={RFQS.length}
      density={density}
      columns={rfqCols}
      rows={shown}
      getRowId={r => r.id}
      defaultSort={{ id: 'due', dir: 'asc' }}
      onRowOpen={r => onOpen(r.id)}
      activeRowId={activeRowId}
      toolbar={<TableFilter label="Search RFQs" value={text} onChange={setText} />}
      empty={<EmptyState title={`No RFQs match “${text}”`} actions={<Button onClick={() => setText('')}>Clear filter</Button>}>Try fewer words or clear the filter.</EmptyState>}
    />
  )
}

export function StatusMoneyTableSections() {
  const [sel, setSel] = useState<ReadonlySet<string>>(new Set(['i1', 'i2', 'i3']))
  const [open, setOpen] = useState<string | null>('3')
  return (
    <>
      <Section
        id="status"
        title="Status vocabulary"
        note="The 34 visible labels, grouped by who acts next: as a chip (StatusBadge) and as status text (StatusText). One label, one tone, everywhere. Colours come from the data-status map in tokens.css."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {STEPS.map(({ step, title }) => (
            <div key={step} className="grid content-start gap-3 rounded-panel border bg-surface p-4">
              <p className="flex justify-between text-sm font-medium"><span>{title}</span><span className="num text-fg-muted">{VOCAB[TONE_OF_STEP[step]].length}</span></p>
              <ul className="grid gap-2">
                {VOCAB[TONE_OF_STEP[step]].map(([d, v, label]) => (
                  <li key={label} className="flex flex-wrap items-center justify-between gap-3">
                    <StatusBadge dimension={d} value={v} />
                    <StatusText dimension={d} value={v} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-4 grid content-start gap-3 rounded-panel border bg-surface p-4">
          <p className="text-sm font-medium">Text only: the normal state never draws a chip</p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {HIDDEN.map(([d, v]) => <StatusText key={`${d}:${v}`} dimension={d} value={v} detail={`${d}:${v}`} />)}
          </div>
        </div>
      </Section>

      <Section id="money" title="Money" note="PKR and foreign amounts, with what is known and what is not.">
        <div className="rounded-panel border bg-surface px-5">
          <Row title="PKR net, GST, gross" note="Gross is always net + GST, computed in paisa."><NetGstGross net="1250000" gst="225000" gstRate={18} /></Row>
          <Row title="Paisa kept" note="A figure with paisa shows both digits."><Money value="410514.4" size="lg" /><Money value="-84500" size="lg" /></Row>
          <Row title="Foreign currency, fresh rate" note="Original first, then the conversion at the rate and its date."><MoneyFx amount="4820" currency="USD" rate="278.40" rateOn="2026-11-26" ageDays={1} /></Row>
          <Row title="Foreign currency, stale rate" note="Rate 8 to 30 days old: still converted, amber, with its age."><MoneyFx amount="18600" currency="CNY" rate="38.42" ageDays={14} /></Row>
          <Row title="Rate unusable" note="Older than 30 days: no PKR figure, left out of comparisons."><MoneyFx amount="12400" currency="AED" rate="75.8" ageDays={52} /></Row>
          <Row title="No rate yet" note="A quiet line and a separate quiet chip; admin sets rates on Money."><MoneyFx amount="2200" currency="GBP" /></Row>
          <Row title="Captured rate, at the time" note="The rate stored on the quote line, beside today's."><MoneyFx amount="17900" currency="CNY" rate="38.42" ageDays={2} captured={{ rate: '39.10', on: '2026-10-03' }} /></Row>
          <Row title="Not final" note="Costs are still estimates. Dashed underline and the chip."><Money value="412300" size="xl" provisional /></Row>
          <Row title="Is GST included?" note="Legacy value whose net or gross was never recorded, shown as typed."><Money value="3640000" size="xl" basisUnknown /></Row>
          <Row title="Below cost" note="True minus, red, and the words."><Margin value="-84500" state="final" size="xl" /></Row>
          <Row title="Not set" note="An em dash in muted text, never 0."><Money value={null} /></Row>
        </div>
      </Section>

      <Section id="sumbar" title="SumBar and after drawings" note="The Money summary strip, and the A6 separated lines below a month's result.">
        <SumBar
          label="November cash summary"
          items={[
            { label: 'Gross in', amount: '2841150', sub: '6 payments received' },
            { label: 'GST portion', amount: '410514.40', sub: 'Inside the payments, shared by invoice' },
            { label: 'Net in', amount: '2280635.60', sub: 'Excludes 150,000 unresolved, 1 payment' },
            { label: 'Money out', amount: '1313300', sub: '7 expenses paid' },
          ]}
        />
        <ExactEquation total="2841150" parts={[{ amount: "2280635.60", label: "net" }, { amount: "410514.40", label: "GST" }, { amount: "150000", label: "not yet split" }]} />
        <div className="max-w-[560px]"><AfterDrawings result="2280635.60" notInPnl="300000" /></div>
      </Section>

      <Section id="rfq" title="DataTable: comfortable, then compact with a selected row" note="Press Tab, then the arrow keys, Enter and Space. / focuses the filter, Esc clears it. Comfortable / Compact is remembered per person. Long customer names truncate with a tooltip.">
        <RfqTable label="RFQs" activeRowId={null} onOpen={setOpen} />
        <RfqTable label="RFQs, compact" density="compact" activeRowId={open} onOpen={setOpen} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <DataTable label="Loading" noun="RFQs" columns={rfqCols} rows={[]} getRowId={r => r.id} loading toolbar={<TableFilter label="Search RFQs" value="" onChange={() => undefined} />} />
          <DataTable label="Error" noun="RFQs" columns={rfqCols} rows={[]} getRowId={r => r.id} toolbar={<TableFilter label="Search RFQs" value="" onChange={() => undefined} />} error={{ onRetry: () => undefined, reference: '4f1c9a', at: new Date('2026-11-27T09:41:00+05:00') }} />
          <DataTable label="Goal state" noun="RFQs" columns={rfqCols} rows={[]} getRowId={r => r.id} toolbar={<TableFilter label="Search RFQs" value="" onChange={() => undefined} />} empty={<EmptyState mood="goal" title="Every quotation is sent" actions={<><Button variant="primary" icon={Plus}>New RFQ</Button><Button icon={ClipboardPaste}>Paste or photo</Button></>}>Nothing is open and nothing is due in the next 5 days. New RFQs appear here as soon as you start one.</EmptyState>} />
          <DataTable label="No match" noun="RFQs" columns={rfqCols} rows={[]} getRowId={r => r.id} toolbar={<TableFilter label="Search RFQs" value="Belimo" onChange={() => undefined} />} empty={<EmptyState title={'No RFQs match “Belimo”'} actions={<Button>Clear filter</Button>}>Search covers RFQ number, customer, customer ref and item text. Try fewer words or clear the filter.</EmptyState>} />
        </div>
      </Section>

      <Section id="cards" title="DataTable: phone cards" note="With mobileRow, rows below 640px become stacked, tappable cards (44px minimum, keyboard and selection kept). Wider screens still show the table.">
        <DataTable
          label="RFQs as cards"
          columns={rfqCols}
          rows={RFQS}
          getRowId={r => r.id}
          defaultSort={{ id: 'due', dir: 'asc' }}
          onRowOpen={r => setOpen(r.id)}
          activeRowId={open}
          summary="Showing 7 of 7 RFQs"
          mobileRow={r => (
            <div className="grid gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate font-medium">{r.customer}</span>
                <span className="num shrink-0 text-xs text-fg-muted">{r.no}</span>
              </div>
              <span className="num text-xs text-fg-muted">Due {formatDay(r.due)}</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge dimension="sourcing" value={r.sourcing} />
                {r.status === 'to_bid' ? <StatusBadge dimension="rfq-stage" value="ready" /> : <StatusBadge dimension="rfq-outcome" value={r.status === 'closed' ? 'closed' : 'open'} />}
              </div>
            </div>
          )}
        />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <DataTable label="Cards, loading" columns={rfqCols.slice(0, 5)} rows={[]} getRowId={r => r.id} loading mobileRow={() => null} />
          <DataTable label="Cards, goal state" columns={rfqCols.slice(0, 5)} rows={[]} getRowId={r => r.id} mobileRow={() => null} empty={<EmptyState mood="goal" title="No open RFQs. Nice.">Every RFQ is won or closed.</EmptyState>} />
        </div>
      </Section>

      <Section id="register" title="GST register: groups, selection, tracks, totals" note="Month stamping: tick a month once. Group subtotals and the footer are summed from the rows.">
        <DataTable twoLine
          label="GST register"
          columns={invCols}
          rows={INV}
          getRowId={r => r.id}
          group={r => ({ key: r.month, label: `${r.month} · ${INV.filter(i => i.month === r.month).length} invoices` })}
          selection={{ selected: sel, onChange: setSel, rowLabel: r => r.no }}
          footerLabel="All 9 invoices shown"
          exportCsv={{ filename: 'gst-register.csv' }}
          toolbar={({ selectedCount }) => selectedCount ? (<><span className="text-sm"><b className="num">{selectedCount}</b> invoices ticked</span><Button size="sm" icon={Truck}>Sent by TCS today</Button><Button size="sm" variant="primary">Deposited today</Button></>) : <span className="text-sm text-fg-muted">Tick a month to stamp it</span>}
        />
      </Section>

      <Section id="cash" title="Cash month" note="Money in by payment date, with the unresolved payment set apart.">
        <DataTable twoLine label="Money in" columns={payCols} rows={PAY} getRowId={r => r.id} footerLabel="Total" />
      </Section>

      <Section id="margins" title="Order margins" note="Only costs-complete orders are totalled. Margins that are not final carry dashed underlines.">
        <DataTable twoLine
          label="Order margins"
          columns={ordCols.map(c => (['net', 'expected', 'actual', 'margin'].includes(c.id) ? { ...c, total: (rows: Ord[]) => {
            const done = rows.filter(r => r.state === 'final')
            const key = c.id === 'net' ? 'net' : c.id === 'expected' ? 'expected' : c.id === 'actual' ? 'actual' : 'margin'
            return <Money value={String(done.reduce((n, r) => n + Number(r[key] ?? 0), 0))} prefix={false} strong />
          } } : c))}
          rows={ORD}
          getRowId={r => r.id}
          footerLabel={<span>Costs complete {'·'} <span className="num">2</span> orders</span>}
        />
      </Section>
    </>
  )
}
