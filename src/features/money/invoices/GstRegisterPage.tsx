import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarDays, Check, Download, Plus, Truck, TriangleAlert } from 'lucide-react'
import { generateCSV, downloadCSV } from '@/lib/csvExport'
import { businessToday } from '@/lib/dates'
import { formatDay } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { orderRef } from '@/lib/refs'
import { useQueryParamText } from '@/lib/useQueryParamText'
import { useSession } from '@/app/session'
import { Button } from '@/ui/Button'
import { DataTable, type Column } from '@/ui/DataTable'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { Money } from '@/ui/Money'
import { MoreMenu } from '@/ui/MoreMenu'
import { NoResults } from '@/ui/NoResults'
import { MenuItem } from '@/ui/Popover'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { StatusBadge } from '@/ui/StatusBadge'
import { SumBar } from '@/ui/SumBar'
import { TableFilter } from '@/ui/TableFilter'
import { useToast } from '@/ui/useToast'
import { TextField } from '@/ui/form/TextField'
import { MoneyFrame } from '@/features/money/MoneyFrame'
import { InfoTip } from '@/ui/InfoTip'
import { CreateInvoiceDialog } from '@/features/money/invoices/CreateInvoiceDialog'
import { useGstRegister, useStamps } from '@/features/money/invoices/hooks'
import { InvoiceDetailDialog } from '@/features/money/invoices/InvoiceDetailDialog'
import { InvoicePdfButton } from '@/features/money/invoices/pdf/InvoicePdfButton'
import {
  attentionReason,
  cleanPsid,
  matchesSearch,
  needsAttention,
  tcsNotSent,
  rangeLabel,
  registerTotals,
  rowMonth,
  stampable,
  type GstRow,
  type StampKind,
} from '@/features/money/invoices/model'

/*
 * Money > Invoices & GST (M01; g2-money "GST register, by invoice date" and "month stamping"). Admin and sales: the one register,
 * every invoice goes to FBR. Grouped by invoice month with month subtotals; the courier (TCS) and FBR states are one chip each
 * (owner decision 2026-10-19: the chip or the bar, not both), "Needs attention" for tax not deposited in an earlier month and for a
 * step recorded without the one before it. Sales tick and stamp like the admin (Today sends them the TCS and FBR items, and the
 * stamp functions of 0020 accept them); their register leaves out the Net and GST columns, and Export stays the admin's.
 *
 * Month stamping: tick a month (1), then "Sent by TCS today" (2), paste the PSID once and press Enter or "Add PSID", then
 * "Deposited today" (3): at most 3 taps and 1 paste. Each stamp writes today's date to the ticked invoices, and Undo stays on the
 * toast for 10 seconds. Export is admin only (in the toolbar's More menu); sales see the same register without it.
 *
 * Toolbar (round-2 R2-15, spec 3.2): "Search invoices" (kept in `?q=`), ONE switch "All · Needs attention N · Not sent by TCS N"
 * (the counts are needs-you pills), More (Export). "Create invoice" is the page's one green action, in the Money header, the
 * same words as on the order.
 */
type RegisterView = 'all' | 'attention' | 'tcs'

