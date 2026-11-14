import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Ellipsis, KeyRound, Pencil, Phone, Shield, UserCheck, UserPlus, UserRoundCog, UserX } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useSession } from '@/app/session'
import { useMobileBar } from '@/app/shell/MobileBarContext'
import type { CreatedUser, Role, TeamMember } from '@/features/settings/api'
import { PasswordDialog } from '@/features/settings/PasswordDialog'
import { ReassignWorkDialog } from '@/features/owners/ReassignDialogs'
import { RowActionSheet, type RowAction } from '@/features/settings/RowActionSheet'
import {
  AddPersonDialog,
  ChangeRoleDialog,
  DeactivateDialog,
  EditJobTitleDialog,
  EditPhoneDialog,
  ReactivateDialog,
  ResetPasswordDialog,
} from '@/features/settings/TeamDialogs'
import { filterTeam, hasLoneAdmin, isActive, LONE_ADMIN_BODY, LONE_ADMIN_TITLE, roleLabel, teamCounts, type TeamFilter } from '@/features/settings/teamModel'
import { useTeam } from '@/features/settings/hooks'
import { FirstWeekBadge } from '@/features/help/FirstWeekBadge'
import { useFirstWeek } from '@/features/help/useFirstWeek'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { useQueryParamText } from '@/lib/useQueryParamText'
import { cn } from '@/lib/utils'
import { Avatar } from '@/ui/Avatar'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { DataTable, type Column } from '@/ui/DataTable'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { NoResults } from '@/ui/NoResults'
import { PageHeader } from '@/ui/PageHeader'
import { MenuItem, MenuSeparator, Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { StatusBadge } from '@/ui/StatusBadge'
import { TableFilter } from '@/ui/TableFilter'
import { Tag } from '@/ui/Tag'

type Open =
  | null
  | { kind: 'add' }
  | { kind: RowAction | 'sheet'; member: TeamMember }
  | { kind: 'secret'; variant: 'created' | 'reset'; person: { name: string; email: string; role: Role }; password: string }

/**
 * Team (A04, admin only; the route guard sends everyone else to the no-access page). Lists everyone
 * with role and status. Add, change role, reset password, edit job title, deactivate and reactivate
 * are each a dialog, and each one calls the admin-users function. On a phone the rows are 60px cards,
 * pressing one opens the actions as a bottom sheet, and the shared bar becomes the back bar with Add.
 * Round 2 (R2-14): only a deactivated person has a status chip (an active one is the normal case), "Search people" is the
 * shared TableFilter kept in `?q=`, and All / Active / Deactivated carry no counts (the footer says them in words).
 */
export function TeamPage() {
  const session = useSession()
  const me = session.status === 'signed-in' ? session.user.id : ''
  const isAdmin = session.status === 'signed-in' && session.user.role === 'admin'
  const team = useTeam(isAdmin) // the list is read only for an admin: for anyone else the request is never made
  const [dialog, setDialog] = useState<Open>(null)
  const [filter, setFilter] = useState<TeamFilter>('all')
  const [query, setQuery] = useQueryParamText()
  const phone = useMediaQuery('(max-width: 639px)')
  // Mockup 76 (F-792): the people read as a full table only when the Settings pane is 50rem wide or more. In a narrower pane (a tablet,
  // a laptop with the Settings list beside it) Role, Job title and Status fold into a second line under the name, so the table never
  // runs out of its card. Under 640 px DataTable draws cards anyway.
  const workRef = useRef<HTMLDivElement>(null)
  const narrow = useNarrowerThan(workRef, 50)

  const members = useMemo(() => team.data ?? [], [team.data])
  const counts = teamCounts(members)
  const firstWeek = useFirstWeek(members, isAdmin)
  const rows = useMemo(() => filterTeam(members, filter, query), [members, filter, query])
  const close = () => setDialog(null)
  const open = (kind: RowAction, member: TeamMember) => setDialog({ kind, member })
  const openAdd = () => setDialog({ kind: 'add' })
  const clearFilter = () => {
    setQuery('')
    setFilter('all')
  }

  // Phone: the shared bar is the back bar (chevron back to the Settings list, "Team"). Add person is NOT in the bar: the owner
  // could not find or press the small bar "Add" on Android (2026-10-22), so it is a full-width 44 px button at the top of the page.
  useMobileBar({ title: 'Team', back: '/settings' })

  // A deactivated person's row is quiet: muted ink in every cell and a pale avatar (mockup 76 .qb-people__dim: the canvas-deep
  // disc with muted initials, 6:1 or better, where the old dark grey disc with white initials read as louder than an active row).
  const dim = (m: TeamMember) => (isActive(m) ? undefined : 'text-fg-muted')
  const avatarTone = (m: TeamMember) => (isActive(m) ? undefined : 'bg-deep text-fg-muted')

  const columns: Column<TeamMember>[] = [
    {
      id: 'name',
      header: 'Name',
      sortable: true,
      value: m => m.name,
      cell: m => (
        <span className={cn('flex min-w-0 items-center gap-3', narrow ? 'py-1' : 'min-w-[14rem]', dim(m))}>
          <Avatar name={m.name} className={avatarTone(m)} />
          <span className="grid min-w-0 gap-y-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={cn('min-w-0 font-card [overflow-wrap:anywhere]', isActive(m) && 'text-fg')}>{m.name}</span>
              {m.id === me ? <Tag>You</Tag> : null}
            </span>
            <span className="num min-w-0 text-sm text-fg-muted [overflow-wrap:anywhere]">{m.email ?? 'No email on record'}</span>
            {narrow ? (
              // only the words wrap: the Setup badge keeps its one line and moves under them when there is no room
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {roleLabel(m.role)}
                  {m.job_title ? ` · ${m.job_title}` : ''}
                </span>
                <FirstWeekBadge member={m} facts={firstWeek.data} />
                {isActive(m) ? null : <StatusBadge dimension="user" value="deactivated" />}
              </span>
            ) : null}
          </span>
        </span>
      ),
    },
    {
      id: 'role',
      header: 'Role',
      sortable: false,
      value: m => roleLabel(m.role),
      cell: m => (
        // the Setup badge goes under the role when the column is narrow, on one line of its own
        <span className={cn('flex flex-wrap items-center gap-x-2 gap-y-1', dim(m))}>
          {roleLabel(m.role)}
          <FirstWeekBadge member={m} facts={firstWeek.data} />
        </span>
      ),
      hideClass: narrow ? 'hidden' : 'hidden md:table-cell',
    },
    {
      id: 'job',
      header: 'Job title',
      value: m => m.job_title ?? '',
      // A long title wraps at its spaces ([overflow-wrap] lifts the table's one-line rule) instead of pushing the table out of its card.
      cell: m => (m.job_title ? <span className={cn('[overflow-wrap:break-word]', dim(m))}>{m.job_title}</span> : <span className="text-fg-muted">Not set</span>),
      hideClass: narrow ? 'hidden' : 'hidden md:table-cell',
    },
    {
      id: 'status',
      header: 'Status',
      value: m => (isActive(m) ? 'Active' : 'Deactivated'),
      // An active person reads "Active" in plain text (a blank cell read as missing, audit 2026-10-22); only the exception is a chip.
      cell: m => (isActive(m) ? <span className="text-fg-2">Active</span> : <StatusBadge dimension="user" value="deactivated" />),
      hideClass: narrow ? 'hidden' : 'hidden md:table-cell',
    },
    {
      id: 'actions',
      header: 'Actions', // hidden from sight by the table's className below, still the column's name for assistive tech
      align: 'right',
      width: narrow ? 56 : 164,
      cell: m =>
        isActive(m) ? (
          <span data-row-actions="" className="inline-flex"><RowMenu member={m} onPick={open} /></span>
        ) : narrow ? (
          // the narrow pane keeps the button's name and drops its word, so the name column keeps the width
          <Button size="sm" icon={UserCheck} onClick={() => open('reactivate', m)} aria-label={`Reactivate ${m.name}`} />
        ) : (
          <Button size="sm" icon={UserCheck} onClick={() => open('reactivate', m)} aria-label={`Reactivate ${m.name}`}>
            Reactivate
          </Button>
        ),
    },
  ]

  const errorCode =
    team.error && typeof team.error === 'object' && 'code' in team.error ? String((team.error as { code?: unknown }).code ?? '') : ''
  const filtered = query.trim() !== '' || filter !== 'all'

  return (
    <div className="grid content-start gap-4">
      {/* On a phone the h1 is read but not drawn (PageHeader: max-md:sr-only; the bar says Team); Add person is full width, 44 px. */}
      <PageHeader
        title="Team"
        className="max-md:[&>div:last-child]:w-full"
        lede={<span className="max-md:hidden">Users who can sign in to Q-Tech CRM. Passwords are created and reset here, and shown once.</span>}
        primary={
          <Button variant="primary" icon={UserPlus} onClick={openAdd} disabled={team.isLoading || team.isError} className="max-md:h-touch max-md:w-full">
            Add person
          </Button>
        }
      />

      {isAdmin && team.isSuccess && hasLoneAdmin(members) ? (
        <Banner
          tone="warning"
          title={LONE_ADMIN_TITLE}
          action={
            <Link to="?help=lone-admin-recovery" className="inline-flex min-h-touch items-center text-base font-medium text-primary underline underline-offset-4">
              How to get back in
            </Link>
          }
        >
          {LONE_ADMIN_BODY}
        </Banner>
      ) : null}

      <div ref={workRef} data-work="" className="min-w-0">
      <DataTable
        label="Team"
        columns={columns}
        rows={rows}
        getRowId={m => m.id}
        defaultSort={null}
        loading={team.isLoading}
        toolbarCard
        className={TABLE_LOOK}
        error={
          team.isError
            ? {
                title: 'Could not load the team',
                message: 'Nothing has changed. Check your connection, then try again.',
                onRetry: () => void team.refetch(),
                reference: errorCode || undefined,
              }
            : null
        }
        empty={
          query.trim() ? (
            <NoResults
              query={query}
              scope="the team"
              fields="name and email"
              filtersOn={filter === 'all' ? [] : [`Show: ${filter === 'active' ? 'Active' : 'Deactivated'}`]}
              onClear={clearFilter}
            />
          ) : filtered ? (
            <EmptyState title={filter === 'deactivated' ? 'No one is deactivated' : 'No one is active'} actions={<Button onClick={clearFilter}>Show everyone</Button>}>
              {filter === 'deactivated' ? 'All users can sign in.' : 'Reactivate a user to allow sign-in again.'}
            </EmptyState>
          ) : (
            <EmptyState title="No people yet">Add the first person to give them a way to sign in.</EmptyState>
          )
        }
        onRowOpen={phone ? m => setDialog({ kind: 'sheet', member: m }) : undefined}
        mobileRow={m => (
          <span className={cn('flex items-center gap-3', dim(m))}>
            <Avatar name={m.name} size="2xl" className={avatarTone(m)} />
            <span className="grid min-w-0 flex-1 gap-1">
              <span className={cn('min-w-0 text-base font-card [overflow-wrap:anywhere]', isActive(m) && 'text-fg')}>{m.name}</span>
              <span className="min-w-0 text-sm text-fg-muted [overflow-wrap:anywhere]">
                {roleLabel(m.role)}
                {m.job_title ? ` · ${m.job_title}` : ''}
              </span>
              {/* Under the name, not beside it: beside it the chip took the width and the name broke into 3-letter lines at 320 px. */}
              {isActive(m) ? null : <StatusBadge dimension="user" value="deactivated" className="justify-self-start" />}
            </span>
            <Icon icon={Ellipsis} className="shrink-0 text-fg-muted" />
          </span>
        )}
        toolbar={
          <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-3">
            <TableFilter label="Search people" hint="Finds a person by name or email." value={query} onChange={setQuery} />
            {/* fill on a phone: the three choices share the card's width and stay on one line at 320 */}
            <SegmentedControl
              fill={phone}
              aria-label="Show"
              value={filter}
              onValueChange={v => setFilter(v as TeamFilter)}
              options={[
                { value: 'all', label: 'All' },
                { value: 'active', label: 'Active' },
                { value: 'deactivated', label: 'Deactivated' },
              ]}
            />
            <span className="ml-auto text-base text-fg-muted max-sm:hidden">At least one active admin is always required.</span>
          </div>
        }
        summary={
          <>
            <span>{`${counts.all} ${counts.all === 1 ? 'person' : 'people'} · ${counts.active} active, ${counts.deactivated} deactivated`}</span>
            <span>Deactivated people keep their name on everything they created.</span>
          </>
        }
      />
      </div>
      <p className="px-1 text-sm text-fg-muted sm:hidden">At least one active admin is always required.</p>

      {dialog?.kind === 'sheet' ? <RowActionSheet member={dialog.member} onClose={close} onPick={open} /> : null}
      {dialog?.kind === 'add' ? (
        <AddPersonDialog
          members={members}
          onClose={close}
          onCreated={(c: CreatedUser) =>
            setDialog({ kind: 'secret', variant: 'created', person: { name: c.user.name, email: c.user.email, role: c.user.role }, password: c.password })
          }
        />
      ) : null}
      {dialog?.kind === 'title' ? <EditJobTitleDialog member={dialog.member} onClose={close} /> : null}
      {dialog?.kind === 'phone' ? <EditPhoneDialog member={dialog.member} onClose={close} /> : null}
      {dialog?.kind === 'role' ? <ChangeRoleDialog member={dialog.member} members={members} onClose={close} /> : null}
      {dialog?.kind === 'reset' ? (
        <ResetPasswordDialog
          member={dialog.member}
          onClose={close}
          onReset={password => {
            const m = dialog.member
            setDialog({ kind: 'secret', variant: 'reset', person: { name: m.name, email: m.email ?? '', role: m.role }, password })
          }}
        />
      ) : null}
      {dialog?.kind === 'reassign' ? <ReassignWorkDialog fromId={dialog.member.id} fromName={dialog.member.name} onClose={close} /> : null}
      {dialog?.kind === 'deactivate' ? <DeactivateDialog member={dialog.member} members={members} onClose={close} /> : null}
      {dialog?.kind === 'reactivate' ? <ReactivateDialog member={dialog.member} onClose={close} /> : null}
      {dialog?.kind === 'secret' ? (
        <PasswordDialog kind={dialog.variant} person={dialog.person} password={dialog.password} onClose={close} />
      ) : null}
    </div>
  )
}

/** True while the element is narrower than `rem` root ems (a container query for one switch; Tailwind here has no container plugin). */
function useNarrowerThan(ref: RefObject<HTMLElement>, rem: number): boolean {
  const [narrow, setNarrow] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const width = el.getBoundingClientRect().width
      const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      // 0 is "not laid out" (a test page, a hidden tab): keep the full table
      setNarrow(width > 0 && width < rem * root)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, rem])
  return narrow
}

