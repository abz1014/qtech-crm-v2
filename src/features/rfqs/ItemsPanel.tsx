import { Clock, Info, TriangleAlert } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatDay } from '@/lib/formatDay'
import { formatAmount, formatPaisa, formatRate, fxStaleness } from '@/lib/money'
import { Banner } from '@/ui/Banner'
import { Icon } from '@/ui/Icon'
import { StatusBadge } from '@/ui/StatusBadge'
import { Tag } from '@/ui/Tag'
import { Panel } from '@/features/companies/CompanyParts'
import type { InquiryRow, QuoteLineRow, RfqItemRow } from '@/features/rfqs/api'
import { comparePrices, reasonForItem, reasonLabel, type ComparedLine, type RateTable } from '@/features/rfqs/lib'
import { qtyText } from '@/features/rfqs/lib'

/*
 * Items and what each supplier quoted for them (R07). Every price is shown in the supplier's own currency first, then in PKR
 * at TODAY's rate. The lowest is marked by comparePrices (R15) only among lines that can be compared; a line with no
 * usable rate says "not compared, no rate" quietly and never blocks anything (BUILD_PLAN A3/A4). The rate captured when the
 * price was entered is shown beside today's, with its own age band, labelled as the rate at entry.
 */

const daysBetween = (from: string, to: string) => Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86_400_000)

const HEAD = 'hidden px-5 py-2 text-xs text-fg-muted md:grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,0.9fr)_104px] md:gap-4'
const ROW = 'grid gap-x-4 gap-y-2 border-t px-5 py-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,0.9fr)_104px]'

function Label({ children }: { children: string }) {
  return <span className="text-xs text-fg-muted md:sr-only">{children}</span>
}

function PkrCell({ line, c, rates }: { line: QuoteLineRow; c: ComparedLine; rates: RateTable }) {
  const today = businessToday()
  const rate = rates[line.currency]
  if (line.currency === 'PKR') return <span className="text-xs text-fg-muted">PKR, no conversion</span>
  const captured =
    line.fxRatePkr !== null && line.fxRateOn ? (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
        <span className="num">{`At entry ${formatRate(line.fxRatePkr)} · ${formatDay(line.fxRateOn)}`}</span>
        <StatusBadge dimension="fx" value={fxStaleness(Math.max(0, daysBetween(line.fxRateOn, today)))} detail={`${Math.max(0, daysBetween(line.fxRateOn, today))} d`} />
      </span>
    ) : (
      <StatusBadge dimension="fx-capture" value="none" />
    )
  return (
    <span className="grid gap-1">
      {c.pkrPaisa !== null ? (
        <>
          <span className="num text-sm">
            <span className="mr-1 font-sans text-xs text-fg-muted">≈ PKR</span>
            {formatPaisa(c.pkrPaisa)}
          </span>
          {c.band === 'stale' ? (
            <span className="flex items-center gap-1 text-xs text-tone-warning-fg">
              <Icon icon={TriangleAlert} size="chip" />
              {`${line.currency} ${formatRate(rate?.rate ?? 0)}, rate ${c.rateAgeDays} days old`}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-fg-muted">
              <Icon icon={Clock} size="chip" />
              {`${line.currency} ${formatRate(rate?.rate ?? 0)}, ${c.rateAgeDays === 0 ? "today's rate" : `rate from ${c.rateAgeDays} ${c.rateAgeDays === 1 ? 'day' : 'days'} ago`}`}
            </span>
          )}
        </>
      ) : (
        <span className="inline-flex w-fit items-center gap-1 rounded-round bg-selected px-2 py-[2px] text-xs text-fg-2">
          <Icon icon={Info} size="chip" />
          {c.notCompared === 'unusable' ? 'not compared — rate too old' : 'not compared — no rate'}
        </span>
      )}
      {captured}
    </span>
  )
}

interface Entry {
  line: QuoteLineRow
  supplier: string
  c: ComparedLine
}

