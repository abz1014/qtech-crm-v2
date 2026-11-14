import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Building2, ChevronDown, ChevronRight, Clock, Users } from 'lucide-react'
import { seesPrices, useSession } from '@/app/session'
import { formatDay } from '@/lib/formatDay'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'
import { pkr } from '@/features/money/expenses/model'
import { Button } from '@/ui/Button'
import { CARD } from '@/ui/card'
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
import { HomeMoney } from '@/features/today/HomeMoney'
import { TeamView } from '@/features/today/TeamView'
import { isFreshChase } from '@/features/today/chaseMemory'
import { chasedByText } from '@/features/rfqs/lib/collision'
import { headerDate, waitingLine } from '@/features/today/text'
import { ACTION_LABEL, BLOCK_TITLE, WAITING_TITLE, blockOf, buildTodo, moreText, opensPane, secondAction, type TodoBlock } from '@/features/today/todoModel'
import type { Role, TodayItem } from '@/features/today/types'
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
 * Home (Forest, 10-home.html and 11-home-lists.html; the page was called To do, and before that Today: route /todo kept). On top a
 * forest hero per role with the one number (admin "Needs you now", sales "Quotes to send or follow up", engineer "My day"); at the foot
 * the money pulse for admin and sales (HomeMoney.tsx) and, on a phone, the Companies row (F-826: Companies is not on the bottom bar).
 *
 * The list (redesign phase 3, P3-A). ONE list that says "do this", three colour blocks (direction C): Late (red),
 * Today (yellow), This week (blue). A block with nothing in it is not drawn. At most 7 rows are drawn, late money first, then a
 * promise to a customer, then the rest; the rest folds into "N more this week" (nothing is dropped). The count is ONE number:
 * needsYouItems(view).length (needsYou.ts), which is Late plus Today, and it is the same number as the top bar's badge.
 *
 * Every row carries its own button (todoModel.ts ACTION_LABEL: Chase, Copy reminder, Send quotation, Ask suppliers, Create
 * invoice ...; Record payment too, for an admin). The four rules that prepare a message open it beside the list (or under the row
 * on a phone), where Copy, Open in WhatsApp and Mark chased are; the others go to the page that does it. The snooze menu has
 * "Not ours to chase" (0097). Greys: Chased, waiting until <weekday>; Older than 30 days; Imported, to review. Never counted.
 */
const NONE: TodayItem[] = []
const WAITING_OPEN_MAX = 0 // Waiting opens only when the person opens it (R2-08)

/*
 * Forest (11-home-lists.html): every block is a white card. Late carries the red: a red top edge and a red heading with a clock; Today
 * and This week are fold rows (the name, the count as a coloured chip, a chevron); the quiet folds are grey cards. The count chips keep
 * the block colours (each ink is 7:1 on its own tint).
 */
type Block = TodoBlock | 'quiet'
const COUNT: Record<Block, string> = {
  late: 'bg-block-late text-block-late-fg',
  today: 'bg-block-today text-block-today-fg',
  week: 'bg-block-week text-block-week-fg',
  quiet: 'bg-block-quiet text-block-quiet-fg',
}
const CARD_OF: Record<TodoBlock, string> = {
  late: 'border-t-4 border-t-tone-danger-fg',
  today: '',
  week: '',
}
/** The grey fold cards (Waiting, Imported, Older than 30 days): never counted, never coloured. */
const QUIET = 'rounded-card border bg-sunken text-fg-2'

/** The block's count: a small round chip in the block's colour. */
function Count({ n, of }: { n: number; of: Block }) {
  return <span className={cn('num inline-flex min-h-chip min-w-chip items-center justify-center rounded-pill px-2 text-xs font-card', COUNT[of])}>{n}</span>
}

/** The context pane while its download or the list loads: a title, two facts and a button, as the pane draws them. */
function PaneSkeleton() {
  return (
    <div className="grid gap-3" aria-hidden="true">
      <Skeleton className="h-3 w-1/4" />
      <Skeleton className="h-6 w-3/4" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
      <Skeleton className="h-10 w-1/2" />
    </div>
  )
}

