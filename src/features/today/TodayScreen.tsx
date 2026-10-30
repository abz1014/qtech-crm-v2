import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Banknote, CalendarCheck, Calculator, ClipboardCheck, ChevronDown, ChevronRight, DatabaseBackup, FileCheck, HandCoins, HardHat, Hourglass, KeyRound, Landmark, MessageCircleQuestion, Package, PackageCheck, PackageSearch, Repeat, ReceiptText, Reply, Send, Share2, ShoppingCart, Truck, Users, Wrench, type LucideIcon } from 'lucide-react'
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
import { SnoozeMenu } from '@/features/today/SnoozeMenu'
import { engineerDayGroups, dayBlock } from '@/features/today/engineerDays'
import { TargetTile } from '@/features/today/TargetTile'
import { TeamView } from '@/features/today/TeamView'
import { isFreshChase } from '@/features/today/chaseMemory'
import { chasedByText } from '@/features/rfqs/lib/collision'
import { headerDate, waitingLine } from '@/features/today/text'
import { ACTION_LABEL, BLOCK_TITLE, WAITING_TITLE, blockOf, buildTodo, moreText, opensMessage, secondAction, type TodoBlock } from '@/features/today/todoModel'
import type { Role, RuleKey, TodayItem } from '@/features/today/types'
import { NoPrimary } from '@/ui/NoPrimary'

/*
 * The context pane (what to do about an item: the chase text, the numbers, the buttons) is its own download (perf/lcp): on a
 * phone it opens on a tap, so the list does not wait for it. A wide screen shows it at once, so there it starts downloading
 * with the page.
 */
const loadContextPane = () => import('@/features/today/ContextPane')
const ContextPane = lazyWithReload(() => loadContextPane().then(m => ({ default: m.ContextPane })))
if (typeof window !== 'undefined' && window.matchMedia?.('(min-width: 768px)').matches) void loadContextPane().catch(() => {})

/*
 * To do (redesign phase 3, P3-A; replaces Today). ONE list that says "do this", three colour blocks (direction C): Late (red),
 * Today (yellow), This week (blue). A block with nothing in it is not drawn. At most 7 rows are drawn, late money first, then a
 * promise to a customer, then the rest; the rest folds into "N more this week" (nothing is dropped). The count is ONE number:
 * needsYouItems(view).length (needsYou.ts), which is Late plus Today, and it is the same number as the top bar's badge.
 *
 * Every row carries its own button (todoModel.ts ACTION_LABEL: Chase, Copy reminder, Send quotation, Ask suppliers, Create
 * invoice ...; Record payment too, for an admin). The four rules that prepare a message open it beside the list (or under the row
 * on a phone), where Copy, Open in WhatsApp and Mark chased are; the others go to the page that does it. The snooze menu has
 * "Not ours to chase" (0097). Greys: Chased, waiting until <weekday>; Older than 30 days; Imported, to review. Never counted.
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
  weekly_review: ClipboardCheck,
  gst_fbr: Landmark,
  claims_to_approve: HandCoins,
  backup_stale: DatabaseBackup,
  usage_high: DatabaseBackup,
  decrypt_test: KeyRound,
}

const NONE: TodayItem[] = []
const WAITING_OPEN_MAX = 0 // Waiting opens only when the person opens it (R2-08)

/* The three work blocks and the quiet folds: each block's ink is its own (7.8:1 or better); hints sit on the white tiles, never on the yellow. */
type Block = TodoBlock | 'quiet'
const BLOCK: Record<Block, string> = {
  late: 'bg-block-late text-block-late-fg',
  today: 'bg-block-today text-block-today-fg',
  week: 'bg-block-week text-block-week-fg',
  quiet: 'bg-block-quiet text-block-quiet-fg',
}

/** Whether the person opened or closed the Waiting group, kept for this browser session only (null: not touched, the size decides). */
let waitingToggledThisSession: boolean | null = null
/** Whether the person opened the "Older than 30 days" fold, for this browser session only. */
let staleOpenThisSession = false
/** Whether the person opened the "Imported, to review" fold, for this browser session only. */
let importedOpenThisSession = false
/** Whether the person opened "N more this week", for this browser session only. */
let moreOpenThisSession = false