export function GstRegisterPage() {
  const session = useSession()
  const isAdmin = session.status === 'signed-in' && session.user.role === 'admin'
  const register = useGstRegister()
  const toast = useToast()
  const stamps = useStamps()
  const [params, setParams] = useSearchParams()
  // Today's "FBR attention" item opens it on Needs attention (?attention=1), and "not sent by TCS" on that view (?tcs=1).
  const [view, setView] = useState<RegisterView>(() => (params.get('attention') === '1' ? 'attention' : params.get('tcs') === '1' ? 'tcs' : 'all'))
  const attention = view === 'attention'
  const tcs = view === 'tcs'
  const [search, setSearch] = useQueryParamText()
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
  const [psid, setPsid] = useState('')
  const [busy, setBusy] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const all = useMemo(() => register.data ?? [], [register.data])
  const attentionCount = useMemo(() => all.filter(needsAttention).length, [all])
  const tcsCount = useMemo(() => all.filter(tcsNotSent).length, [all])
  const shown = useMemo(() => all.filter(r => (!attention || needsAttention(r)) && (!tcs || tcsNotSent(r)) && matchesSearch(r, search)), [all, attention, tcs, search])
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

  const columns = useMemo<Column<GstRow>[]>(() => {
    const cols: Column<GstRow>[] = [
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
              <span className="line-clamp-2 font-medium">{r.companyName ?? 'No customer'}</span>
              {why ? <span className={`line-clamp-2 text-xs ${ticked.has(r.invoiceId) ? 'text-fg-2' : 'text-tone-warning-fg'}`}>{why}</span> : r.orderNumber !== null ? <span className="num text-xs text-fg-muted">{orderRef(r.orderNumber)}</span> : null}
            </span>
          )
        },
      },
      { id: 'net', header: 'Net', kind: 'money', sortable: true, value: r => String(r.net), total: true },
      { id: 'gst', header: 'GST', kind: 'money', sortable: true, value: r => String(r.gst), total: true },
      { id: 'gross', header: 'Gross', kind: 'money', sortable: true, value: r => String(r.gross), total: true },
      { id: 'tcs', header: 'Sent to customer (TCS)', sortable: false, cell: r => <StatusBadge dimension="tcs" value={r.courierState} /> },
      { id: 'fbr', header: 'Tax deposited (FBR)', sortable: false, cell: r => <StatusBadge dimension="fbr" value={r.fbrState} /> },
      {
        id: 'pdf',
        header: 'PDF',
        sortable: false,
        // stop the row's own click (it opens the invoice) for the button and for its dialog, whose events bubble through the portal
        cell: r => (
          <span onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
            <InvoicePdfButton invoiceId={r.invoiceId} iconOnly size="sm" label={`Print invoice ${r.number ?? ''}`.trim()} />
          </span>
        ),
      },
    ]
    // Sales stamp too (M08 sends them the TCS and FBR items; the 0020 RPCs allow it): they keep the ticks, the toggles and the
    // stamps, and only lose the Net and GST columns, which are the admin's filing figures.
    return isAdmin ? cols : cols.filter(c => c.id !== 'net' && c.id !== 'gst')
    // a ticked row has the selected background, where the amber text is below 4.5:1, so it reads in the body colour there
  }, [ticked, isAdmin])

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
            await res.undo()
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
      <span className="inline-flex h-6 items-center gap-[6px] rounded border border-line-strong bg-selected px-2 text-sm text-fg-2">
        <Icon icon={CalendarDays} size="chip" />
        By invoice date
      </span>
      {all.length > 0 ? <span className="text-sm text-fg-muted">{rangeLabel(all)}</span> : null}
      <InfoTip label="About TCS, FBR and PSID">
        <b className="font-medium text-fg">TCS</b> is the courier that takes the invoice to the customer. <b className="font-medium text-fg">FBR</b> is the
        tax office: the GST on every invoice is deposited with FBR. <b className="font-medium text-fg">PSID</b> is the payment slip number FBR gives a deposit;
        one PSID can cover several invoices. Dates here are invoice dates; money actually received is under Who owes us.
      </InfoTip>
    </div>
  )
  // Toolbar row 2 (spec 3.2): the search, ONE switch (each view matches one stamping job; the needs-you counts as NeedsCount
  // pills), and Export in a More menu for the admin.
  const controls = (
    <div className="flex flex-wrap items-center gap-3">
      <TableFilter label="Search invoices" hint="Finds an invoice by invoice number, customer or order number." value={search} onChange={setSearch} />
      <span className="flex-1" />
      <SegmentedControl
        aria-label="Show"
        value={view}
        onValueChange={v => setView(v as RegisterView)}
        options={[
          { value: 'all', label: 'All' },
          { value: 'attention', label: 'Needs attention', needs: attentionCount },
          { value: 'tcs', label: 'Not sent by TCS', needs: tcsCount },
        ]}
      />
      {isAdmin ? (
        <MoreMenu label="More for the register">
          <MenuItem icon={Download} onClick={exportCsv} disabled={shown.length === 0}>
            Export
          </MenuItem>
        </MoreMenu>
      ) : null}
    </div>
  )

  return (
    <MoneyFrame
      active="gst-register"
      actions={
        <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
          Create invoice
        </Button>
      }
    >
      <SumBar
        label="Totals for the invoices shown"
        items={
          isAdmin
            ? [
                { label: 'Invoices', count: totals.count, sub: all.length ? `${rangeLabel(shown.length ? shown : all)}, by invoice date` : 'By invoice date' },
                { label: 'Net', amount: totals.net, sub: 'Before GST' },
                { label: 'GST', amount: totals.gst, sub: 'Output tax on the invoices' },
                { label: 'Gross', amount: totals.gross, sub: 'Net + GST' },
              ]
            : [
                { label: 'Invoices', count: totals.count, sub: all.length ? `${rangeLabel(shown.length ? shown : all)}, by invoice date` : 'By invoice date' },
                { label: 'Gross', amount: totals.gross, sub: 'GST included' },
              ]
        }
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
            ? { title: 'The invoices did not load', message: 'Your invoices are safe. The server did not answer in time. Try again, and if it keeps failing, tell the admin.', onRetry: () => void register.refetch() }
            : null
        }
        toolbar={({ selectedCount }) => (
          <div className="grid gap-3">
            {header}
            {controls}
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
                  <InfoTip label="About PSID">PSID is the payment slip number FBR gives a tax deposit. Paste it once: it is written to every ticked invoice.</InfoTip>
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
                    className="num w-[180px]"
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
          attention || tcs || search.trim() ? (
            <NoResults
              query={search}
              scope="invoices"
              fields="invoice number, customer and order number"
              filtersOn={attention ? ['Needs attention'] : tcs ? ['Not sent by TCS'] : []}
              onClear={() => {
                setView('all')
                setSearch('')
              }}
            />
          ) : (
            <EmptyState title="No invoices yet" actions={<Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Create invoice</Button>}>
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
            <span className="line-clamp-2 text-sm">{r.companyName}</span>
            {attentionReason(r) ? <span className="text-sm text-tone-warning-fg">{attentionReason(r)}</span> : null}
            <div className="flex flex-wrap gap-2">
              <StatusBadge dimension="tcs" value={r.courierState} />
              <StatusBadge dimension="fbr" value={r.fbrState} />
            </div>
          </div>
        )}
      />

      <CreateInvoiceDialog open={creating || linkedNew} onOpenChange={o => { if (!o) { setCreating(false); if (linkedNew) closeLinked() } }} orderId={creating ? undefined : linkedOrder} />
      {opening ?? linkedInvoice ? <InvoiceDetailDialog invoiceId={(opening ?? linkedInvoice) as string} onClose={closeInvoice} /> : null}
    </MoneyFrame>
  )
}
