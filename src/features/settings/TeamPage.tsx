import { useMemo, useState } from 'react'
import { Ellipsis, KeyRound, Pencil, Phone, Search, Shield, UserCheck, UserPlus, UserX } from 'lucide-react'
import { useSession } from '@/app/session'
import { useMobileBar } from '@/app/shell/MobileBarContext'
import type { CreatedUser, Role, TeamMember } from '@/features/settings/api'
import { PasswordDialog } from '@/features/settings/PasswordDialog'
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
import { filterTeam, isActive, roleLabel, teamCounts, type TeamFilter } from '@/features/settings/teamModel'
import { useTeam } from '@/features/settings/hooks'
import { FirstWeekBadge } from '@/features/help/FirstWeekBadge'
import { useFirstWeek } from '@/features/help/useFirstWeek'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'
import { Avatar } from '@/ui/Avatar'
import { Button } from '@/ui/Button'
import { DataTable, type Column } from '@/ui/DataTable'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { MenuItem, MenuSeparator, Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { StatusBadge } from '@/ui/StatusBadge'
import { Tag } from '@/ui/Tag'
import { TextField } from '@/ui/form/TextField'

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
 */
export function TeamPage() {
  const session = useSession()
  const me = session.status === 'signed-in' ? session.user.id : ''
  const isAdmin = session.status === 'signed-in' && session.user.role === 'admin'
  const team = useTeam(isAdmin) // the list is read only for an admin: for anyone else the request is never made
  const [dialog, setDialog] = useState<Open>(null)
  const [filter, setFilter] = useState<TeamFilter>('all')
  const [query, setQuery] = useState('')
  const phone = useMediaQuery('(max-width: 639px)')

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

  // Phone: the shared bar becomes the back bar of the mockup (chevron back to the Settings list, "Team", a primary Add).
  useMobileBar({
    title: 'Team',
    back: '/settings',
    actions: (
      <Button variant="primary" icon={UserPlus} onClick={openAdd} disabled={team.isLoading || team.isError} className="h-9">
        Add
      </Button>
    ),
  })

  // A deactivated person's row is quiet: muted ink in every cell and a neutral avatar (the mockup's is-dim row).
  // Initials stay white on it, so it must be dark enough for 4.5:1 (neutral-400 gave 3.4:1 and failed Lighthouse color-contrast).
  const dim = (m: TeamMember) => (isActive(m) ? undefined : 'text-fg-muted')
  const avatarTone = (m: TeamMember) => (isActive(m) ? undefined : 'bg-[var(--neutral-500)]')

  const columns: Column<TeamMember>[] = [
    {
      id: 'name',
      header: 'Name',
      sortable: true,
      value: m => m.name,
      width: 360,
      cell: m => (
        <span className={cn('flex min-w-0 items-center gap-3', dim(m))}>
          <Avatar name={m.name} className={avatarTone(m)} />
          <span className="grid min-w-0">
            <span className="flex items-center gap-1">
              <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{m.name}</span>
              {m.id === me ? <Tag className="ml-1">You</Tag> : null}
            </span>
            <span className="num min-w-0 text-xs text-fg-muted [overflow-wrap:anywhere]">{m.email ?? 'No email on record'}</span>
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
        <span className={cn('flex flex-wrap items-center gap-2', dim(m))}>
          {roleLabel(m.role)}
          <FirstWeekBadge member={m} facts={firstWeek.data} />
        </span>
      ),
      hideBelowMd: true,
    },
    {
      id: 'job',
      header: 'Job title',
      value: m => m.job_title ?? '',
      cell: m => (m.job_title ? <span className={dim(m)}>{m.job_title}</span> : <span className="text-fg-muted">Not set</span>),
      hideBelowMd: true,
    },
    {
      id: 'status',
      header: 'Status',
      value: m => (isActive(m) ? 'Active' : 'Deactivated'),
      cell: m => <StatusBadge dimension="user" value={isActive(m) ? 'active' : 'deactivated'} />,
      hideBelowMd: true,
    },
    {
      id: 'actions',
      header: 'Actions', // hidden from sight by the table's className below, still the column's name for assistive tech
      align: 'right',
      width: 164,
      cell: m =>
        isActive(m) ? (
          <RowMenu member={m} onPick={open} />
        ) : (
          <Button size="sm" icon={UserCheck} onClick={() => open('reactivate', m)} aria-label={`Reactivate ${m.name}`}>
            Reactivate
          </Button>
        ),
    },
  ]

  const errorCode =
    team.error && typeof team.error === 'object' && 'code' in team.error ? String((team.error as { code?: unknown }).code ?? '') : ''
  const filtered = query !== '' || filter !== 'all'

  return (
    <div className="grid content-start gap-4">
      {/* The phone hides the header (the bar says Team); the page still needs its h1 (WCAG 1.3.1, 2.4.6). */}
      <h1 className="sr-only md:hidden">Team</h1>
      <header className="flex flex-wrap items-start justify-between gap-4 max-md:hidden">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
          <p className="max-w-[62ch] text-sm text-fg-muted">
            Everyone who can sign in to Q-Tech CRM. Passwords are created and reset here, and shown once.
          </p>
        </div>
        <Button variant="primary" icon={UserPlus} onClick={openAdd} disabled={team.isLoading || team.isError}>
          Add person
        </Button>
      </header>

      <DataTable
        label="Team"
        columns={columns}
        rows={rows}
        getRowId={m => m.id}
        defaultSort={null}
        loading={team.isLoading}
        // The Actions header is for assistive tech only. The row whose menu is open takes the selected background.
        // The footer carries the count on the left and the note on the right; on a phone it goes (the note sits under the list).
        className={cn(
          '[&_thead_th:last-child]:text-transparent',
          '[&_tbody_tr:has([data-state=open])]:bg-selected',
          'max-sm:[&>div:last-child]:hidden',
          '[&>div:last-child>span:first-child]:flex [&>div:last-child>span:first-child]:flex-1 [&>div:last-child>span:first-child]:justify-between',
          '[&>div:last-child>span:not(:first-child)]:hidden', // no key legend in this footer (the mockup draws none)
        )}
        error={
          team.isError
            ? {
                title: 'Couldn’t load the team',
                message: 'Nothing has changed. Check your connection, then try again.',
                onRetry: () => void team.refetch(),
                reference: errorCode || undefined,
              }
            : null
        }
        empty={
          filtered ? (
            <EmptyState
              title={query ? `No one matches “${query}”` : 'No one is deactivated'}
              actions={<Button onClick={clearFilter}>Clear filter</Button>}
            >
              {query ? 'Check the spelling, or search by email.' : 'Everyone on the team can sign in.'}
            </EmptyState>
          ) : (
            <EmptyState title="No people yet">Add the first person to give them a way to sign in.</EmptyState>
          )
        }
        onRowOpen={phone ? m => setDialog({ kind: 'sheet', member: m }) : undefined}
        mobileRow={m => (
          <span className={cn('flex items-center gap-3', dim(m))}>
            <Avatar name={m.name} size="xl" className={avatarTone(m)} />
            <span className="grid min-w-0 flex-1">
              <span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{m.name}</span>
              <span className="min-w-0 text-xs text-fg-muted [overflow-wrap:anywhere]">
                {roleLabel(m.role)}
                {m.job_title ? ` · ${m.job_title}` : ''}
              </span>
            </span>
            {isActive(m) ? null : <StatusBadge dimension="user" value="deactivated" />}
            <Icon icon={Ellipsis} className="shrink-0 text-fg-muted" />
          </span>
        )}
        toolbar={
          <div className="flex w-full flex-wrap items-center gap-3">
            <div className="relative w-[260px] max-sm:hidden">
              <Icon icon={Search} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
              <TextField
                aria-label="Search name or email"
                placeholder="Search name or email"
                value={query}
                onChange={e => setQuery(e.target.value)}
                className="pl-8"
              />
            </div>
            <SegmentedControl
              aria-label="Show"
              value={filter}
              onValueChange={v => setFilter(v as TeamFilter)}
              options={[
                { value: 'all', label: 'All', count: counts.all },
                { value: 'active', label: 'Active', count: counts.active },
                { value: 'deactivated', label: 'Deactivated', count: counts.deactivated },
              ]}
            />
            <span className="ml-auto text-xs text-fg-muted max-sm:hidden">At least one active admin is always required.</span>
          </div>
        }
        summary={
          <>
            <span>{`${counts.all} ${counts.all === 1 ? 'person' : 'people'} · ${counts.active} active, ${counts.deactivated} deactivated`}</span>
            <span>Deactivated people keep their name on everything they created.</span>
          </>
        }
      />
      <p className="px-1 text-xs text-fg-muted sm:hidden">At least one active admin is always required.</p>

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
      {dialog?.kind === 'deactivate' ? <DeactivateDialog member={dialog.member} members={members} onClose={close} /> : null}
      {dialog?.kind === 'reactivate' ? <ReactivateDialog member={dialog.member} onClose={close} /> : null}
      {dialog?.kind === 'secret' ? (
        <PasswordDialog kind={dialog.variant} person={dialog.person} password={dialog.password} onClose={close} />
      ) : null}
    </div>
  )
}

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
        <MenuSeparator />
        <MenuItem icon={UserX} danger onClick={() => onPick('deactivate', member)}>
          Deactivate
        </MenuItem>
      </PopoverContent>
    </Popover>
  )
}