/** Whether the person opened or closed the Waiting group, kept for this browser session only (null: not touched, the size decides). */
let waitingToggledThisSession: boolean | null = null
/** Whether the person opened the "Older than 30 days" fold, for this browser session only. */
let staleOpenThisSession = false
/** Whether the person opened the "Imported, to review" fold, for this browser session only. */
let importedOpenThisSession = false
/** Whether the person opened "N more this week", for this browser session only. */
let moreOpenThisSession = false
/** Whether the person opened or closed the Today and This week blocks (absent: not touched, the default decides), for this browser session only. */
const blockToggledThisSession: Partial<Record<TodoBlock, boolean>> = {}

export default function TodayScreen() {
  const session = useSession()
  if (session.status !== 'signed-in') return null
  return <TodayBody user={{ id: session.user.id, role: session.user.role as Role }} name={session.user.name} since={session.user.createdAt} />
}

function TodayBody({ user, name, since }: { user: { id: string; role: Role }; name: string; since?: string }) {
  const today = useBusinessToday()
  const navigate = useNavigate()
  const { view, data, query } = useTodayView(user, today)
  const wide = useMediaQuery('(min-width: 768px)')
  const [params, setParams] = useSearchParams()
  // Admin only: Mine (the list) or Team (each person's list and late count, read only). Kept in the address, so it can be linked.
  const team = user.role === 'admin' && params.get('view') === 'team'
  const setView = (v: string) => setParams(p => { const n = new URLSearchParams(p); if (v === 'team') n.set('view', 'team'); else n.delete('view'); return n }, { replace: true })
  const switcher = user.role === 'admin' ? (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
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
  const [blockToggled, setBlockToggled] = useState<Partial<Record<TodoBlock, boolean>>>({ ...blockToggledThisSession })
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
  // Late is always open. Today and This week are one closed row with their count until the person opens them (kept for the session);
  // with no Late block the first block opens, so the screen never opens on closed rows only. An engineer's day lists stay open.
  const blockOpen = (id: TodoBlock, n: number): boolean => user.role === 'engineer' || id === 'late' || (blockToggled[id] ?? (n === 0 && blocks[0]?.[0] !== 'late'))
  const toggleBlock = (id: TodoBlock, open: boolean) => {
    blockToggledThisSession[id] = !open
    setBlockToggled(s => ({ ...s, [id]: !open }))
  }
  const drawn = useMemo(() => [...blocks.flatMap(([id, items], n) => (user.role === 'engineer' || id === 'late' || (blockToggled[id] ?? (n === 0 && blocks[0]?.[0] !== 'late')) ? items : [])), ...(moreOpen && model && user.role !== 'engineer' ? model.more : [])], [blocks, blockToggled, moreOpen, model, user.role])
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
    if (opensPane(i.rule)) {
      if (wide) setSelected(i.key)
      else setExpanded(i.key)
    } else navigate(i.href)
  }

  const row = (i: TodayItem, o: { waiting?: boolean; faded?: boolean; actions?: boolean; card?: boolean } = {}) => (
    <Row key={i.key} card={o.card} item={i} today={today} role={user.role} names={data?.names} waiting={o.waiting} faded={o.faded} actions={o.actions ?? true} open={openId === i.key} copied={!o.waiting && copied.has(i.key)} wide={wide} onPick={() => pick(i.key)} onAct={() => act(i)} onGo={href => navigate(href)}>
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
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-3">
      <header className="grid gap-1">
        <h1 className={wide ? 'text-2xl font-heavy tracking-tight' : 'sr-only'}>Home</h1>
        <p className="text-sm text-fg-muted">
          {headerDate(today)}
          {view ? (
            <>
              {' · '}
              <b className="num font-medium text-fg" data-needs-you-count>{needYou}</b> due now
              {model && model.weekTotal > 0 ? ` · ${model.weekTotal} later this week` : ''}
            </>
          ) : null}
        </p>
        {switcher ? <div className="mt-2">{switcher}</div> : null}
        <HowItWorksCard userId={user.id} role={user.role} since={since} className="mt-2" />
      </header>

      {query.isPending ? (
        // Shaped like what comes: the hero, the Late card with two rows, two fold rows.
        <div role="status" className="grid gap-3" aria-busy="true" aria-label="Loading Home">
          <Skeleton className="h-[6.5rem] w-full rounded-card" />
          <div className={cn(CARD, 'grid gap-4 p-card')}>
            {[0, 1].map(i => (
              <div key={i} className="grid gap-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/2" /></div>
            ))}
          </div>
          <Skeleton className="h-row w-full rounded-card" />
          <Skeleton className="h-row w-full rounded-card" />
        </div>
      ) : query.isError || !view || !model ? (
        <EmptyState mood="error" title="Home could not load" actions={<Button onClick={() => void query.refetch()}>Try again</Button>}>
          Nothing was changed. Check your connection and try again.
        </EmptyState>
      ) : (
        <>
          {!firstUse.isNew && model.total > 0 ? <Hero role={user.role} name={name} count={needYou} /> : null}
          {firstUse.isNew ? (
            <FirstUseState screen="today" role={user.role} alone={firstUse.alone} />
          ) : model.total === 0 ? (
            <EmptyState mood="goal" title="No tasks for today">
              {waiting.length > 0
                ? 'Everything followed up is waiting for its date. It comes back here when it is time to send a reminder.'
                : imported.length > 0
                  ? 'Orders imported from the old CRM are folded away below until reviewed. They are not counted.'
                  : stale.length > 0
                  ? 'Work older than 30 days is folded away below. It is not counted.'
                  : user.role === 'engineer'
                  ? 'Commissioning jobs you are assigned to, and the goods on your orders, appear here.'
                  : 'Follow-ups, quotations, deliveries and payments due appear here.'}
            </EmptyState>
          ) : null}
          {blocks.map(([id, items, title], n) => {
            const open = blockOpen(id, n)
            const foldable = user.role !== 'engineer' && id !== 'late'
            if (!open) {
              // Closed: one row with the name and the count, no list. Not a section[data-block] until it holds rows.
              return (
                <button
                  key={`${id}-${n}`}
                  type="button"
                  aria-expanded={false}
                  data-block-closed={id}
                  data-work={n === 0 ? '' : undefined}
                  onClick={() => toggleBlock(id, false)}
                  className={cn(CARD, 'type-section flex min-h-row items-center gap-2 px-card py-2 text-left transition-[box-shadow,background-color] duration-fast ease-out hover:bg-sunken hover:shadow-e2')}
                >
                  <span className="min-w-0 flex-1">{title}</span>
                  <Count n={items.length} of={id} />
                  <Icon icon={ChevronRight} size="sm" className="text-fg-muted" />
                </button>
              )
            }
            return (
              user.role === 'engineer' ? (
                // An engineer's day (11-home-lists.html, engineer): the day as a heading with its count, each visit its own card.
                <section key={`${id}-${n}`} aria-label={title} data-block={id} data-work={n === 0 ? '' : undefined} className="grid gap-2">
                  <h2 className="type-section flex min-h-touch items-center gap-2 pt-1">
                    {title} <Count n={items.length} of={id} />
                  </h2>
                  <ul className="grid gap-2">{items.map(i => row(i, { card: true }))}</ul>
                </section>
              ) : (
                <section key={`${id}-${n}`} aria-label={title} data-block={id} data-work={n === 0 ? '' : undefined} className={cn(CARD, 'px-3 pb-2 pt-1', CARD_OF[id])}>
                  <h2 className={cn('type-section', id === 'late' && 'text-tone-danger-fg')}>
                    {foldable ? (
                      <button type="button" aria-expanded={true} onClick={() => toggleBlock(id, true)} className="flex min-h-row w-full items-center gap-2 px-2 text-left">
                        <span className="min-w-0 flex-1">{title}</span>
                        <Count n={items.length} of={id} />
                        <Icon icon={ChevronDown} size="sm" className="text-fg-muted" />
                      </button>
                    ) : (
                      <span className="flex min-h-row items-center gap-2 px-2">
                        {id === 'late' ? <Icon icon={Clock} /> : null}
                        <span className="min-w-0 flex-1">{title}</span> <Count n={items.length} of={id} />
                      </span>
                    )}
                  </h2>
                  <ul className="grid">{items.map(i => row(i))}</ul>
                </section>
              )
            )
          })}
          {model.more.length > 0 && user.role !== 'engineer' ? (
            <Fold label={moreText(model)} open={moreOpen} hint={moreOpen ? '' : ' · show'} data-more-fold="" onToggle={() => { moreOpenThisSession = !moreOpen; setMoreOpen(!moreOpen) }}>
              <ul className="grid px-3 pb-2">{model.more.map(i => row(i))}</ul>
            </Fold>
          ) : null}
          {waiting.length > 0 ? (
            <section aria-label="Waiting" data-block="quiet" className={QUIET}>
              <button
                type="button"
                aria-expanded={waitingOpen}
                onClick={() => {
                  waitingToggledThisSession = !waitingOpen
                  setWaitingToggled(!waitingOpen)
                }}
                className="flex min-h-row w-full items-center gap-2 rounded-card px-card py-3 text-left text-base font-semibold text-fg-2"
              >
                <Icon icon={waitingOpen ? ChevronDown : ChevronRight} size="sm" className="text-fg-muted" />
                {/* Words, never a pill (spec 2.2 #8): "Chased, waiting until Mon 30 Nov". */}
                <span>
                  {WAITING_TITLE} · <span className="num">{waiting.length}</span>
                  {!waitingOpen && nextNudge ? <span className="font-regular text-fg-muted">{` · until ${formatDay(nextNudge)}`}</span> : null}
                </span>
                {waitingOpen ? <span className="ml-auto text-base font-regular text-fg-muted max-md:hidden">comes back when its date arrives</span> : null}
              </button>
              {/* Collapsed, it still shows the open row: an item just chased stays where the person is looking. */}
              {shownWaiting.length > 0 ? <ul className="grid px-3 pb-2">{shownWaiting.map(i => row(i, { waiting: true, actions: false }))}</ul> : null}
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
              <ul className="grid px-3 pb-2">{imported.map(i => row(i, { faded: true, actions: false }))}</ul>
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
              <ul className="grid px-3 pb-2">{stale.map(i => row(i, { faded: true }))}</ul>
            </Fold>
          ) : null}
        </>
      )}
    </div>
  )

  // The pane column is drawn while there is something to pick (or the list is loading); an empty Home is one calm column, not a list
  // beside a blank card.
  const pane = wide && (query.isPending || all.length > 0)

  if (team) {
    return (
      <div className="mx-auto grid w-full max-w-table content-start gap-card-gap px-4 pb-12 pt-6 md:px-8" data-user={name}>
        <NoPrimary />
        <header className="grid gap-1">
          <h1 className="text-2xl font-heavy tracking-tight">Home</h1>
          <p className="text-sm text-fg-muted">{headerDate(today)} · the team</p>
          <div className="mt-2">{switcher}</div>
        </header>
        {data ? <TeamView data={data} today={today} selfId={user.id} /> : query.isPending ? <div role="status" aria-busy="true" aria-label="Loading the team" className="p-5"><Skeleton className="h-4 w-2/3" /></div> : <EmptyState mood="error" title="The team could not load" actions={<Button onClick={() => void query.refetch()}>Try again</Button>}>Nothing was changed.</EmptyState>}
      </div>
    )
  }

  return (
    // Forest (11 and 12-home): the page scrolls; the list is the wide column, the pane a card beside it that stays in view and is the only
    // part of Home that scrolls on its own (R-039). 768 to 1279 px: the list takes three fifths; from 1280 the pane is 28rem.
    <div className={cn('mx-auto grid w-full max-w-table grid-cols-[minmax(0,1fr)] items-start gap-card-gap px-4 pb-12 pt-6 md:px-8', pane && 'md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:grid-cols-[minmax(0,1fr)_28rem]')} data-user={name}>
      <NoPrimary />
      <div className="flex min-w-0 flex-col">
        {/* The target tile is the foot of the list, at every width: it scrolls with the list instead of taking a pinned block
            of the laptop's first screen from the jobs (audit T2). An engineer gets no tile at all: a target is PKR amounts, and an
            engineer sees no prices (owner decision 2026-10-22; no request is made). */}
        <div data-today-list className="min-w-0 overflow-x-clip">
          {list}
          {seesPrices(user.role) ? (
            // Admin and sales only (an engineer's branch draws none of this: no amount, and no request is made).
            <div className="mt-card-gap grid gap-card-gap">
              <HomeMoney today={today} admin={user.role === 'admin'} />
              <TargetTile today={today} className={CARD} />
              {/* F-826: on a phone Companies is not on the bottom bar, so Home ends with it (the rail has it from 768 up). */}
              <Link to="/companies" data-home-companies="" className={cn(CARD, 'flex min-h-touch items-center gap-3 px-card py-3 text-base font-semibold text-fg hover:bg-selected md:hidden')}>
                <Icon icon={Building2} />
                <span className="min-w-0 flex-1">Companies</span>
                <Icon icon={ChevronRight} size="sm" />
              </Link>
            </div>
          ) : null}
        </div>
      </div>
      {pane ? (
        <div data-home-pane className={cn(CARD, 'sticky top-6 max-h-[calc(100dvh-var(--topbar-h)-var(--sp-12))] min-w-0 overflow-y-auto p-card')}>
          {current && data ? (
            <Suspense fallback={<PaneSkeleton />}>
              <ContextPane key={current.key} item={current} data={data} today={today} copied={copied} onCopied={markCopied} onReleased={release} nextItem={nextOf(current.key)} onSelect={setSelected} />
            </Suspense>
          ) : query.isPending ? (
            <PaneSkeleton />
          ) : (
            <p className="py-8 text-center text-base text-fg-muted">Select an item to see what to do about it.</p>
          )}
        </div>
      ) : null}
    </div>
  )
}

