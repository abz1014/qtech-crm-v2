import { useLayoutEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { Check, Download, Plus, Truck } from 'lucide-react'
import { generateCSV, downloadCSV } from '@/lib/csvExport'
import { businessToday } from '@/lib/dates'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { formatDay } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { orderRef } from '@/lib/refs'
import { useQueryParamText } from '@/lib/useQueryParamText'
import { useSession } from '@/app/session'
import { Button } from '@/ui/Button'
import { DataTable, type Column } from '@/ui/DataTable'
import { EmptyState } from '@/ui/EmptyState'
import { Money } from '@/ui/Money'
import { MoreMenu } from '@/ui/MoreMenu'
import { NoResults } from '@/ui/NoResults'
import { MenuItem } from '@/ui/Popover'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { StatusText } from '@/ui/StatusText'
import { StickyActionBar } from '@/ui/StickyActionBar'
import { Select } from '@/ui/form/Select'
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
import { CreditNotePdfButton } from '@/features/money/invoices/pdf/CreditNotePdfButton'
import {
  invoiceNextStep,
  isCreditNote,
  cleanPsid,
  matchesSearch,
  isInert,
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
 * Money > Invoices (M01; g2-money "GST register, by invoice date" and "month stamping"). Admin and sales: the one register,
 * every invoice goes to FBR. Grouped by invoice month with month subtotals; the courier (TCS) and FBR states are one chip each
 * (owner decision 2026-10-19: the chip or the bar, not both), "Needs attention" for tax not deposited in an earlier month and for a
 * step recorded without the one before it. Sales tick and stamp like the admin (Today sends them the TCS and FBR items, and the
 * stamp functions of 0020 accept them); their register leaves out the Net and GST columns, and Export stays the admin's.
 *
 * Month stamping: tick a month (1), then "Invoice posted today" (2), paste the PSID once and press Enter or "Add PSID", then
 * "Deposited today" (3): at most 3 taps and 1 paste. Each stamp writes today's date to the ticked invoices, and Undo stays on the
 * toast for 10 seconds. Export is admin only (in the toolbar's More menu); sales see the same register without it.
 *
 * Toolbar (round-2 R2-15, spec 3.2): "Search invoices" (kept in `?q=`), ONE switch "All · Needs attention N · Not sent by TCS N"
 * (the counts are needs-you pills), More (Export). "Create invoice" is the page's one green action, in the Money header, the
 * same words as on the order.
 */
type RegisterView = 'all' | 'attention' | 'tcs'

/** The invoice's one Next step, with why under it when it is late or out of order. */
function InvoiceStep({ r, className }: { r: GstRow; className?: string }) {
  const s = invoiceNextStep(r)
  return (
    <StatusText tone={s.tone} detail={s.detail} className={className}>
      {s.label}
    </StatusText>
  )
}

/**
 * The phone's sticky bar sits ABOVE the bottom tabs (they stay, so Jobs and To do are one tap away): the bar is lifted by the
 * tabs' own height, kept in --tabs-h while the page is open. StickyActionBar is used as it is; only its `bottom` is overridden.
 */
function useTabsHeight(on: boolean) {
  useLayoutEffect(() => {
    if (!on) return
    // the phone's bottom tabs: the "Main" nav that is drawn (the top bar's is hidden below 768, so it measures 0)
    const navs = Array.from(document.querySelectorAll('nav[aria-label="Main"]'))
    const nav = navs.find(n => n.getBoundingClientRect().height > 0) ?? navs[navs.length - 1] ?? null
    const set = () => document.documentElement.style.setProperty('--tabs-h', `${nav ? Math.round(nav.getBoundingClientRect().height) : 0}px`)
    set()
    const ro = nav && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(set) : null
    if (nav) ro?.observe(nav)
    return () => {
      ro?.disconnect()
      document.documentElement.style.removeProperty('--tabs-h')
    }
  }, [on])
}

export function GstRegisterPage() {
  const session = useSession()
  const isAdmin = session.status === 'signed-in' && session.user.role === 'admin'
  const register = useGstRegister()
  const toast = useToast()
  const stamps = useStamps()
  const [params, setParams] = useSearchParams()
  // Today's "FBR attention" item opens it on Needs attention (?attention=1), and "not posted" on that view (?tcs=1).
  const [view, setView] = useState<RegisterView>(() => (params.get('attention') === '1' ? 'attention' : params.get('tcs') === '1' ? 'tcs' : 'all'))
  const attention = view === 'attention'
  const tcs = view === 'tcs'
  const [search, setSearch] = useQueryParamText()
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
  const [psid, setPsid] = useState('')
  const [busy, setBusy] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  // Below 768 "Create invoice" is in the sticky bar (the page's one green button); from 768 it stays in the page header.
  const phone = useMediaQuery('(max-width: 767px)')
  useTabsHeight(phone)

  const all = useMemo(() => register.data ?? [], [register.data])
  const attentionCount = useMemo(() => all.filter(needsAttention).length, [all])
  const tcsCount = useMemo(() => all.filter(tcsNotSent).length, [all])
  const shown = useMemo(() => all.filter(r => (!attention || needsAttention(r)) && (!tcs || tcsNotSent(r)) && matchesSearch(r, search)), [all, attention, tcs, search])
  const totals = registerTotals(shown)
  const monthCounts = useMemo(() => {
    const m = new Map<string, number>()
    // invoices only: a void invoice and a credit note stay in the month's lines but are not another invoice (same rule as the totals)
    for (const r of shown) m.set(rowMonth(r), (m.get(rowMonth(r)) ?? 0) + (isInert(r) ? 0 : 1))
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
        cell: r => (
          <span className="num">
            {r.number ?? <span className="font-sans text-fg-muted">No number</span>}
            {isCreditNote(r) ? <span className="ml-2 font-sans text-xs text-fg-2">Credit note</span> : null}
            {r.voided ? <span className="ml-2 font-sans text-xs text-tone-danger-fg">Void</span> : null}
          </span>
        ),
      },
      { id: 'date', header: 'Date', kind: 'date', sortable: true, hideBelowLg: true, value: r => r.invoiceDate, cell: r => (r.invoiceDate ? formatDay(r.invoiceDate).replace(/^\w+ /, '') : '—') },
      {
        id: 'customer',
        header: 'Customer',
        sortable: true,
        value: r => r.companyName,
        cell: r => (
          <span className="grid gap-px">
            <span className="min-w-[12ch] [overflow-wrap:break-word] font-medium">{r.companyName ?? 'No customer'}</span>
            {r.orderNumber !== null ? <span className="num text-xs text-fg-2">{orderRef(r.orderNumber)}</span> : null}
            {/* below 1024 the Date column is hidden to make room for Net and GST: the date sits under the name */}
            {r.invoiceDate ? <span className="num text-xs text-fg-2 lg:hidden">{formatDay(r.invoiceDate).replace(/^\w+ /, '')}</span> : null}
          </span>
        ),
      },
      { id: 'net', header: 'Net', kind: 'money', sortable: true, value: r => String(r.net), total: true },
      { id: 'gst', header: 'GST', kind: 'money', sortable: true, value: r => String(r.gst), total: true },
      { id: 'gross', header: 'Gross', kind: 'money', sortable: true, value: r => String(r.gross), total: true },
      // ONE Next step (round 3) in place of the two chip columns, sent to customer and tax deposited.
      { id: 'next', header: 'Next step', sortable: false, cell: r => <InvoiceStep r={r} /> },
      {
        id: 'pdf',
        header: 'PDF',
        sortable: false,
        // stop the row's own click (it opens the invoice) for the button and for its dialog, whose events bubble through the portal
        cell: r => (
          <span onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
            {isCreditNote(r) ? (
              <CreditNotePdfButton creditNoteId={r.invoiceId} />
            ) : r.voided ? null : (
              <InvoicePdfButton invoiceId={r.invoiceId} iconOnly size="sm" label={`Print invoice ${r.number ?? ''}`.trim()} />
            )}
          </span>
        ),
      },
    ]
    // Sales stamp too (M08 sends them the TCS and FBR items; the 0020 RPCs allow it): they keep the ticks, the toggles and the
    // stamps, and only lose the Net and GST columns, which are the admin's filing figures.
    return isAdmin ? cols : cols.filter(c => c.id !== 'net' && c.id !== 'gst')
    // a ticked row has the selected background, where the amber text is below 4.5:1, so it reads in the body colour there
  }, [isAdmin])

  const stamp = async (kind: StampKind) => {
    if (busy || tickedRows.length === 0) return
    const targets = stampable(tickedRows, kind)
    if (kind !== 'psid' && targets.length === 0) {
      toast.toast({ title: kind === 'tcs' ? 'Already sent to the customer' : 'Already deposited', body: `Nothing to stamp on the ${tickedRows.length} ticked ${tickedRows.length === 1 ? 'invoice' : 'invoices'}.`, tone: 'neutral' })
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
      const what = kind === 'tcs' ? 'sent to the customer today' : kind === 'deposit' ? 'deposited today' : `given PSID ${clean}`
      toast.toast({
        title: `Marked ${res.n} ${word} ${what}`,
        body: `Today, ${formatDay(businessToday())}`,
        tone: 'success',
        // 0128: taking a PSID or a deposit date back off an invoice is the admin's (the database refuses sales), so only the
        // admin is offered Undo on those two stamps; sending to the customer can still be taken back by sales
        undo:
          kind === 'tcs' || isAdmin
            ? {
                onUndo: async () => {
                  await res.undo()
                },
                settledTitle: `Marked ${res.n} ${word} ${what}`,
                undoneTitle: 'Stamp taken back',
              }
            : undefined,
      })
      if (kind === 'psid') setPsid('')
    } catch (err) {
      toast.toast({ title: "The invoices were not stamped", body: mapPgError(err, { entity: 'invoice' }).message, tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const exportCsv = () => {
    const csv = generateCSV(
      ['Invoice', 'Type', 'Date', 'Customer', 'Order', 'Net', 'GST', 'Gross', 'Courier (TCS)', 'FBR', 'PSID', 'Deposited on'],
      shown.map(r => [r.number, isCreditNote(r) ? 'Credit note' : r.voided ? 'Void' : 'Invoice', r.invoiceDate, r.companyName, r.orderNumber === null ? '' : orderRef(r.orderNumber), r.net, r.gst, r.gross, r.courierState, r.fbrState, r.psid, r.taxDepositedOn]),
    )
    downloadCSV(csv, 'gst-register.csv')
  }

  const viewOptions = [
    { value: 'all', label: 'All' },
    { value: 'attention', label: 'Needs attention', needs: attentionCount },
    { value: 'tcs', label: 'Not sent yet', needs: tcsCount },
  ]
  const header = (
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="text-base font-semibold">GST register</h2>
      <InfoTip label="About sending, FBR and PSID">
        By invoice date{all.length > 0 ? `, ${rangeLabel(all)}` : ''}. <b className="font-medium text-fg">Invoice posted</b> means the TCS courier took
        the invoice to the customer. <b className="font-medium text-fg">FBR</b> is the tax office: the GST on every invoice is deposited with FBR.{' '}
        <b className="font-medium text-fg">PSID</b> is the payment slip number FBR gives a deposit. One PSID can cover several invoices. Money actually
        received is under To collect.
      </InfoTip>
    </div>
  )
  // Toolbar row 2 (spec 3.2): the search, ONE switch (each view matches one stamping job; the needs-you counts as NeedsCount
  // pills), and Export in a More menu for the admin.
  const controls = (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:flex-wrap">
      <TableFilter label="Search invoices" hint="Finds an invoice by invoice number, customer or order number." value={search} onChange={setSearch} className="max-sm:col-span-2" />
      <span className="flex-1 max-sm:hidden" />
      {/* A phone gets the same three views as a select: a strip of three would run off a 320 px screen. */}
      <label className={cn('grid min-w-0 sm:hidden', !isAdmin && 'col-span-2')}>
        <span className="sr-only">Show</span>
        <Select data-testid="register-view" value={view} onChange={e => setView(e.target.value as RegisterView)} options={viewOptions.map(o => ({ value: o.value, label: o.needs ? `${o.label} (${o.needs})` : o.label }))} />
      </label>
      <SegmentedControl aria-label="Show" value={view} onValueChange={v => setView(v as RegisterView)} options={viewOptions} className="max-sm:hidden" />
      {isAdmin ? (
        <MoreMenu label="More for the register">
          <MenuItem icon={Download} onClick={exportCsv} disabled={shown.length === 0}>
            Export CSV
          </MenuItem>
        </MoreMenu>
      ) : null}
    </div>
  )

  return (
    <MoneyFrame
      active="gst-register"
      actions={
        phone ? undefined : (
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            Create invoice
          </Button>
        )
      }
    >
      <SumBar
        label="Totals for the invoices shown"
        phone="lines"
        desktop="strip"
        caption={`PKR · ${all.length ? `${rangeLabel(shown.length ? shown : all)}, by invoice date` : 'By invoice date'}`}
        items={
          isAdmin
            ? [
                { label: 'Invoices', count: totals.count, sub: all.length ? `${rangeLabel(shown.length ? shown : all)}, by invoice date` : 'By invoice date' },
                { label: 'Net', amount: totals.net, sub: 'Before GST' },
                { label: 'GST', amount: totals.gst, sub: 'GST charged on the invoices' },
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
        className="md:rounded-none md:border-x-0"
        sortParam="sort"
        columns={columns}
        rows={shown}
        getRowId={r => r.invoiceId}
        twoLine
        group={r => ({ key: rowMonth(r), label: `${rowMonth(r)} · ${monthCounts.get(rowMonth(r)) ?? 0} ${(monthCounts.get(rowMonth(r)) ?? 0) === 1 ? 'invoice' : 'invoices'}` })}
        // Phone: the month carries its own Net, GST and Gross (sales: Gross only), summed in paisa from the month's rows.
        mobileGroup={(month, rows) => {
          const t = registerTotals(rows)
          const n = monthCounts.get(month) ?? rows.length
          const figures: Array<[string, number]> = isAdmin ? [['Net', t.net], ['GST', t.gst], ['Gross', t.gross]] : [['Gross', t.gross]]
          return (
            <div className="grid gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="type-section">{month}</span>
                <span className="type-body text-fg-2">{`${n} ${n === 1 ? 'invoice' : 'invoices'}`}</span>
              </div>
              <dl className="flex flex-wrap gap-x-4 gap-y-2">
                {figures.map(([name, v]) => (
                  <div key={name} className="grid gap-px">
                    <dt className="type-body text-fg-2">{name}</dt>
                    <dd className="num type-row">
                      <Money value={v} prefix={false} paisa="never" strong />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )
        }}
        selection={{ selected: ticked, onChange: s => setTicked(s), rowLabel: r => r.number ?? 'invoice' }}
        onRowOpen={r => setOpening(isCreditNote(r) ? (r.againstInvoiceId ?? r.invoiceId) : r.invoiceId)}
        footerLabel={`All ${totals.count} ${totals.count === 1 ? 'invoice' : 'invoices'} shown`}
        loading={register.isPending}
        error={
          register.isError
            ? { title: 'The invoices did not load', message: 'Invoices are safe. The server did not answer in time. Try again, and if it keeps failing, tell the admin.', onRetry: () => void register.refetch() }
            : null
        }
        toolbar={({ selectedCount }) => (
          // The full width of the card and no wider (min-w-0): on a phone the search and the view select stay on screen.
          <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
            {header}
            {controls}
            {selectedCount > 0 ? (
              <div data-testid="batch-bar" className="-mx-4 flex w-[calc(100%+2rem)] flex-wrap items-center gap-3 border-y bg-sunken px-4 py-2">
                <span className="text-sm">
                  <b className="num font-medium">{selectedCount}</b> {selectedCount === 1 ? 'invoice' : 'invoices'} ticked
                </span>
                <span className="flex-1" />
                <Button size="sm" icon={Truck} onClick={() => void stamp('tcs')} disabled={busy} title="The TCS courier took them today">
                  Invoice posted today
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
              filtersOn={attention ? ['Needs attention'] : tcs ? ['Not sent yet'] : []}
              onClear={() => {
                setView('all')
                setSearch('')
              }}
            />
          ) : (
            <EmptyState title="No invoices yet" actions={<Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Create invoice</Button>}>
              Invoices appear here when they are created from an order, by invoice date. Every invoice goes to FBR.
            </EmptyState>
          )
        }
        // Phone card (clarity lane L2): number and gross, then the customer, then the one next step. The admin's tap unfolds Net,
        // GST, Open invoice and PDF; sales have no Net or GST, so their tap opens the invoice as before.
        mobileRow={r => (
          <div className="grid gap-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="num type-row">
                {r.number ?? 'No number'}
                {isCreditNote(r) ? ' (credit note)' : r.voided ? ' (void)' : ''}
              </span>
              <span className="num type-row">
                <Money value={r.gross} prefix={false} paisa="never" strong />
              </span>
            </div>
            <span className="type-body min-w-0 [overflow-wrap:anywhere]">{r.companyName}</span>
            <InvoiceStep r={r} className="text-base [&_span]:text-base" />
          </div>
        )}
        mobileExpand={
          isAdmin
            ? r => (
                <div className="mt-3 grid gap-2 border-t border-dashed border-line pt-3">
                  <dl className="grid gap-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="type-body">Net</dt>
                      <dd className="num type-row">
                        <Money value={r.net} prefix={false} paisa="never" strong />
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="type-body">GST</dt>
                      <dd className="num type-row">
                        <Money value={r.gst} prefix={false} paisa="never" strong />
                      </dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="touch" onClick={() => setOpening(isCreditNote(r) ? (r.againstInvoiceId ?? r.invoiceId) : r.invoiceId)}>
                      Open invoice
                    </Button>
                    {isCreditNote(r) ? <CreditNotePdfButton creditNoteId={r.invoiceId} /> : r.voided ? null : <InvoicePdfButton invoiceId={r.invoiceId} size="touch" label="PDF" />}
                  </div>
                </div>
              )
            : undefined
        }
      />

      {phone ? (
        <>
          {/* keeps the last card clear of the bar */}
          <div aria-hidden="true" className="h-16" />
          <StickyActionBar
            label="Invoice actions"
            className="bottom-[var(--tabs-h,0px)]"
            primary={
              <Button variant="primary" size="touch" icon={Plus} onClick={() => setCreating(true)}>
                Create invoice
              </Button>
            }
          />
        </>
      ) : null}

      <CreateInvoiceDialog open={creating || linkedNew} onOpenChange={o => { if (!o) { setCreating(false); if (linkedNew) closeLinked() } }} orderId={creating ? undefined : linkedOrder} />
      {opening ?? linkedInvoice ? <InvoiceDetailDialog invoiceId={(opening ?? linkedInvoice) as string} onClose={closeInvoice} /> : null}
    </MoneyFrame>
  )
}