/*
 * The table's look on top of DataTable (toolbarCard: search and Show in their own card, the people in the card under it). The root's
 * last child is that card: its last child is the foot band, the scroll box before it holds the table.
 * - The Actions header is for assistive tech only; the row whose menu is open takes the selected background.
 * - Foot: the count on the left, the note on the right, no key legend (mockup 76 draws none); on a phone it goes and the note sits under
 *   the list.
 * - Phone (under 640 px, DataTable's card rows): each person is their own Forest card, 64 px, 12 px apart (mockup .qb-people__cards), so
 *   the shared card frame steps back while there are people to show. Loading, empty and error keep the frame.
 */
// Tailwind reads class names from the source as written, so each one is spelled out in full (no built strings).
const TABLE_LOOK = cn(
  '[&_thead_th:last-child]:text-transparent',
  '[&_tbody_tr:has([data-state=open])]:bg-selected',
  // the foot band
  'max-sm:[&>div:last-child>div:last-child]:hidden',
  '[&>div:last-child>div:last-child>span:first-child]:flex [&>div:last-child>div:last-child>span:first-child]:flex-1',
  '[&>div:last-child>div:last-child>span:first-child]:flex-wrap [&>div:last-child>div:last-child>span:first-child]:justify-between',
  '[&>div:last-child>div:last-child>span:first-child]:gap-x-4 [&>div:last-child>div:last-child>span:not(:first-child)]:hidden',
  // phone: one card per person
  'max-sm:[&>div:last-child:has(tr[data-card])]:overflow-visible max-sm:[&>div:last-child:has(tr[data-card])]:border-0',
  'max-sm:[&>div:last-child:has(tr[data-card])]:bg-transparent max-sm:[&>div:last-child:has(tr[data-card])]:shadow-none',
  'max-sm:[&_tbody:has(tr[data-card])]:grid max-sm:[&_tbody:has(tr[data-card])]:gap-3',
  'max-sm:[&_tr[data-card]]:rounded-card max-sm:[&_tr[data-card]]:border max-sm:[&_tr[data-card]]:bg-surface max-sm:[&_tr[data-card]]:shadow-e1',
  'max-sm:[&_tr[data-card]]:transition-transform max-sm:[&_tr[data-card]:active]:scale-press',
  'max-sm:[&_tr[data-card]>td]:min-h-row-tall max-sm:[&_tr[data-card]>td]:items-center max-sm:[&_tr[data-card]>td]:py-2',
)

function RowMenu({ member, onPick }: { member: TeamMember; onPick: (kind: RowAction, m: TeamMember) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="quiet" size="sm" icon={Ellipsis} aria-label={`Actions for ${member.name}`} />
      </PopoverTrigger>
      <PopoverContent variant="menu" align="end" aria-label={`Actions for ${member.name}`}>
        <MenuItem icon={Pencil} onClick={() => onPick('title', member)}>
          Edit job title
        </MenuItem>
        <MenuItem icon={Phone} onClick={() => onPick('phone', member)}>
          Edit phone
        </MenuItem>
        <MenuItem icon={Shield} onClick={() => onPick('role', member)}>
          Change role
        </MenuItem>
        <MenuItem icon={KeyRound} onClick={() => onPick('reset', member)}>
          Reset password
        </MenuItem>
        <MenuItem icon={UserRoundCog} onClick={() => onPick('reassign', member)}>
          Move open work
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={UserX} danger onClick={() => onPick('deactivate', member)}>
          Deactivate
        </MenuItem>
      </PopoverContent>
    </Popover>
  )
}