/** The hero's words per role (10-home.html): the role and first name, then what the one number counts. */
const HERO: Record<Role, { role: string; title: string }> = {
  admin: { role: 'Admin', title: 'Needs you now' },
  sales: { role: 'Sales', title: 'Quotes to send or follow up' },
  engineer: { role: 'Engineer', title: 'My day' },
}

/**
 * The forest hero on top of the list: the same one number as the header and the Home badge (needsYou.ts), drawn large in lime.
 * The header keeps data-needs-you-count; the hero's number is a second sight of it, so it is read out once, in words.
 */
function Hero({ role, name, count }: { role: Role; name: string; count: number }) {
  const h = HERO[role]
  const first = name.trim().split(/\s+/)[0] ?? ''
  return (
    <section data-surface="navy" aria-labelledby="home-hero-title" data-home-hero={role} className="flex flex-wrap items-end justify-between gap-x-5 gap-y-2 rounded-card bg-chrome bg-hero p-card text-fg shadow-e2">
      <div className="min-w-0 flex-1">
        <p className="text-base text-fg-2">{first ? `${h.role}, ${first}` : h.role}</p>
        <h2 id="home-hero-title" className="text-2xl font-heavy tracking-tight max-md:text-xl">{h.title}</h2>
      </div>
      <p className="num text-hero font-heavy text-lime-300">
        <span aria-hidden="true">{count}</span>
        <span className="sr-only">{count === 1 ? '1 thing needs you' : `${count} things need you`}</span>
      </p>
    </section>
  )
}

