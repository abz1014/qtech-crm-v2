import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarDays, Check, Download, Plus, Search, Truck, TriangleAlert } from 'lucide-react'
import { generateCSV, downloadCSV } from '@/lib/csvExport'
import { businessToday } from '@/lib/dates'
import { formatDay } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { orderRef } from '@/lib/refs'
import { useSession } from '@/app/session'
import { Button } from '@/ui/Button'
import { DataTable, type Column } from '@/ui/DataTable'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { Money } from '@/ui/Money'
import { StatusTrack } from '@/ui/StatusTrack'
import { SumBar } from '@/ui/SumBar'
import { ToggleButton } from '@/ui/ToggleButton'
import { useToast } from '@/ui/useToast'
import { TextField } from '@/ui/form/TextField'
import { MoneyFrame } from '@/features/money/MoneyFrame'
import { CreateInvoiceDialog } from '@/features/money/invoices/CreateInvoiceDialog'
import { useGstRegister, useStamps } from '@/features/money/invoices/hooks'
import { InvoiceDetailDialog } from '@/features/money/invoices/InvoiceDetailDialog'
import {
  attentionReason,
  cleanPsid,
  matchesSearch,
  needsAttention,
  rangeLabel,
  registerTotals,
  rowMonth,
  stampable,
  type GstRow,
  type StampKind,
} from '@/features/money/invoices/model'

/*
 * Money > GST register (M01; g2-money "GST register, by invoice date" and "month stamping"). Admin and sales: the one register,
 * every invoice goes to FBR. Grouped by invoice month with month subtotals, TCS and FBR as three-step tracks, "Needs attention"
 * for tax not deposited in an earlier month and for a step recorded without the one before it.
 *
 * Month stamping: tick a month (1), then "Sent by TCS today" (2), paste the PSID once and press Enter or "Add PSID", then
 * "Deposited today" (3): at most 3 taps and 1 paste. Each stamp writes today's date to the ticked invoices, and Undo stays on the
 * toast for 10 seconds. Export is admin only; sales see the same register without it.
 */
