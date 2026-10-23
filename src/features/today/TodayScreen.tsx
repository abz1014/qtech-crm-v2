import { Suspense, useEffect, useMemo, useState } from 'react'
import { Banknote, CalendarCheck, Calculator, ChevronDown, ChevronRight, FileCheck, HardHat, Hourglass, Landmark, MessageCircleQuestion, Package, PackageCheck, PackageSearch, Repeat, ReceiptText, Reply, Send, Share2, ShoppingCart, Truck, Users, Wrench, type LucideIcon } from 'lucide-react'
import { seesPrices, useSession } from '@/app/session'
import { formatDay } from '@/lib/formatDay'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'
import { pkr } from '@/features/money/expenses/model'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { Skeleton } from '@/ui/Skeleton'
import { FirstUseState } from '@/features/help/FirstUseState'
import { HowItWorksCard } from '@/features/help/HowItWorksCard'
import { useFirstUse } from '@/features/help/useFirstUse'
import { lazyWithReload } from '@/lib/importWithReload'
import { useBusinessToday, useTodayView } from '@/features/today/hooks'
import { needsYouItems } from '@/features/today/needsYou'
import { TargetTile } from '@/features/today/TargetTile'
import { isFreshChase } from '@/features/today/chaseMemory'
import { chasedByText } from '@/features/rfqs/lib/collision'
import { headerDate, waitingLine } from '@/features/today/text'
import type { Role, RuleKey, TodayItem, TodayTab } from '@/features/today/types'

/*
 * The context pane (what to do about an item: the chase text, the numbers, the buttons) is its own download (perf/lcp): on a
 * phone it opens on a tap, so the list does not wait for it. A wide screen shows it at once, so there it starts downloading
 * with the page.
 */
const loadContextPane = () => import('@/features/today/ContextPane')
const ContextPane = lazyWithReload(() => loadContextPane().then(m => ({ default: m.ContextPane })))
if (typeof window !== 'undefined' && window.matchMedia?.('(min-width: 768px)').matches) void loadContextPane().catch(() => {})

/*
 * Today (R11, direction B): a 420px list and a context pane. Groups: overdue or due today, the next 5 days, ready to
 * move, then Waiting (the system's cooldown, dimmed, never in the count of things that need you; collapsed until the person
 * opens it, "Waiting · 5 · next nudge Mon 30 Nov"). On a phone the pane folds into an accordion under the row. The target tile sits
 * under the list at every width (never for an engineer). The empty state is the goal state.
 *
 * Tabs (owner glossary 2026-10-19, short forms): All, Quotes, Suppliers, Money. They filter; they carry no number (redesign phase
 * 0: the one count, "N need you", is the header's and the Today badge's, from features/today/needsYou.ts). Engineers get no tabs
 * at all: their list is short (their jobs, their goods, the RFQs they own) and one list is easier.
 * Older than 30 days (needsYou.ts): a grey fold under Waiting, closed until opened, never counted. A late payment never goes there.
 */
const ICON: Record<RuleKey, LucideIcon> = {
  chase_customer: MessageCircleQuestion,
  relay_answers: Reply,
  not_floated: Share2,
  chase_supplier: Send,
  bid_due: FileCheck,
  decision_overdue: Hourglass,
  payment_overdue: Banknote,
  goods_late: Truck,
  place_po: ShoppingCart,
  plan_commissioning: Wrench,
  to_source: PackageSearch,
  delivered_not_invoiced: ReceiptText,
  close_month: CalendarCheck,
  costs_incomplete: Calculator,
  fbr_attention: Landmark,
  tcs_not_sent: Package,
  recurring_due: Repeat,
  job_commissioning: HardHat,
  job_on_site: PackageCheck,
}

// The glossary's "Quotations", and "Suppliers" (the short form of "Suppliers & delivery"), so the four tabs fit the list column in
// one row on a laptop; below that they wrap (never a sideways scroll).
const TAB_LABEL: Record<'all' | TodayTab, string> = { all: 'All', bids: 'Quotations', sourcing: 'Suppliers', money: 'Money' }
const WAITING_OPEN_MAX = 0 // Waiting opens only when the person opens it (R2-08)

/** Whether the person opened or closed the Waiting group, kept for this browser session only (null: not touched, the size decides). */
let waitingToggledThisSession: boolean | null = null
/** Whether the person opened the "Older than 30 days" fold, for this browser session only. */
let staleOpenThisSession = false
/** Whether the person opened the "Imported, to review" fold, for this browser session only. */
let importedOpenThisSession = false