/** A grey fold: one line that opens its rows. Never counted. */
function Fold({ label, ariaLabel, open, hint, onToggle, children, ...rest }: { label: ReactNode; ariaLabel?: string; open: boolean; hint: string; onToggle: () => void; children: ReactNode } & Record<`data-${string}`, string>) {
  return (
    <section aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)} data-block="quiet" className={QUIET} {...rest}>
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-h-row w-full items-center gap-2 rounded-card px-card py-3 text-left text-base font-semibold text-fg-2">
        <Icon icon={open ? ChevronDown : ChevronRight} size="sm" className="text-fg-muted" />
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
  /** Drawn as its own card (an engineer's day list). */
  card?: boolean
}

function Row({ item, today, role, names, waiting = false, faded = false, actions, open, copied, wide, onPick, onAct, onGo, children, card = false }: RowProps) {
  // On the selected row's background the amber is below 4.5:1, so a warning badge reads in the body colour there (as on the GST register).
  const tone = item.badge.tone === 'danger' ? 'text-tone-danger-fg' : item.badge.tone === 'warning' ? (open ? 'text-fg-2' : 'text-tone-warning-fg') : 'text-fg-muted'
  const second = actions ? secondAction(item, role) : null
  const own = actions && !waiting // the row carries its own button and its own snooze
  return (
    <li data-row-actions="" data-rule={item.rule} data-due={dueOf(item, today, waiting || faded)} data-waiting={waiting || undefined} data-stale={(faded && !item.imported) || undefined} data-imported={item.imported || undefined} className={cn(
        // A row in a block is a tile under a hairline; an engineer's visit is its own card (the day list). The selected row (the one the
        // pane shows) is tinted, with the brand bar at its left edge (11-home-lists.html): the bar is 3:1 on white (WCAG 1.4.11).
        'relative rounded-row transition-colors duration-fast',
        card ? 'border bg-surface p-1 shadow-e1 rounded-card' : 'border-t first:border-t-0',
        open && 'bg-selected before:pointer-events-none before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-pill before:bg-brand-700',
        waiting && item.waiting?.chasedOn === today && isFreshChase(item.key) && 'row-settle')}>
      {/* Line 1 the title, line 2 the reference and party; tap to read what to do about it. */}
      <button
        type="button"
        onClick={onPick}
        aria-expanded={wide ? undefined : open}
        aria-current={wide && open ? 'true' : undefined}
        className="grid w-full min-w-0 gap-px rounded-row px-2 pb-1 pt-2 text-left transition-colors duration-fast hover:bg-sunken focus-visible:bg-sunken"
      >
        <span className={cn('type-row min-w-0 [overflow-wrap:anywhere]', (waiting || faded) && 'font-regular text-fg-2')}>{waiting ? (item.waitingTitle ?? item.title) : item.title}</span>
        <span className="type-body min-w-0 [overflow-wrap:anywhere]">
          <span className="num">{item.ref}</span> · {item.party}
        </span>
        {item.collision && names?.[item.collision.by] ? (
          <span data-collision className="type-body flex items-center gap-1 text-tone-warning-fg">
            <Icon icon={Users} size="chip" /> {chasedByText(names[item.collision.by], item.collision.at, Date.now())}
          </span>
        ) : null}
        {item.waiting ? (
          <span className="text-stamp text-fg-muted">{waitingLine(item.waiting.chasedOn, item.waiting.nextNudgeOn, today, item.rule === 'payment_overdue' ? 'reminded' : 'followed up')}</span>
        ) : null}
      </button>
      {/* Line 3: when it is due, in words (it may wrap at 320), its one button, and snooze. */}
      <div className="flex flex-wrap items-center gap-2 px-2 pb-2" data-row-actions="">
        {waiting ? (
          <span className="sr-only">Waiting</span>
        ) : copied ? (
          <span className="type-row inline-flex min-h-chip items-center rounded-round bg-tone-success-bg px-3 text-tone-success-fg">Copied</span>
        ) : (
          // half the row on a phone, so "15 days overdue" stays on one line and the buttons drop under it, to the right
          <span className={cn('type-row min-w-0 flex-1 basis-1/2 md:basis-1/4', tone)}>{item.badge.text}</span>
        )}
        {own ? (
          <div className="ml-auto flex items-center gap-2">
            <Button variant="secondary" onClick={onAct} aria-label={`${ACTION_LABEL[item.rule]}: ${item.ref} ${item.party}`} className="max-md:min-h-touch">
              {ACTION_LABEL[item.rule]}
            </Button>
            <SnoozeMenu item={item} today={today} iconOnly extra={second ? { label: second.label, ariaLabel: `${second.label}: ${item.ref} ${item.party}`, onSelect: () => onGo(second.href) } : undefined} />
          </div>
        ) : null}
      </div>
      {children}
    </li>
  )
}