export function ItemsPanel({ items, inquiries, rates }: { items: RfqItemRow[]; inquiries: InquiryRow[]; rates: RateTable }) {
  const responders = inquiries.filter(i => i.lines.length > 0)
  const pricedItems = items.filter(it => inquiries.some(i => i.lines.some(l => l.itemId === it.id))).length
  return (
    <Panel
      title="Items and prices"
      meta={
        <>
          {items.length} {items.length === 1 ? 'item' : 'items'} · {inquiries.length} {inquiries.length === 1 ? 'supplier' : 'suppliers'} asked · {pricedItems} with a price
        </>
      }
    >
      {items.length === 0 ? (
        <p className="px-5 py-6 text-sm text-fg-muted">This RFQ has no items yet.</p>
      ) : (
        <div className="divide-y">
          {items.map(item => {
            const entries: Entry[] = []
            const lines = inquiries.flatMap(i => i.lines.filter(l => l.itemId === item.id).map(l => ({ l, supplier: i.supplierName })))
            const cmp = comparePrices(
              lines.map(({ l }) => ({ id: l.id, amount: l.unitPrice, currency: l.currency })),
              rates,
            )
            for (const { l, supplier } of lines) entries.push({ line: l, supplier, c: cmp.lines.find(x => x.id === l.id) as ComparedLine })
            // Cheapest first among the compared, then the lines left out of the comparison.
            entries.sort((a, b) => {
              if (a.c.compared !== b.c.compared) return a.c.compared ? -1 : 1
              if (a.c.pkrPaisa !== null && b.c.pkrPaisa !== null) return a.c.pkrPaisa < b.c.pkrPaisa ? -1 : a.c.pkrPaisa > b.c.pkrPaisa ? 1 : 0
              return a.line.unitPrice - b.line.unitPrice
            })
            const declined = inquiries
              .filter(i => !i.lines.some(l => l.itemId === item.id))
              .map(i => ({ i, reason: reasonForItem(item.id, i), own: Boolean(i.itemDeclines[item.id]) }))
              .filter(d => d.reason || d.own)
            const waiting = inquiries.filter(i => i.sentOn && !i.noOfferOn && i.lines.length === 0)
            const uncovered = lines.length === 0 && responders.length > 0
            const q = qtyText(item.qty, item.unit)
            const unitless = cmp.lines.filter(x => !x.compared).length
            return (
              <article key={item.id} aria-label={`Item ${item.number}`} className="min-w-0">
                <header className="flex flex-wrap items-start gap-x-3 gap-y-2 px-5 pt-4">
                  <span className="num mt-[2px] grid h-6 min-w-6 place-items-center rounded border border-line-strong px-1 text-xs">{item.number}</span>
                  <div className="min-w-0 flex-1 basis-64">
                    <h3 className="text-base font-medium text-pretty">{item.description}</h3>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-fg-muted">
                      {q ? <span className="num">{q}</span> : null}
                      {item.brandName ? <Tag>{item.brandName}</Tag> : null}
                    </p>
                  </div>
                  {lines.length > 0 ? (
                    <StatusBadge dimension="sourcing" value="covered" label={`Covered, ${lines.length} ${lines.length === 1 ? 'price' : 'prices'}`} />
                  ) : uncovered ? (
                    <StatusBadge dimension="sourcing" value="no-offer" label="Uncovered item" />
                  ) : (
                    <StatusBadge dimension="inquiry" value="awaiting" label="No prices yet" />
                  )}
                </header>

                {uncovered ? (
                  <div className="px-5 pt-3">
                    <Banner tone="danger" title={`None of the ${responders.length} ${responders.length === 1 ? 'supplier' : 'suppliers'} who replied quoted this item.`}>
                      {waiting.length > 0
                        ? `${waiting.map(w => w.supplierName).join(', ')} ${waiting.length === 1 ? 'has' : 'have'} not replied yet. `
                        : ''}
                      Ask someone else before the bid is due.
                    </Banner>
                  </div>
                ) : null}

                {entries.length > 0 || declined.length > 0 ? (
                  <div className="mt-3">
                    <div className={HEAD} aria-hidden="true">
                      <span>Supplier</span>
                      <span className="text-right">Price</span>
                      <span>In PKR at today&apos;s rate</span>
                      <span>Lead time</span>
                      <span>Stock</span>
                    </div>
                    <ul>
                      {entries.map(({ line, supplier, c }) => (
                        <li key={line.id} className={ROW} data-lowest={c.lowest ? '' : undefined} data-compared={c.compared && c.pkrPaisa !== null ? '' : undefined}>
                          <div className="grid gap-1">
                            <Label>Supplier</Label>
                            <span className="min-w-0 break-words text-sm font-medium">{supplier}</span>
                          </div>
                          <div className="grid gap-1 md:justify-items-end">
                            <Label>Price</Label>
                            <span className="num whitespace-nowrap text-sm font-medium">
                              <span className="mr-1 font-sans text-xs font-regular text-fg-muted">{line.currency}</span>
                              {formatAmount(line.unitPrice, 'always')}
                            </span>
                          </div>
                          <div className="grid content-start gap-1">
                            <Label>In PKR at today&apos;s rate</Label>
                            <span className="flex flex-wrap items-start gap-2">
                              {c.lowest ? <StatusBadge dimension="sourcing" value="covered" label="Lowest" /> : null}
                              <PkrCell line={line} c={c} rates={rates} />
                            </span>
                          </div>
                          <div className="grid content-start gap-1">
                            <Label>Lead time</Label>
                            <span className="text-sm">{line.leadTime ?? <span className="text-fg-muted">—</span>}</span>
                          </div>
                          <div className="grid content-start gap-1">
                            <Label>Stock</Label>
                            <span className="flex items-center gap-2 text-sm">
                              {line.inStock === null ? (
                                <span className="text-fg-muted">—</span>
                              ) : (
                                <>
                                  <i aria-hidden="true" className={`size-[6px] rounded-round ${line.inStock ? 'bg-tone-success-fg' : 'border border-fg-muted'}`} />
                                  {line.inStock ? 'In stock' : 'Not in stock'}
                                </>
                              )}
                            </span>
                          </div>
                        </li>
                      ))}
                      {declined.map(({ i, reason }) => (
                        <li key={i.id} className={`${ROW} text-fg-muted`}>
                          <span className="min-w-0 break-words text-sm font-medium text-fg-2">{i.supplierName}</span>
                          <span className="text-sm md:col-span-4">{`Can't quote: ${reasonLabel(reason)}`}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="flex items-start gap-2 border-t px-5 py-3 text-xs text-fg-muted">
                      <Icon icon={Info} size="sm" className="mt-[1px]" />
                      <span>
                        {cmp.comparableCount >= 2
                          ? `Lowest of the ${cmp.comparableCount} compared. ${cmp.basis === 'pkr' ? "Compared in PKR at today's rates." : 'Same currency, compared as quoted.'}`
                          : entries.length === 0
                            ? 'Nobody has priced this item.'
                            : 'One price so far. Nothing to compare yet.'}
                        {unitless > 0 && cmp.comparableCount >= 2 ? ` ${unitless} ${unitless === 1 ? 'line is' : 'lines are'} not compared because there is no rate for ${unitless === 1 ? 'its' : 'their'} currency.` : ''}
                      </span>
                    </p>
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      )}
    </Panel>
  )
}
