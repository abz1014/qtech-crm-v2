import { EyeOff, Info, Tag as TagIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatShortDate } from '@/lib/formatDay'
import type { MemoryCard as Card, PriceFact } from '@/lib/memory'
import { Icon } from '@/ui/Icon'
import { Tag } from '@/ui/Tag'

/*
 * The memory card (R17; g2-intake-float.html "Memory card states"). Facts about one supplier for one item: the last quote,
 * the last ordered price, the lead time as they wrote it, the brands they carry, how they reply, what came of it.
 * Every figure is a count out of a count, there is no score, a price shows the rate of the day it was entered, and the
 * footnote says where it comes from. Built from lib/memory (pure); this file only lays it out.
 */

const CELL = 'grid min-w-0 content-start gap-[6px] bg-surface px-4 py-3'

function Cell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={CELL}>
      <h5 className="text-sm text-fg-muted">{title}</h5>
      {children}
    </div>
  )
}

const None = ({ text = 'None on file' }: { text?: string }) => <p className="text-base text-fg-muted">{text}</p>

function Price({ fact, source }: { fact: PriceFact; source?: boolean }) {
  if (fact.state === 'none') return <None />
  const when = fact.date ? (
    <span className="num">
      {fact.date.text}
      {fact.date.ago ? <span className="text-tone-warning-fg">{` · ${fact.date.ago}`}</span> : null}
    </span>
  ) : null
  if (fact.state === 'hidden') {
    return (
      <>
        <p className="flex items-center gap-2 text-base">
          <Icon icon={EyeOff} size="sm" className="text-fg-muted" />
          Price on file
        </p>
        <p className="text-xs text-fg-muted">
          {fact.note}
          {when ? <> · {when}</> : null}
          {fact.imported ? <> · <Tag dashed>Imported</Tag></> : null}
        </p>
      </>
    )
  }
  return (
    <>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="num text-lg font-medium">{fact.amount}</span>
        <span className="text-xs text-fg-muted">each</span>
      </p>
      {fact.pkr ? (
        <p className="text-xs text-fg-muted">
          <span className="num">≈ PKR {fact.pkr}</span> <span className="underline decoration-dotted underline-offset-2">at the time</span>
          {fact.rate ? <span className="num">{` (rate ${fact.rate})`}</span> : null}
        </p>
      ) : null}
      {fact.note ? <p className="text-xs text-fg-muted">{fact.note}</p> : null}
      <p className="flex flex-wrap items-center gap-x-1 text-xs text-fg-muted">
        {source && fact.source ? <span>{fact.source}</span> : null}
        {source && fact.source && when ? <span aria-hidden="true">·</span> : null}
        {when}
        {fact.qty ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="num">qty {fact.qty}</span>
          </>
        ) : null}
        {fact.imported ? <Tag dashed className="ml-1">Imported</Tag> : null}
      </p>
    </>
  )
}

export function MemoryCardView({
  id,
  supplierName,
  itemLine,
  card,
  today,
  fallbackTier,
}: {
  id?: string
  supplierName: string
  /** "For item 3, Siemens SITRANS P320 pressure transmitter." */
  itemLine: string
  card: Card
  /** Today (YYYY-MM-DD, business timezone). */
  today: string
  /** The suggestion's own tier label, shown when the history has no item-level match (a brand or family they carry). */
  fallbackTier?: string
}) {
  const tier = card.tierLabel ?? fallbackTier ?? null
  const scope = card.scope
  return (
    <section id={id} aria-label={`What we know about ${supplierName}`} className="overflow-hidden rounded border bg-surface" data-memory-card>
      <header className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b bg-sunken px-4 py-3">
        <div className="min-w-0 flex-1 basis-60">
          <h4 className="text-sm font-semibold">What we know about {supplierName}</h4>
          <p className="mt-1 text-xs text-fg-muted text-pretty">
            {itemLine} {card.matchedOn}
          </p>
        </div>
        {tier ? (
          <span className="inline-flex h-5 shrink-0 items-center gap-[6px] whitespace-nowrap rounded border border-line-strong bg-surface px-[6px] text-xs text-fg-2">
            <Icon icon={TagIcon} size="chip" />
            {tier}
          </span>
        ) : null}
      </header>

      <div className="grid gap-px bg-line md:grid-cols-3">
        <Cell title={`Last quoted for this ${scope}`}>
          <Price fact={card.quote} />
        </Cell>
        <Cell title="Last ordered price">
          <Price fact={card.ordered} source />
        </Cell>
        <Cell title="Lead time">
          {card.lead.latest ? (
            <>
              <p className="text-base text-pretty">{card.lead.latest}</p>
              <p className="text-xs text-fg-muted">
                As the supplier wrote it.{card.lead.before ? <> Before that: “{card.lead.before}”.</> : null}
              </p>
            </>
          ) : (
            <None />
          )}
        </Cell>
        <Cell title="Brands carried">
          {card.brands.length > 0 ? (
            <ul className="flex flex-wrap gap-[6px]">
              {card.brands.map(b => (
                <li key={b}>
                  <Tag className="h-6 px-2 text-sm">{b}</Tag>
                </li>
              ))}
            </ul>
          ) : (
            <None text="None listed" />
          )}
        </Cell>
        <Cell title="Replies">
          <p className={cn('text-base', card.replies.main === 'No history yet' && 'text-fg-muted')}>{card.replies.main}</p>
          {card.replies.sub ? <p className="text-xs text-fg-muted">{card.replies.sub}</p> : null}
        </Cell>
        {card.orders ? (
          <Cell title="Orders and deliveries">
            <p className="text-base">{card.orders.main}</p>
            {card.orders.sub ? <p className="text-xs text-fg-muted text-pretty">{card.orders.sub}</p> : null}
          </Cell>
        ) : (
          <Cell title="Last contact">
            {card.lastContact ? <p className="num text-base">{formatShortDate(card.lastContact, today)}</p> : <None text="Never contacted" />}
          </Cell>
        )}
      </div>

      <footer className="flex items-start gap-2 border-t bg-sunken px-4 py-3 text-xs text-fg-muted">
        <Icon icon={Info} size="sm" className="mt-[1px]" />
        <p className="text-pretty">{card.footnote || 'Counts come from enquiries, quote lines, purchase orders and delivery dates. Nothing here is typed in.'}</p>
      </footer>
    </section>
  )
}