export default function TodayScreen() {
  const session = useSession()
  if (session.status !== 'signed-in') return null
  return <TodayBody user={{ id: session.user.id, role: session.user.role as Role }} name={session.user.name} />
}

function TodayBody({ user, name }: { user: { id: string; role: Role }; name: string }) {
  const today = useBusinessToday()
  const navigate = useNavigate()
  const { view, data, query } = useTodayView(user, today)
  const wide = useMediaQuery('(min-width: 768px)')
  const [params, setParams] = useSearchParams()
  // Admin only: Mine (the list) or Team (each person's list and late count, read only). Kept in the address, so it can be linked.
  const team = user.role === 'admin' && params.get('view') === 'team'
  const setView = (v: string) => setParams(p => { const n = new URLSearchParams(p); if (v === 'team') n.set('view', 'team'); else n.delete('view'); return n }, { replace: true })
  const switcher = user.role === 'admin' ? (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
      <SegmentedControl aria-label="Whose list" value={team ? 'team' : 'mine'} onValueChange={setView} options={[{ value: 'mine', label: 'Mine' }, { value: 'team', label: 'Team' }]} />
      <Link to="/todo/review" className="inline-flex min-h-touch items-center rounded text-base font-medium text-primary underline underline-offset-2">
        Weekly review
      </Link>
    </div>
  ) : null
  const [selected, setSelected] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [copied, setCopied] = useState<ReadonlySet<string>>(new Set())
  const [waitingToggled, setWaitingToggled] = useState<boolean | null>(waitingToggledThisSession)
  const [staleOpen, setStaleOpen] = useState(staleOpenThisSession)
  const [importedOpen, setImportedOpen] = useState(importedOpenThisSession)
  const [moreOpen, setMoreOpen] = useState(moreOpenThisSession)
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

  const model = useMemo(() => (view ? buildTodo(view, today) : null), [view, today])
  const waiting = view?.waiting ?? NONE
  const stale = view?.stale ?? NONE
  const imported = view?.imported ?? NONE
  const latePayments = useMemo(() => imported.filter(i => i.rule === 'payment_overdue'), [imported])
  // An engineer's list is their jobs by day (engineerDays.ts: Missed, Today, Tomorrow, each later day); everyone else's is the three blocks.
  const blocks = useMemo<Array<readonly [TodoBlock, TodayItem[], string]>>(
    () =>
      user.role === 'engineer' && view
        ? engineerDayGroups(view, today).map(g => [dayBlock(g.id), g.items, g.title] as const)
        : model
          ? ([['late', model.late], ['today', model.today], ['week', model.week]] as const).filter(([, items]) => items.length > 0).map(([b, items]) => [b, items, BLOCK_TITLE[b]] as const)
          : [],
    [model, view, today, user.role],
  )
  const drawn = useMemo(() => [...blocks.flatMap(([, items]) => items), ...(moreOpen && model && user.role !== 'engineer' ? model.more : [])], [blocks, moreOpen, model, user.role])
  const all = useMemo(
    () => [...drawn, ...waiting, ...(importedOpen ? imported : []), ...(staleOpen ? stale : [])],
    [drawn, waiting, imported, importedOpen, stale, staleOpen],
  )
  // Desktop always has something selected (the first item); a selection that left the list moves on.
  const current = all.find(i => i.key === selected) ?? (wide ? drawn[0] ?? waiting[0] : undefined)
  const openId = wide ? current?.key : expanded

  useEffect(() => {
    if (selected && !all.some(i => i.key === selected) && !copied.has(selected)) setSelected(null)
  }, [all, selected, copied])

  // The one count (needsYou.ts): Late + Today. The same number as the To do badge in the top bar.
  const needYou = view ? needsYouItems(view).length : 0
  const firstUse = useFirstUse('today', user.id, user.role, !!view && view.active.length === 0 && view.waiting.length === 0 && view.stale.length === 0 && view.imported.length === 0)

  // Waiting starts collapsed (round-2 R2-08): it is the system's cooldown, not work. Opening it is the person's choice,
  // remembered for the session. The collapsed line names the earliest next nudge.
  const waitingOpen = waitingToggled ?? waiting.length <= WAITING_OPEN_MAX
  const nextNudge = useMemo(() => waiting.map(i => i.waiting?.nextNudgeOn).filter((d): d is string => !!d).sort()[0] ?? null, [waiting])
  const nextOf = (key: string) => drawn.find(i => i.key !== key)
  const shownWaiting = waitingOpen ? waiting : waiting.filter(i => i.key === openId)

  const pick = (k: string) => {
    if (wide) setSelected(k)
    else setExpanded(e => (e === k ? null : k))
  }
  /** The row's own button: a prepared message opens beside the list (under the row on a phone), anything else goes to its page. */
  const act = (i: TodayItem) => {
    if (opensMessage(i.rule)) {
      if (wide) setSelected(i.key)
      else setExpanded(i.key)
    } else navigate(i.href)
  }

  const row = (i: TodayItem, o: { waiting?: boolean; faded?: boolean; actions?: boolean } = {}) => (
    <Row key={i.key} item={i} today={today} role={user.role} names={data?.names} waiting={o.waiting} faded={o.faded} actions={o.actions ?? true} open={openId === i.key} copied={!o.waiting && copied.has(i.key)} wide={wide} onPick={() => pick(i.key)} onAct={() => act(i)} onGo={href => navigate(href)}>
      {!wide && expanded === i.key && data ? (
        <div className="rounded-b-row border-l-2 border-brand-green bg-canvas px-4 py-4">
          <Suspense fallback={null}>
            <ContextPane item={i} data={data} today={today} copied={copied} onCopied={markCopied} onReleased={release} compact nextItem={nextOf(i.key)} onSelect={k => setExpanded(k)} />
          </Suspense>
        </div>
      ) : null}
    </Row>
  )

  const list = (
    // One column that may shrink to the pane: no card or row can make the list wider than its pane (no sideways scroll).
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start">
      <header className="grid gap-1 px-5 pb-3 pt-5">
        <h1 className={wide ? 'text-2xl font-heavy tracking-tight' : 'sr-only'}>To do</h1>
        <p className="text-base text-fg-muted">
          {headerDate(today)}
          {view ? (
            <>
              {' · '}
              <b className="num font-medium text-fg" data-needs-you-count>{needYou}</b> need you
              {model && model.weekTotal > 0 ? ` · ${model.weekTotal} later this week` : ''}
            </>
          ) : null}
        </p>
        {switcher}
        <HowItWorksCard userId={user.id} role={user.role} className="mt-2" />
      </header>

      {query.isPending ? (
        <div role="status" className="grid gap-4 px-5 py-4" aria-busy="true" aria-label="Loading To do">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="grid gap-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/2" /></div>
          ))}
        </div>
      ) : query.isError || !view || !model ? (
        <EmptyState mood="error" title="To do could not load" actions={<Button onClick={() => void query.refetch()}>Try again</Button>}>
          Nothing was changed. Check your connection and try again.
        </EmptyState>
      ) : (
        <>
          {firstUse.isNew ? (
            <FirstUseState screen="today" role={user.role} alone={firstUse.alone} className="mx-5 my-4" />
          ) : model.total === 0 ? (
            <EmptyState mood="goal" title="Nothing needs you today">
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
          {blocks.map(([id, items, title], n) => (
            <section key={`${id}-${n}`} aria-label={title} data-block={id} className={cn('mx-2 mb-3 rounded-panel p-2 first-of-type:mt-1 md:mx-3 md:p-3', BLOCK[id])}>
              <h2 className="flex items-baseline gap-2 px-1 pb-2 text-lg font-heavy">
                {title} <span className="num">{items.length}</span>
              </h2>
              <ul className="grid gap-2">{items.map(i => row(i))}</ul>
            </section>
          ))}
          {model.more.length > 0 && user.role !== 'engineer' ? (
            <Fold label={moreText(model)} open={moreOpen} hint={moreOpen ? '' : ' · show'} data-more-fold="" onToggle={() => { moreOpenThisSession = !moreOpen; setMoreOpen(!moreOpen) }}>
              <ul className="grid gap-2 px-2 pb-2 md:px-3 md:pb-3">{model.more.map(i => row(i))}</ul>
            </Fold>
          ) : null}
          {waiting.length > 0 ? (
            <section aria-label="Waiting" data-block="quiet" className="mx-2 mb-3 rounded-panel bg-block-quiet text-block-quiet-fg md:mx-3">
              <button
                type="button"
                aria-expanded={waitingOpen}
                onClick={() => {
                  waitingToggledThisSession = !waitingOpen
                  setWaitingToggled(!waitingOpen)
                }}
                className="flex min-h-touch w-full items-center gap-2 rounded-panel px-4 py-3 text-left text-base font-semibold text-fg-2"
              >
                <Icon icon={waitingOpen ? ChevronDown : ChevronRight} size="sm" />
                {/* Words, never a pill (spec 2.2 #8): "Chased, waiting until Mon 30 Nov". */}
                <span>
                  {WAITING_TITLE} · <span className="num">{waiting.length}</span>
                  {!waitingOpen && nextNudge ? <span className="font-regular text-fg-muted">{` · until ${formatDay(nextNudge)}`}</span> : null}
                </span>
                {waitingOpen ? <span className="ml-auto text-base font-regular text-fg-muted max-md:hidden">comes back when its date arrives</span> : null}
              </button>
              {/* Collapsed, it still shows the open row: an item just chased stays where the person is looking. */}
              {shownWaiting.length > 0 ? <ul className="grid gap-2 px-2 pb-2 md:px-3 md:pb-3">{shownWaiting.map(i => row(i, { waiting: true, actions: false }))}</ul> : null}
            </section>
          ) : null}
          {imported.length > 0 ? (
            // Owner decision 2026-10-22 (1b): order tasks on imported orders wait here, grey and never counted, until the one-off
            // Review imported (redesign phase 2) says which orders are still live. Their invoices are not linked to them yet.
            <Fold
              label={
                <>
                  Imported, to review · <span className="num">{imported.length}</span>
                  {latePayments.length > 0 ? (
                    <span className="text-tone-warning-fg">
                      {' '}· incl. {latePayments.length} late {latePayments.length === 1 ? 'payment' : 'payments'} · <span className="num">{pkr(latePayments.reduce((s, i) => s + (i.amount ?? 0), 0))}</span>
                    </span>
                  ) : null}
                </>
              }
              ariaLabel="Imported, to review"
              open={importedOpen}
              hint={importedOpen ? ' · not counted' : ' · show'}
              data-imported-fold=""
              onToggle={() => { importedOpenThisSession = !importedOpen; setImportedOpen(!importedOpen) }}
            >
              <ul className="grid gap-2 px-2 pb-2 md:px-3 md:pb-3">{imported.map(i => row(i, { faded: true, actions: false }))}</ul>
            </Fold>
          ) : null}
          {stale.length > 0 ? (
            // Older than 30 days (needsYou.ts): kept in sight for the person who has to act, never counted, never coloured.
            <Fold
              label={<>Older than 30 days · <span className="num">{stale.length}</span></>}
              ariaLabel="Older than 30 days"
              open={staleOpen}
              hint={staleOpen ? ' · not counted' : ' · show'}
              data-stale-fold=""
              onToggle={() => { staleOpenThisSession = !staleOpen; setStaleOpen(!staleOpen) }}
            >
              <ul className="grid gap-2 px-2 pb-2 md:px-3 md:pb-3">{stale.map(i => row(i, { faded: true }))}</ul>
            </Fold>
          ) : null}
        </>
      )}
    </div>
  )

  if (team) {
    return (
      <div className="min-h-full bg-surface" data-user={name}>
        <NoPrimary />
        <header className="grid gap-1 px-5 pb-1 pt-5">
          <h1 className="text-2xl font-heavy tracking-tight">To do</h1>
          <p className="text-base text-fg-muted">{headerDate(today)} · the team</p>
          {switcher}
        </header>
        {data ? <TeamView data={data} today={today} selfId={user.id} /> : query.isPending ? <div role="status" aria-busy="true" aria-label="Loading the team" className="p-5"><Skeleton className="h-4 w-2/3" /></div> : <EmptyState mood="error" title="The team could not load" actions={<Button onClick={() => void query.refetch()}>Try again</Button>}>Nothing was changed.</EmptyState>}
      </div>
    )
  }

  return (
    // 768 to 1023 px (a tablet, a narrow window): the list takes two fifths so the pane keeps room; 420 px from 1024.
    <div className="grid min-h-full grid-cols-[minmax(0,1fr)] md:h-full md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:grid-cols-[420px_minmax(0,1fr)]" data-user={name}>
      <NoPrimary />
      <div className="flex min-h-0 min-w-0 flex-col border-r bg-surface">
        {/* The target tile is the foot of the list, at every width: it scrolls with the list instead of taking a pinned block
            of the laptop's first screen from the jobs (audit T2). An engineer gets no tile at all: a target is PKR amounts, and an
            engineer sees no prices (owner decision 2026-10-22; no request is made). */}
        <div data-today-list className="min-h-0 min-w-0 flex-1 overflow-x-clip md:overflow-y-auto">
          {list}
          {seesPrices(user.role) ? (
            <div className="bg-surface px-3 pb-4 pt-1">
              <TargetTile today={today} className="rounded-panel border bg-surface" />
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
            <div className="grid h-full place-items-center text-base text-fg-muted">Select an item to see what to do about it.</div>
          )}
        </div>
      ) : null}
    </div>
  )
}