export function GstRegisterPage() {
  const session = useSession()
  const isAdmin = session.status === 'signed-in' && session.user.role === 'admin'
  const register = useGstRegister()
  const toast = useToast()
  const stamps = useStamps()
  const [params, setParams] = useSearchParams()
  const [attention, setAttention] = useState(false)
  const [search, setSearch] = useState('')
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
  const [psid, setPsid] = useState('')
  const [busy, setBusy] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const all = useMemo(() => register.data ?? [], [register.data])
  const attentionCount = useMemo(() => all.filter(needsAttention).length, [all])
  const shown = useMemo(() => all.filter(r => (!attention || needsAttention(r)) && matchesSearch(r, search)), [all, attention, search])
  const totals = registerTotals(shown)
  const monthCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of shown) m.set(rowMonth(r), (m.get(rowMonth(r)) ?? 0) + 1)
    return m
  }, [shown])
  const tickedRows = useMemo(() => shown.filter(r => ticked.has(r.invoiceId)), [shown, ticked])

  // /money/gst-register?new=1&order=<id> opens the create dialog for that order (the order page can link here).
  const linkedNew = params.get('new') !== null
  const linkedOrder = params.get('order') ?? undefined
  // /money/gst-register?invoice=<id> opens that invoice (the command palette links here, P02).
  const linkedInvoice = params.get('invoice')
  const closeInvoice = () => {
    setOpening(null)
    if (linkedInvoice) {
      const next = new URLSearchParams(params)
      next.delete('invoice')
      setParams(next, { replace: true })
    }
  }
  const closeLinked = () => {
    const next = new URLSearchParams(params)
    next.delete('new')
    next.delete('order')
    setParams(next, { replace: true })
  }

  const columns = useMemo<Column<GstRow>[]>(
    () => [
      {
        id: 'number',
        header: 'Invoice',
        kind: 'date',
        sortable: true,
        value: r => r.number,
        cell: r => {
          const why = attentionReason(r)
          return (
            <span className="inline-flex items-center gap-2">
              {why ? (
                <span title={why} className="text-tone-warning-fg">
                  <Icon icon={TriangleAlert} />
                  <span className="sr-only">Needs attention: {why}</span>
                </span>
              ) : null}
              {r.number ?? <span className="text-fg-muted">No number</span>}
            </span>
          )
        },
      },
      { id: 'date', header: 'Date', kind: 'date', sortable: true, value: r => r.invoiceDate, cell: r => (r.invoiceDate ? formatDay(r.invoiceDate).replace(/^\w+ /, '') : '—') },
      {
        id: 'customer',
        header: 'Customer',
        sortable: true,
        value: r => r.companyName,
        cell: r => {
          const why = attentionReason(r)
          return (
            <span className="grid gap-px">
              <span className="truncate font-medium">{r.companyName ?? 'No customer'}</span>
              {why ? <span className={`truncate text-xs ${ticked.has(r.invoiceId) ? 'text-fg-2' : 'text-tone-warning-fg'}`}>{why}</span> : r.orderNumber !== null ? <span className="num text-xs text-fg-muted">{orderRef(r.orderNumber)}</span> : null}
            </span>
          )
        },
      },
      { id: 'net', header: 'Net', kind: 'money', sortable: true, value: r => String(r.net), total: true },
      { id: 'gst', header: 'GST', kind: 'money', sortable: true, value: r => String(r.gst), total: true },
      { id: 'gross', header: 'Gross', kind: 'money', sortable: true, value: r => String(r.gross), total: true },
      { id: 'tcs', header: 'Courier (TCS)', sortable: false, cell: r => <StatusTrack dimension="tcs" value={r.courierState} /> },
      { id: 'fbr', header: 'FBR', sortable: false, cell: r => <StatusTrack dimension="fbr" value={r.fbrState} /> },
    ],
    // a ticked row has the selected background, where the amber text is below 4.5:1, so it reads in the body colour there
    [ticked],
  )

  const stamp = async (kind: StampKind) => {
    if (busy || tickedRows.length === 0) return
    const targets = stampable(tickedRows, kind)
    if (kind !== 'psid' && targets.length === 0) {
      toast.toast({ title: kind === 'tcs' ? 'Already sent by TCS' : 'Already deposited', body: `Nothing to stamp on the ${tickedRows.length} ticked ${tickedRows.length === 1 ? 'invoice' : 'invoices'}.`, tone: 'neutral' })
      return
    }
    const clean = cleanPsid(psid)
    if (kind === 'psid' && !clean) {
      toast.toast({ title: 'Paste the PSID first', body: 'One PSID is written to every ticked invoice.', tone: 'neutral' })
      return
    }
    setBusy(true)
    try {
      const ids = targets.map(r => r.invoiceId)
      const res = kind === 'tcs' ? await stamps.tcs(ids) : kind === 'deposit' ? await stamps.deposited(ids) : await stamps.psid(ids, clean)
      const word = res.n === 1 ? 'invoice' : 'invoices'
      const what = kind === 'tcs' ? 'sent by TCS today' : kind === 'deposit' ? 'deposited today' : `given PSID ${clean}`
      toast.toast({
        title: `Marked ${res.n} ${word} ${what}`,
        body: `Today, ${formatDay(businessToday())}`,
        tone: 'success',
        undo: {
          onUndo: async () => {
            try {
              await res.undo()
            } catch (err) {
              toast.toast({ title: 'Could not undo', body: mapPgError(err).message, tone: 'danger' })
            }
          },
          settledTitle: `Marked ${res.n} ${word} ${what}`,
          undoneTitle: 'Stamp taken back',
        },
      })
      if (kind === 'psid') setPsid('')
    } catch (err) {
      toast.toast({ title: "Couldn't stamp the invoices", body: mapPgError(err, { entity: 'invoice' }).message, tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const exportCsv = () => {
    const csv = generateCSV(
      ['Invoice', 'Date', 'Customer', 'Order', 'Net', 'GST', 'Gross', 'Courier (TCS)', 'FBR', 'PSID', 'Deposited on'],
      shown.map(r => [r.number, r.invoiceDate, r.companyName, r.orderNumber === null ? '' : orderRef(r.orderNumber), r.net, r.gst, r.gross, r.courierState, r.fbrState, r.psid, r.taxDepositedOn]),
    )
    downloadCSV(csv, 'gst-register.csv')
  }

  const header = (
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="text-base font-semibold">GST register</h2>
      <span className="inline-flex items-center gap-[6px] text-xs text-fg-muted">
        <Icon icon={CalendarDays} size="chip" />
        By invoice date
      </span>
      {all.length > 0 ? <span className="text-sm text-fg-muted">{rangeLabel(all)}</span> : null}
      <span className="flex-1" />
      <ToggleButton pressed={attention} onPressedChange={setAttention} icon={TriangleAlert}>
        Needs attention <span className="num">{attentionCount}</span>
      </ToggleButton>
      <label className="relative block w-[200px]">
        <span className="sr-only">Search invoices</span>
        <Icon icon={Search} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
        <TextField type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Invoice or customer" autoComplete="off" className="h-[28px] pl-8 text-xs" />
      </label>
      {isAdmin ? (
        <Button size="sm" icon={Download} onClick={exportCsv} disabled={shown.length === 0}>
          Export
        </Button>
      ) : null}
      <Button size="sm" variant="primary" icon={Plus} onClick={() => setCreating(true)}>
        New invoice
      </Button>
    </div>
  )

  return (
    <MoneyFrame active="gst-register">
      <SumBar
        label="Totals for the invoices shown"
        items={[
          { label: 'Invoices', count: totals.count, sub: all.length ? `${rangeLabel(shown.length ? shown : all).replace(' to ', ' to ')}, by invoice date` : 'By invoice date' },
          { label: 'Net', amount: totals.net, sub: 'Before GST' },
          { label: 'GST', amount: totals.gst, sub: 'Output tax on the invoices' },
          { label: 'Gross', amount: totals.gross, sub: 'Net + GST' },
        ]}
      />

      <DataTable
        label="GST register"
        columns={columns}
        rows={shown}
        getRowId={r => r.invoiceId}
        twoLine
        group={r => ({ key: rowMonth(r), label: `${rowMonth(r)} · ${monthCounts.get(rowMonth(r)) ?? 0} ${(monthCounts.get(rowMonth(r)) ?? 0) === 1 ? 'invoice' : 'invoices'}` })}
        selection={{ selected: ticked, onChange: s => setTicked(s), rowLabel: r => r.number ?? 'invoice' }}
        onRowOpen={r => setOpening(r.invoiceId)}
        footerLabel={`All ${totals.count} ${totals.count === 1 ? 'invoice' : 'invoices'} shown`}
        loading={register.isPending}
        error={
          register.isError
            ? { title: 'The GST register did not load', message: 'Your invoices are safe. The server did not answer in time. Try again, and if it keeps failing, tell the admin.', onRetry: () => void register.refetch() }
            : null
        }
        toolbar={({ selectedCount }) => (
          <div className="grid gap-3">
            {header}
            {selectedCount > 0 ? (
              <div data-testid="batch-bar" className="-mx-4 flex w-[calc(100%+2rem)] flex-wrap items-center gap-3 border-y bg-sunken px-4 py-2">
                <span className="text-sm">
                  <b className="num font-medium">{selectedCount}</b> {selectedCount === 1 ? 'invoice' : 'invoices'} ticked
                </span>
                <span className="flex-1" />
                <Button size="sm" icon={Truck} onClick={() => void stamp('tcs')} disabled={busy}>
                  Sent by TCS today
                </Button>
                <span className="inline-flex items-center gap-2">
                  <TextField
                    aria-label="PSID"
                    value={psid}
                    onChange={e => setPsid(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void stamp('psid')
                      }
                    }}
                    placeholder="Paste PSID once"
                    autoComplete="off"
                    spellCheck={false}
                    className="num h-[28px] w-[160px] text-xs"
                  />
                  <Button size="sm" icon={Plus} onClick={() => void stamp('psid')} disabled={busy}>
                    Add PSID
                  </Button>
                </span>
                <Button size="sm" variant="primary" icon={Check} onClick={() => void stamp('deposit')} disabled={busy}>
                  Deposited today
                </Button>
              </div>
            ) : null}
          </div>
        )}
        empty={
          attention || search ? (
            <EmptyState mood="neutral" title="No invoices match">
              <Button size="sm" onClick={() => { setAttention(false); setSearch('') }}>
                Clear filters
              </Button>
            </EmptyState>
          ) : (
            <EmptyState title="No invoices yet" actions={<Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>New invoice</Button>}>
              Invoices appear here as you create them from an order, by invoice date. Every invoice goes to FBR.
            </EmptyState>
          )
        }
        mobileRow={r => (
          <div className="grid gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="num font-medium">{r.number ?? 'No number'}</span>
              <Money value={r.gross} prefix={false} />
            </div>
            <span className="truncate text-sm">{r.companyName}</span>
            {attentionReason(r) ? <span className="text-xs text-tone-warning-fg">{attentionReason(r)}</span> : null}
            <div className="flex flex-wrap gap-2">
              <StatusTrack dimension="tcs" value={r.courierState} />
              <StatusTrack dimension="fbr" value={r.fbrState} />
            </div>
          </div>
        )}
      />
      <p className="max-w-[90ch] text-xs text-fg-muted">
        Every invoice goes to FBR, so this is the one register. Dates here are invoice dates. For money actually received, see {isAdmin ? 'Receivables' : 'Order balances'}.
      </p>
      {tickedRows.length > 0 ? (
        <p className="max-w-[90ch] text-xs text-fg-muted">
          Each stamp applies to the ticked invoices and writes today&rsquo;s date. No bank is asked for: the PSID is the deposit reference. Undo stays on the toast for 10 seconds.
        </p>
      ) : null}

      <CreateInvoiceDialog open={creating || linkedNew} onOpenChange={o => { if (!o) { setCreating(false); if (linkedNew) closeLinked() } }} orderId={creating ? undefined : linkedOrder} />
      {opening ?? linkedInvoice ? <InvoiceDetailDialog invoiceId={(opening ?? linkedInvoice) as string} onClose={closeInvoice} /> : null}
    </MoneyFrame>
  )
}
