import { useMemo, useState } from 'react'
import { Ellipsis, KeyRound, Pencil, Search, Shield, UserCheck, UserPlus, UserX } from 'lucide-react'
import { useSession } from '@/app/session'
import type { CreatedUser, Role, TeamMember } from '@/features/settings/adminUsers'
import { PasswordDialog } from '@/features/settings/PasswordDialog'
import {
  AddPersonDialog,
  ChangeRoleDialog,
  DeactivateDialog,
  EditJobTitleDialog,
  ReactivateDialog,
  ResetPasswordDialog,
} from '@/features/settings/TeamDialogs'
import { filterTeam, isActive, roleLabel, teamCounts, type TeamFilter } from '@/features/settings/teamModel'
import { useRefreshTeam, useTeam } from '@/features/settings/useTeam'
import { Avatar } from '@/ui/Avatar'
import { Button } from '@/ui/Button'
import { DataTable, type Column } from '@/ui/DataTable'
import { Icon } from '@/ui/Icon'
import { MenuItem, MenuSeparator, Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { StatusBadge } from '@/ui/StatusBadge'
import { Tag } from '@/ui/Tag'
import { TextField } from '@/ui/form/TextField'

type Open =
  | null
  | { kind: 'add' }
  | { kind: 'title' | 'role' | 'reset' | 'deactivate' | 'reactivate'; member: TeamMember }
  | { kind: 'secret'; variant: 'created' | 'reset'; person: { name: string; email: string; role: Role }; password: string }

/**
 * Team (A04, admin only; the route guard sends everyone else to the no-access page). Lists everyone
 * with role and status. Add, change role, reset password, edit job title, deactivate and reactivate
 * are each a dialog, and each one calls the admin-users function.
 */
export function TeamPage() {
  const session = useSession()
  const me = session.status === 'signed-in' ? session.user.id : ''
  const team = useTeam(true)
  const refresh = useRefreshTeam()
  const [dialog, setDialog] = useState<Open>(null)
  const [filter, setFilter] = useState<TeamFilter>('all')
  const [query, setQuery] = useState('')

  const members = useMemo(() => team.data ?? [], [team.data])
  const counts = teamCounts(members)
  const rows = useMemo(() => filterTeam(members, filter, query), [members, filter, query])
  const close = () => setDialog(null)
  const open = (kind: 'title' | 'role' | 'reset' | 'deactivate' | 'reactivate', member: TeamMember) => setDialog({ kind, member })

  const columns: Column<TeamMember>[] = [
    {
      id: 'name',
      header: 'Name',
      sortable: true,
      value: m => m.name,
      cell: m => (
        <span className="flex min-w-0 items-center gap-3">
          <Avatar name={m.name} className={isActive(m) ? undefined : 'opacity-60'} />
          <span className="grid min-w-0 max-md:max-w-[150px]">
            <span className="flex items-center gap-2">
              <span className="truncate font-medium">{m.name}</span>
              {m.id === me ? <Tag>You</Tag> : null}
            </span>
            <span className="num truncate text-xs text-fg-muted max-md:hidden">{m.email ?? 'No email on record'}</span>
            {/* Phone: role and title under the name replace the columns that are hidden there. */}
            <span className="truncate text-xs text-fg-muted md:hidden">
              {isActive(m) ? '' : 'Deactivated · '}
              {roleLabel(m.role)}
              {m.job_title ? ` · ${m.job_title}` : ''}
            </span>
          </span>
        </span>
      ),
    },
    { id: 'role', header: 'Role', sortable: true, value: m => roleLabel(m.role), hideBelowMd: true },
    {
      id: 'job',
      header: 'Job title',
      value: m => m.job_title ?? '',
      cell: m => (m.job_title ? m.job_title : <span className="text-fg-muted">Not set</span>),
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
      header: 'Actions',
      align: 'right',
      width: 132,
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

  return (
    <div className="grid content-start gap-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
          <p className="max-w-prose text-sm text-fg-muted">
            Everyone who can sign in to Q-Tech CRM. Passwords are created and reset here, and shown once.
          </p>
        </div>
        <Button variant="primary" icon={UserPlus} onClick={() => setDialog({ kind: 'add' })} disabled={team.isLoading}>
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
        error={
          team.isError
            ? {
                title: 'Could not load the team',
                message: team.error instanceof Error ? team.error.message : undefined,
                onRetry: () => void team.refetch(),
              }
            : null
        }
        empty={
          <p className="px-6 py-10 text-center text-sm text-fg-muted">
            {query ? `No one matches "${query}".` : filter === 'deactivated' ? 'No one is deactivated.' : 'No people yet.'}
          </p>
        }
        toolbar={
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-[240px] max-sm:w-full">
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
            <span className="ml-auto text-xs text-fg-muted">At least one active admin is always required.</span>
          </div>
        }
        summary={`${counts.all} ${counts.all === 1 ? 'person' : 'people'}, ${counts.active} active, ${counts.deactivated} deactivated`}
      />
      <p className="text-right text-xs text-fg-muted">Deactivated people keep their name on everything they created.</p>

      {dialog?.kind === 'add' ? (
        <AddPersonDialog
          members={members}
          onClose={close}
          onChanged={refresh}
          onCreated={(c: CreatedUser) =>
            setDialog({ kind: 'secret', variant: 'created', person: { name: c.user.name, email: c.user.email, role: c.user.role }, password: c.password })
          }
        />
      ) : null}
      {dialog?.kind === 'title' ? <EditJobTitleDialog member={dialog.member} onClose={close} onChanged={refresh} /> : null}
      {dialog?.kind === 'role' ? <ChangeRoleDialog member={dialog.member} members={members} onClose={close} onChanged={refresh} /> : null}
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
      {dialog?.kind === 'deactivate' ? <DeactivateDialog member={dialog.member} members={members} onClose={close} onChanged={refresh} /> : null}
      {dialog?.kind === 'reactivate' ? <ReactivateDialog member={dialog.member} onClose={close} onChanged={refresh} /> : null}
      {dialog?.kind === 'secret' ? (
        <PasswordDialog kind={dialog.variant} person={dialog.person} password={dialog.password} onClose={close} />
      ) : null}
    </div>
  )
}

function RowMenu({ member, onPick }: { member: TeamMember; onPick: (kind: 'title' | 'role' | 'reset' | 'deactivate', m: TeamMember) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="quiet" size="sm" icon={Ellipsis} aria-label={`Actions for ${member.name}`} />
      </PopoverTrigger>
      <PopoverContent variant="menu" align="end" aria-label={`Actions for ${member.name}`}>
        <MenuItem icon={Pencil} onClick={() => onPick('title', member)}>
          Edit job title
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