/** A grey fold: one line that opens its rows. Never counted. */
function Fold({ label, ariaLabel, open, hint, onToggle, children, ...rest }: { label: ReactNode; ariaLabel?: string; open: boolean; hint: string; onToggle: () => void; children: ReactNode } & Record<`data-${string}`, string>) {
  return (
    <section aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)} data-block="quiet" className="mx-2 mb-3 rounded-panel bg-block-quiet text-block-quiet-fg md:mx-3" {...rest}>
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-h-touch w-full items-center gap-2 rounded-panel px-4 py-3 text-left text-base font-semibold text-fg-2">
        <Icon icon={open ? ChevronDown : ChevronRight} size="sm" />
        <span className="min-w-0 break-words">
          {label}
          <span className="font-regular text-fg-muted">{hint}</span>
        </span>
      </button>
      {open ? children : null}
    </section>
  )
}

/** Which block an active row is counted in (late, today, week); none for the grey folds. For tests and for the e2e counters. */
const dueOf = (item: TodayItem, today: string, grey: boolean): TodoBlock | undefined => (grey ? undefined : blockOf(item, today))

interface RowProps {
  item: TodayItem
  today: string
  role: Role
  names?: Record<string, string>
  waiting?: boolean
  faded?: boolean
  actions: boolean
  open: boolean
  copied: boolean
  wide: boolean
  onPick: () => void
  onAct: () => void
  onGo: (href: string) => void
  children?: ReactNode
}