export default function TodayScreen() {
  const session = useSession()
  if (session.status !== 'signed-in') return null
  return <TodayBody user={{ id: session.user.id, role: session.user.role as Role }} name={session.user.name} />
}

function TodayBody({ user, name }: { user: { id: string; role: Role }; name: string }) {
  const today = useBusinessToday()
  const { view, data, query } = useTodayView(user, today)
  const wide = useMediaQuery('(min-width: 768px)')
  const [tab, setTab] = useState<'all' | TodayTab>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [copied, setCopied] = useState<ReadonlySet<string>>(new Set())
  const [waitingToggled, setWaitingToggled] = useState<boolean | null>(waitingToggledThisSession)
  const [staleOpen, setStaleOpen] = useState(staleOpenThisSession)
  const [importedOpen, setImportedOpen] = useState(importedOpenThisSession)
  const markCopied = (k: string) => {
    setCopied(s => new Set(s).add(k))
    // On desktop the first item is shown without being picked; pin it, so the pane stays on it ("Moved to Waiting")
    // when the refresh moves it out of the active list instead of jumping to the next item.
    if (wide) setSelected(k)
  }
  const release = (k: string) =>
    setCopied(s => {
      const n = new Set(s)
      n.delete(k)
      return n
    })

  const inTab = (i: TodayItem) => tab === 'all' || i.tab === tab
  const active = useMemo(() => (view ? view.active.filter(inTab) : []), [view, tab]) // eslint-disable-line react-hooks/exhaustive-deps
  const waiting = useMemo(() => (view ? view.waiting.filter(inTab) : []), [view, tab]) // eslint-disable-line react-hooks/exhaustive-deps
  const stale = useMemo(() => (view ? view.stale.filter(inTab) : []), [view, tab]) // eslint-disable-line react-hooks/exhaustive-deps
  const imported = useMemo(() => (view ? view.imported.filter(inTab) : []), [view, tab]) // eslint-disable-line react-hooks/exhaustive-deps
  const latePayments = useMemo(() => imported.filter(i => i.rule === 'payment_overdue'), [imported])
  const groups = useMemo(
    () => (view ? [
      { id: 'now', title: 'Overdue or due today', items: view.now.filter(inTab) },
      { id: 'soon', title: 'Due in the next 5 days', items: view.soon.filter(inTab) },
      { id: 'ready', title: 'Ready to move', items: view.ready.filter(inTab) },
    ] : []),
    [view, tab], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const all = useMemo(
    () => [...active, ...waiting, ...(importedOpen ? imported : []), ...(staleOpen ? stale : [])],
    [active, waiting, imported, importedOpen, stale, staleOpen],
  )
  // Desktop always has something selected (the first item); a selection that left the list moves on.
  const current = all.find(i => i.key === selected) ?? (wide ? active[0] ?? waiting[0] : undefined)
  const openId = wide ? current?.key : expanded

  useEffect(() => {
    if (selected && !all.some(i => i.key === selected) && !copied.has(selected)) setSelected(null)
  }, [all, selected, copied])

  // The one count (needsYou.ts): what is due today or late, not Waiting, not older than 30 days. The same number as the Today badge.
  const needYou = view ? needsYouItems(view).length : 0
  const firstUse = useFirstUse('today', user.id, user.role, !!view && view.active.length === 0 && view.waiting.length === 0 && view.stale.length === 0 && view.imported.length === 0)
  const tabs: Array<'all' | TodayTab> = user.role === 'engineer' ? [] : ['all', 'bids', 'sourcing', 'money']

  // Waiting starts collapsed (round-2 R2-08): it is the system's cooldown, not work. Opening it is the person's choice,
  // remembered for the session. The collapsed line names the earliest next nudge.
  const waitingOpen = waitingToggled ?? waiting.length <= WAITING_OPEN_MAX
  const nextNudge = useMemo(() => waiting.map(i => i.waiting?.nextNudgeOn).filter((d): d is string => !!d).sort()[0] ?? null, [waiting])
  const nextOf = (key: string) => active.find(i => i.key !== key)
  const shownWaiting = waitingOpen ? waiting : waiting.filter(i => i.key === openId)

  const pick = (k: string) => {
    if (wide) setSelected(k)
    else setExpanded(e => (e === k ? null : k))
  }

  const list = (
    // One column that may shrink to the pane: no card or row can make the list wider than its pane (no sideways scroll).
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start">
      <header className="grid gap-1 px-5 pb-3 pt-5">
        <h1 className={wide ? 'text-2xl font-semibold tracking-tight' : 'sr-only'}>Today</h1>
        <p className="text-base text-fg-muted">
          {headerDate(today)}
          {view ? (
            <>
              {' · '}
              <b className="num font-medium text-fg" data-needs-you-count>{needYou}</b> need you
            </>
          ) : null}
        </p>
        {tabs.length > 0 ? (
          <SegmentedControl
            aria-label="Show"
            // A filter with no numbers (redesign phase 0: the line above is the one count). It wraps when the list is narrow (audit T4).
            className="mt-2 flex-wrap justify-self-start max-md:[&>*]:min-w-[44px] [&>*]:justify-center"
            value={tab}
            onValueChange={v => setTab(v as 'all' | TodayTab)}
            options={tabs.map(t => ({ value: t, label: TAB_LABEL[t] }))}
          />
        ) : null}
        <HowItWorksCard userId={user.id} role={user.role} className="mt-2" />
      </header>

      {query.isPending ? (
        <div role="status" className="grid gap-4 px-5 py-4" aria-busy="true" aria-label="Loading Today">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="grid gap-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/2" /></div>
          ))}
        </div>
      ) : query.isError || !view ? (
        <EmptyState mood="error" title="Today could not load" actions={<Button onClick={() => void query.refetch()}>Try again</Button>}>
          Nothing was changed. Check your connection and try again.
        </EmptyState>
      ) : (
        <>
          {firstUse.isNew ? (
            <FirstUseState screen="today" role={user.role} alone={firstUse.alone} className="mx-5 my-4" />
          ) : active.length === 0 ? (
            <EmptyState mood="goal" title={tab === 'all' ? 'Nothing needs you today' : 'Nothing here needs you today'}>
              {waiting.length > 0
                ? 'Everything you chased is waiting for its date. It comes back here when it is time to nudge.'
                : imported.length > 0
                  ? 'Orders imported from the old CRM are folded away below until you review them. They are not counted.'
                  : stale.length > 0
                  ? 'Work older than 30 days is folded away below. It is not counted.'
                  : user.role === 'engineer'
                  ? 'Commissioning jobs you are assigned to, and the goods on your orders, appear here.'
                  : 'Chases, quotations, goods and payments that need you will appear here.'}
            </EmptyState>
          ) : null}
          {groups.map(g =>
            g.items.length === 0 ? null : (
              <section key={g.id} aria-label={g.title}>
                <h2 className="flex items-baseline gap-2 border-y bg-sunken px-5 py-2 text-base font-medium text-fg-2">
                  {g.title} <span className="num font-regular text-fg-muted">{g.items.length}</span>
                </h2>
                <ul>
                  {g.items.map(i => (
                    <Row key={i.key} item={i} today={today} names={data?.names} open={openId === i.key} copied={copied.has(i.key)} wide={wide} onPick={() => pick(i.key)}>
                      {!wide && expanded === i.key && data ? (
                        <div className="border-l-2 border-brand-green bg-canvas px-4 py-4">
                          <Suspense fallback={null}>
                            <ContextPane item={i} data={data} today={today} copied={copied} onCopied={markCopied} onReleased={release} compact nextItem={nextOf(i.key)} onSelect={k => setExpanded(k)} />
                          </Suspense>
                        </div>
                      ) : null}
                    </Row>
                  ))}
                </ul>
              </section>
            ),
          )}
          {waiting.length > 0 ? (
            <section aria-label="Waiting" className="border-t bg-sunken">
              <button
                type="button"
                aria-expanded={waitingOpen}
                onClick={() => {
                  waitingToggledThisSession = !waitingOpen
                  setWaitingToggled(!waitingOpen)
                }}
                className="flex w-full items-center gap-2 px-5 py-3 text-left text-base font-medium text-fg-2"
              >
                <Icon icon={waitingOpen ? ChevronDown : ChevronRight} size="sm" />
                {/* A count in words, never a pill (spec 2.2 #8): "Waiting · 5 · next nudge Mon 30 Nov". */}
                <span>
                  Waiting · <span className="num">{waiting.length}</span>
                  {!waitingOpen && nextNudge ? <span className="font-regular text-fg-muted">{` · next nudge ${formatDay(nextNudge)}`}</span> : null}
                </span>
                {waitingOpen ? <span className="ml-auto text-sm font-regular text-fg-muted">comes back when its date arrives</span> : null}
              </button>
              {/* Collapsed, it still shows the open row: an item just chased stays where the person is looking. */}
              {shownWaiting.length > 0 ? (
                <ul>
                  {shownWaiting.map(i => (
                    <Row key={i.key} item={i} today={today} names={data?.names} waiting open={openId === i.key} copied={false} wide={wide} onPick={() => pick(i.key)}>
                      {!wide && expanded === i.key && data ? (
                        <div className="border-l-2 border-brand-green bg-canvas px-4 py-4">
                          <Suspense fallback={null}>
                            <ContextPane item={i} data={data} today={today} copied={copied} onCopied={markCopied} onReleased={release} compact nextItem={nextOf(i.key)} onSelect={k => setExpanded(k)} />
                          </Suspense>
                        </div>
                      ) : null}
                    </Row>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
          {imported.length > 0 ? (
            // Owner decision 2026-10-22 (1b): order tasks on imported orders wait here, grey and never counted, until the one-off
            // Review imported (redesign phase 2) says which orders are still live. Their invoices are not linked to them yet.
            <section aria-label="Imported, to review" className="border-t bg-sunken" data-imported-fold="">
              <button
                type="button"
                aria-expanded={importedOpen}
                onClick={() => {
                  importedOpenThisSession = !importedOpen
                  setImportedOpen(!importedOpen)
                }}
                className="flex w-full items-center gap-2 px-5 py-3 text-left text-base font-medium text-fg-2"
              >
                <Icon icon={importedOpen ? ChevronDown : ChevronRight} size="sm" />
                <span className="min-w-0 break-words">
                  Imported, to review · <span className="num">{imported.length}</span>
                  {latePayments.length > 0 ? (
                    <span className="text-tone-warning-fg">
                      {' '}· incl. {latePayments.length} late {latePayments.length === 1 ? 'payment' : 'payments'} · <span className="num">{pkr(latePayments.reduce((s, i) => s + (i.amount ?? 0), 0))}</span>
                    </span>
                  ) : null}
                  <span className="font-regular text-fg-muted">{importedOpen ? ' · not counted' : ' · show'}</span>
                </span>
              </button>
              {importedOpen ? (
                <ul>
                  {imported.map(i => (
                    <Row key={i.key} item={i} today={today} names={data?.names} faded open={openId === i.key} copied={copied.has(i.key)} wide={wide} onPick={() => pick(i.key)}>
                      {!wide && expanded === i.key && data ? (
                        <div className="border-l-2 border-brand-green bg-canvas px-4 py-4">
                          <Suspense fallback={null}>
                            <ContextPane item={i} data={data} today={today} copied={copied} onCopied={markCopied} onReleased={release} compact nextItem={nextOf(i.key)} onSelect={k => setExpanded(k)} />
                          </Suspense>
                        </div>
                      ) : null}
                    </Row>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
          {stale.length > 0 ? (
            // Older than 30 days (needsYou.ts): kept in sight for the person who has to act, never counted, never coloured.
            <section aria-label="Older than 30 days" className="border-t bg-sunken" data-stale-fold="">
              <button
                type="button"
                aria-expanded={staleOpen}
                onClick={() => {
                  staleOpenThisSession = !staleOpen
                  setStaleOpen(!staleOpen)
                }}
                className="flex w-full items-center gap-2 px-5 py-3 text-left text-base font-medium text-fg-2"
              >
                <Icon icon={staleOpen ? ChevronDown : ChevronRight} size="sm" />
                <span>
                  Older than 30 days · <span className="num">{stale.length}</span>
                  <span className="font-regular text-fg-muted">{staleOpen ? ' · not counted' : ' · show'}</span>
                </span>
              </button>
              {staleOpen ? (
                <ul>
                  {stale.map(i => (
                    <Row key={i.key} item={i} today={today} names={data?.names} faded open={openId === i.key} copied={copied.has(i.key)} wide={wide} onPick={() => pick(i.key)}>
                      {!wide && expanded === i.key && data ? (
                        <div className="border-l-2 border-brand-green bg-canvas px-4 py-4">
                          <Suspense fallback={null}>
                            <ContextPane item={i} data={data} today={today} copied={copied} onCopied={markCopied} onReleased={release} compact nextItem={nextOf(i.key)} onSelect={k => setExpanded(k)} />
                          </Suspense>
                        </div>
                      ) : null}
                    </Row>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </div>
  )

  return (
    // 768 to 1023 px (a tablet, a narrow window): the list takes two fifths so the pane keeps room; 420 px from 1024.
    <div className="grid min-h-full grid-cols-[minmax(0,1fr)] md:h-full md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:grid-cols-[420px_minmax(0,1fr)]" data-user={name}>
      <div className="flex min-h-0 min-w-0 flex-col border-r bg-surface">
        {/* The target tile is the foot of the list, at every width: it scrolls with the list instead of taking a pinned block
            of the laptop's first screen from the jobs (audit T2). An engineer gets no tile at all: a target is PKR amounts, and an
            engineer sees no prices (owner decision 2026-10-22; no request is made). */}
        <div data-today-list className="min-h-0 min-w-0 flex-1 overflow-x-clip md:overflow-y-auto">
          {list}
          {seesPrices(user.role) ? (
            <div className="border-t bg-surface px-4 py-4">
              <TargetTile today={today} className="rounded border bg-surface" />
            </div>
          ) : null}
        </div>
      </div>
      {wide ? (
        <div className="min-h-0 overflow-y-auto px-5 py-6 lg:px-8">
          {current && data ? (
            <div className="mx-auto max-w-[860px]">
              <Suspense fallback={null}>
                <ContextPane key={current.key} item={current} data={data} today={today} copied={copied} onCopied={markCopied} onReleased={release} nextItem={nextOf(current.key)} onSelect={setSelected} />
              </Suspense>
            </div>
          ) : query.isPending ? null : (
            <div className="grid h-full place-items-center text-sm text-fg-muted">Select an item to see what to do about it.</div>
          )}
        </div>
      ) : null}
    </div>
  )
}

function Row({ item, today, names, waiting = false, faded = false, open, copied, wide, onPick, children }: { item: TodayItem; today: string; names?: Record<string, string>; waiting?: boolean; faded?: boolean; open: boolean; copied: boolean; wide: boolean; onPick: () => void; children?: React.ReactNode }) {
  // On the selected row's background the amber is below 4.5:1, so a warning badge reads in the body colour there (as on the GST register).
  const tone = item.badge.tone === 'danger' ? 'text-tone-danger-fg' : item.badge.tone === 'warning' ? (open ? 'text-fg-2' : 'text-tone-warning-fg') : 'text-fg-muted'
  return (
    <li data-rule={item.rule} data-waiting={waiting || undefined} data-stale={(faded && !item.imported) || undefined} data-imported={item.imported || undefined} className="border-b last:border-b-0">
      <button
        type="button"
        onClick={onPick}
        aria-expanded={wide ? undefined : open}
        aria-current={wide && open ? 'true' : undefined}
        className={cn(
          'grid w-full items-start gap-3 border-l-2 px-5 py-3 text-left transition-colors duration-fast hover:bg-sunken focus-visible:bg-sunken',
          open ? 'border-brand-green bg-selected' : 'border-transparent',
          wide ? 'grid-cols-[2rem_minmax(0,1fr)_auto]' : 'grid-cols-[2rem_minmax(0,1fr)_auto_auto]',
          (waiting || faded) && 'bg-sunken',
          waiting && item.waiting?.chasedOn === today && isFreshChase(item.key) && 'row-settle',
        )}
      >
        <span className={cn('grid size-8 place-items-center rounded border bg-surface', waiting || faded ? 'text-fg-muted' : 'text-fg-2')}>
          <Icon icon={ICON[item.rule]} size="md" />
        </span>
        <span className="grid min-w-0 gap-px">
          <span className={cn('min-w-0 text-base font-medium [overflow-wrap:anywhere]', (waiting || faded) && 'font-regular text-fg-2')}>{waiting ? (item.waitingTitle ?? item.title) : item.title}</span>
          <span className="min-w-0 text-base text-fg-muted [overflow-wrap:anywhere]">
            <span className="num">{item.ref}</span> · {item.party}
          </span>
          {item.collision && names?.[item.collision.by] ? (
            <span data-collision className="flex items-center gap-1 text-xs text-tone-warning-fg">
              <Icon icon={Users} size="chip" /> {chasedByText(names[item.collision.by], item.collision.at, Date.now())}
            </span>
          ) : null}
          {item.waiting ? (
            <span className="text-xs text-fg-muted">{waitingLine(item.waiting.chasedOn, item.waiting.nextNudgeOn, today, item.rule === 'payment_overdue' ? 'reminded' : 'chased')}</span>
          ) : null}
        </span>
        {waiting ? (
          <span className="sr-only">Waiting</span>
        ) : copied ? (
          <span className="inline-flex h-5 items-center rounded bg-tone-success-bg px-2 text-xs font-medium text-tone-success-fg">Copied</span>
        ) : (
          <span className={cn('whitespace-nowrap pt-px text-sm', tone)}>{item.badge.text}</span>
        )}
        {wide ? null : <Icon icon={ChevronRight} size="sm" className={cn('mt-1 text-fg-muted transition-transform duration-fast', open && 'rotate-90')} />}
      </button>
      {children}
    </li>
  )
}
