import { useEffect, useMemo, useState } from 'react'
import { Banknote, CalendarCheck, ChevronDown, ChevronRight, FileCheck, Hourglass, MessageCircleQuestion, ReceiptText, Reply, Send, Share2, ShoppingCart, Truck, Users, Wrench, type LucideIcon } from 'lucide-react'
import { useSession } from '@/app/session'
import { formatDay } from '@/lib/formatDay'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { Skeleton } from '@/ui/Skeleton'
import { ContextPane } from '@/features/today/ContextPane'
import { useBusinessToday, useTodayView } from '@/features/today/hooks'
import { TargetTile } from '@/features/today/TargetTile'
import { isFreshChase } from '@/features/today/chaseMemory'
import { chasedByText } from '@/features/rfqs/lib/collision'
import { headerDate, waitingLine } from '@/features/today/text'
import type { Role, RuleKey, TodayItem, TodayTab } from '@/features/today/types'

/*
 * Today (R11, direction B): a 420px list and a context pane. Groups: overdue or due today, the next 5 days, ready to
 * move, then Waiting (the system's cooldown, dimmed, never in the count of things that need you; collapsed when it holds
 * more than 5). On a phone the pane folds into an accordion under the row. The empty state is the goal state.
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
  delivered_not_invoiced: ReceiptText,
  close_month: CalendarCheck,
}

const TAB_LABEL: Record<'all' | TodayTab, string> = { all: 'All', bids: 'Bids', sourcing: 'Sourcing', money: 'Money' }
const WAITING_OPEN_MAX = 5

/** Whether the person opened or closed the Waiting group, kept for this browser session only (null: not touched, the size decides). */
let waitingToggledThisSession: boolean | null = null

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
  const markCopied = (k: string) => setCopied(s => new Set(s).add(k))
  const release = (k: string) =>
    setCopied(s => {
      const n = new Set(s)
      n.delete(k)
      return n
    })

  const inTab = (i: TodayItem) => tab === 'all' || i.tab === tab
  const active = useMemo(() => (view ? view.active.filter(inTab) : []), [view, tab]) // eslint-disable-line react-hooks/exhaustive-deps
  const waiting = useMemo(() => (view ? view.waiting.filter(inTab) : []), [view, tab]) // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(
    () => (view ? [
      { id: 'now', title: 'Overdue or due today', items: view.now.filter(inTab) },
      { id: 'soon', title: 'Due in the next 5 days', items: view.soon.filter(inTab) },
      { id: 'ready', title: 'Ready to move', items: view.ready.filter(inTab) },
    ] : []),
    [view, tab], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const all = useMemo(() => [...active, ...waiting], [active, waiting])
  // Desktop always has something selected (the first item); a selection that left the list moves on.
  const current = all.find(i => i.key === selected) ?? (wide ? active[0] ?? waiting[0] : undefined)
  const openId = wide ? current?.key : expanded

  useEffect(() => {
    if (selected && !all.some(i => i.key === selected) && !copied.has(selected)) setSelected(null)
  }, [all, selected, copied])

  const counts = useMemo(() => {
    const a = view?.active ?? []
    return { all: a.length, bids: a.filter(i => i.tab === 'bids').length, sourcing: a.filter(i => i.tab === 'sourcing').length, money: a.filter(i => i.tab === 'money').length }
  }, [view])
  const dueNow = view?.now.length ?? 0
  const tabs: Array<'all' | TodayTab> = user.role === 'engineer' ? ['all', 'bids', 'sourcing'] : ['all', 'bids', 'sourcing', 'money']

  // Five or fewer: open. More than five: collapsed, and opening it is the person's choice (remembered for the session).
  const waitingOpen = waitingToggled ?? waiting.length <= WAITING_OPEN_MAX
  const nextOf = (key: string) => active.find(i => i.key !== key)

  const pick = (k: string) => {
    if (wide) setSelected(k)
    else setExpanded(e => (e === k ? null : k))
  }

  const list = (
    <div className="grid content-start">
      <header className="grid gap-1 px-5 pb-3 pt-5">
        <h1 className={wide ? 'text-2xl font-semibold tracking-tight' : 'sr-only'}>Today</h1>
        <p className="text-sm text-fg-muted">
          {headerDate(today)}
          {view ? (
            <>
              {wide ? ' · ' : ' · '}
              <b className="num font-medium text-fg">{counts.all}</b> need you{wide ? ' · ' : ', '}
              <b className="num font-medium text-fg">{dueNow}</b> due now
            </>
          ) : null}
        </p>
        {wide ? null : <TargetTile today={today} className="mt-2 rounded border bg-surface" />}
        <SegmentedControl
          aria-label="Show"
          className="mt-2 justify-self-start"
          value={tab}
          onValueChange={v => setTab(v as 'all' | TodayTab)}
          options={tabs.map(t => ({ value: t, label: TAB_LABEL[t], count: counts[t] }))}
        />
      </header>

      {query.isPending ? (
        <div className="grid gap-4 px-5 py-4" aria-busy="true" aria-label="Loading Today">
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
          {active.length === 0 ? (
            <EmptyState mood="goal" title={tab === 'all' ? 'Nothing needs you today' : 'Nothing here needs you today'}>
              {waiting.length > 0
                ? 'Everything you chased is waiting for its date. It comes back here when it is time to nudge.'
                : 'Chases, bids and goods that need you will appear here.'}
            </EmptyState>
          ) : null}
          {groups.map(g =>
            g.items.length === 0 ? null : (
              <section key={g.id} aria-label={g.title}>
                <h2 className="flex items-baseline gap-2 border-y bg-sunken px-5 py-2 text-xs font-medium text-fg-2">
                  {g.title} <span className="num font-regular text-fg-muted">{g.items.length}</span>
                </h2>
                <ul>
                  {g.items.map(i => (
                    <Row key={i.key} item={i} today={today} names={data?.names} open={openId === i.key} copied={copied.has(i.key)} wide={wide} onPick={() => pick(i.key)}>
                      {!wide && expanded === i.key && data ? (
                        <div className="border-l-2 border-brand-green bg-canvas px-4 py-4">
                          <ContextPane item={i} data={data} today={today} copied={copied} onCopied={markCopied} onReleased={release} compact nextItem={nextOf(i.key)} onSelect={k => setExpanded(k)} />
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
                className="flex w-full items-center gap-2 px-5 py-3 text-left text-sm font-medium text-fg-2"
              >
                <Icon icon={waitingOpen ? ChevronDown : ChevronRight} size="sm" />
                Waiting <span className="num font-regular text-fg-muted">{waiting.length}</span>
                <span className="ml-auto text-xs font-regular text-fg-muted">
                  {waitingOpen
                    ? 'comes back when its date arrives'
                    : `next nudge ${formatDay(waiting[0].waiting?.nextNudgeOn ?? today)}`}
                </span>
              </button>
              {waitingOpen ? (
                <ul>
                  {waiting.map(i => (
                    <Row key={i.key} item={i} today={today} names={data?.names} waiting open={openId === i.key} copied={false} wide={wide} onPick={() => pick(i.key)}>
                      {!wide && expanded === i.key && data ? (
                        <div className="border-l-2 border-brand-green bg-canvas px-4 py-4">
                          <ContextPane item={i} data={data} today={today} copied={copied} onCopied={markCopied} onReleased={release} compact nextItem={nextOf(i.key)} onSelect={k => setExpanded(k)} />
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
    <div className="grid min-h-full md:h-full md:grid-cols-[420px_minmax(0,1fr)]" data-user={name}>
      <div className="flex min-h-0 flex-col border-r bg-surface">
        {/* On a phone the target tile sits above the list; on desktop it is the foot of the list column. */}
        <div className="min-h-0 flex-1 md:overflow-y-auto">{list}</div>
        {wide ? <div className="border-t bg-surface"><TargetTile today={today} /></div> : null}
      </div>
      {wide ? (
        <div className="min-h-0 overflow-y-auto px-8 py-6">
          {current && data ? (
            <div className="mx-auto max-w-[860px]">
              <ContextPane key={current.key} item={current} data={data} today={today} copied={copied} onCopied={markCopied} onReleased={release} nextItem={nextOf(current.key)} onSelect={setSelected} />
            </div>
          ) : query.isPending ? null : (
            <div className="grid h-full place-items-center text-sm text-fg-muted">Select an item to see what to do about it.</div>
          )}
        </div>
      ) : null}
    </div>
  )
}

function Row({ item, today, names, waiting = false, open, copied, wide, onPick, children }: { item: TodayItem; today: string; names?: Record<string, string>; waiting?: boolean; open: boolean; copied: boolean; wide: boolean; onPick: () => void; children?: React.ReactNode }) {
  const tone = item.badge.tone === 'danger' ? 'text-tone-danger-fg' : item.badge.tone === 'warning' ? 'text-tone-warning-fg' : 'text-fg-muted'
  return (
    <li data-rule={item.rule} data-waiting={waiting || undefined} className="border-b last:border-b-0">
      <button
        type="button"
        onClick={onPick}
        aria-expanded={wide ? undefined : open}
        aria-current={wide && open ? 'true' : undefined}
        className={cn(
          'grid w-full items-start gap-3 border-l-2 px-5 py-3 text-left transition-colors duration-fast hover:bg-sunken focus-visible:bg-sunken',
          open ? 'border-brand-green bg-selected' : 'border-transparent',
          wide ? 'grid-cols-[2rem_minmax(0,1fr)_auto]' : 'grid-cols-[2rem_minmax(0,1fr)_auto_auto]',
          waiting && 'bg-sunken',
          waiting && item.waiting?.chasedOn === today && isFreshChase(item.key) && 'row-settle',
        )}
      >
        <span className={cn('grid size-8 place-items-center rounded border bg-surface', waiting ? 'text-fg-muted' : 'text-fg-2')}>
          <Icon icon={ICON[item.rule]} size="md" />
        </span>
        <span className="grid min-w-0 gap-px">
          <span className={cn('truncate text-sm font-medium', waiting && 'font-regular text-fg-2')}>{waiting ? (item.waitingTitle ?? item.title) : item.title}</span>
          <span className="truncate text-xs text-fg-muted">
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
          <span className={cn('num whitespace-nowrap pt-1 text-xs', tone)}>{item.badge.text}</span>
        )}
        {wide ? null : <Icon icon={ChevronRight} size="sm" className={cn('mt-1 text-fg-muted transition-transform duration-fast', open && 'rotate-90')} />}
      </button>
      {children}
    </li>
  )
}