function Row({ item, today, role, names, waiting = false, faded = false, actions, open, copied, wide, onPick, onAct, onGo, children }: RowProps) {
  // On the selected row's background the amber is below 4.5:1, so a warning badge reads in the body colour there (as on the GST register).
  const tone = item.badge.tone === 'danger' ? 'text-tone-danger-fg' : item.badge.tone === 'warning' ? (open ? 'text-fg-2' : 'text-tone-warning-fg') : 'text-fg-muted'
  const second = actions ? secondAction(item, role) : null
  const own = actions && !waiting // the row carries its own button and its own snooze
  return (
    <li data-row-actions="" data-rule={item.rule} data-due={dueOf(item, today, waiting || faded)} data-waiting={waiting || undefined} data-stale={(faded && !item.imported) || undefined} data-imported={item.imported || undefined} className={cn('relative rounded-row bg-surface text-fg', open && 'after:pointer-events-none after:absolute after:inset-0 after:rounded-row after:ring-2 after:ring-inset after:ring-fg')}>
      <button
        type="button"
        onClick={onPick}
        aria-expanded={wide ? undefined : open}
        aria-current={wide && open ? 'true' : undefined}
        className={cn(
          'grid w-full grid-cols-[2rem_minmax(0,1fr)] items-start gap-x-3 rounded-row px-3 py-3 text-left transition-colors duration-fast hover:bg-sunken focus-visible:bg-sunken md:px-4',
          // clear of the 44px snooze button (4px in from the edge) with a gap, down to a 320px phone
          own && 'pr-16 md:pr-16',
          // The open row's ink ring (direction C, 18:1 against the white tile) is drawn on the whole tile, button row included: see the <li>.
          (waiting || faded) && 'bg-sunken',
          waiting && item.waiting?.chasedOn === today && isFreshChase(item.key) && 'row-settle',
        )}
      >
        <span className={cn('grid size-8 place-items-center rounded bg-sunken', waiting || faded ? 'text-fg-muted' : 'text-fg-2')}>
          <Icon icon={ICON[item.rule]} size="md" />
        </span>
        <span className="grid min-w-0 gap-px">
          <span className={cn('min-w-0 text-base font-semibold [overflow-wrap:anywhere]', (waiting || faded) && 'font-regular text-fg-2')}>{waiting ? (item.waitingTitle ?? item.title) : item.title}</span>
          <span className="min-w-0 text-base text-fg-muted [overflow-wrap:anywhere]">
            <span className="num">{item.ref}</span> · {item.party}
          </span>
          {item.collision && names?.[item.collision.by] ? (
            <span data-collision className="flex items-center gap-1 text-base text-tone-warning-fg">
              <Icon icon={Users} size="chip" /> {chasedByText(names[item.collision.by], item.collision.at, Date.now())}
            </span>
          ) : null}
          {item.waiting ? (
            <span className="text-stamp text-fg-muted">{waitingLine(item.waiting.chasedOn, item.waiting.nextNudgeOn, today, item.rule === 'payment_overdue' ? 'reminded' : 'chased')}</span>
          ) : null}
          {/* When it is due, in words: its own line, so the title keeps the whole width of a narrow column. */}
          <span className="flex min-w-0 items-center gap-2">
            {waiting ? (
              <span className="sr-only">Waiting</span>
            ) : copied ? (
              <span className="inline-flex min-h-chip items-center rounded-round bg-tone-success-bg px-[10px] text-base font-semibold text-tone-success-fg">Copied</span>
            ) : (
              <span className={cn('min-w-0 text-base font-semibold', tone)}>{item.badge.text}</span>
            )}
            {wide ? null : <Icon icon={ChevronRight} size="sm" className={cn('shrink-0 text-fg-muted transition-transform duration-fast', open && 'rotate-90')} />}
          </span>
        </span>
      </button>
      {own ? (
        <span className="absolute right-1 top-1 md:right-2 md:top-2">
          <SnoozeMenu item={item} today={today} iconOnly />
        </span>
      ) : null}
      {own ? (
        <div className="flex flex-wrap items-center gap-2 px-3 pb-3 md:px-4" data-row-actions="">
          <Button variant="secondary" onClick={onAct} aria-label={`${ACTION_LABEL[item.rule]}: ${item.ref} ${item.party}`} className="max-md:min-h-touch">
            {ACTION_LABEL[item.rule]}
          </Button>
          {second ? (
            <Button variant="secondary" onClick={() => onGo(second.href)} aria-label={`${second.label}: ${item.ref} ${item.party}`} className="max-md:min-h-touch">
              {second.label}
            </Button>
          ) : null}
        </div>
      ) : null}
      {children}
    </li>
  )
}
