import * as RadixDialog from '@radix-ui/react-dialog'
import { useBackToClose } from '@/lib/useBackToClose'
import { KeyRound, Pencil, Phone, Shield, UserCheck, UserX, type LucideIcon } from 'lucide-react'
import type { TeamMember } from '@/features/settings/api'
import { isActive, roleLabel } from '@/features/settings/teamModel'
import { cn } from '@/lib/utils'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'

/*
 * The phone's row actions (g2-login-team-settings, "Row actions as a bottom sheet"): a grab handle,
 * the person (avatar, name, "Role · Job title"), then 44px rows, Deactivate last and red. A person
 * who is deactivated gets Reactivate alone. Opened by pressing the row; the desktop keeps its menu.
 */
export type RowAction = 'title' | 'phone' | 'role' | 'reset' | 'deactivate' | 'reactivate'

const ACTIVE: readonly { kind: RowAction; label: string; icon: LucideIcon; danger?: boolean }[] = [
  { kind: 'title', label: 'Edit job title', icon: Pencil },
  { kind: 'phone', label: 'Edit phone', icon: Phone },
  { kind: 'role', label: 'Change role', icon: Shield },
  { kind: 'reset', label: 'Reset password', icon: KeyRound },
  { kind: 'deactivate', label: 'Deactivate', icon: UserX, danger: true },
]
const INACTIVE = [{ kind: 'reactivate', label: 'Reactivate', icon: UserCheck }] as const

export function RowActionSheet({
  member,
  onPick,
  onClose,
}: {
  member: TeamMember
  onPick: (kind: RowAction, m: TeamMember) => void
  onClose: () => void
}) {
  const items: readonly { kind: RowAction; label: string; icon: LucideIcon; danger?: boolean }[] = isActive(member) ? ACTIVE : INACTIVE
  useBackToClose(true, onClose)
  const sub = `${roleLabel(member.role)}${member.job_title ? ` · ${member.job_title}` : ''}`
  return (
    <RadixDialog.Root open onOpenChange={open => !open && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 animate-fade-in bg-scrim" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 animate-sheet-in rounded-t bg-surface pb-4 shadow-modal focus:outline-none"
        >
          <div aria-hidden="true" className="mx-auto mb-1 mt-2 h-1 w-[2.25rem] rounded-round bg-line-strong" />
          <div className="flex items-center gap-3 border-b px-4 pb-3 pt-2">
            <Avatar name={member.name} size="lg" />
            <div className="grid min-w-0">
              <RadixDialog.Title className="min-w-0 [overflow-wrap:anywhere] text-sm font-medium text-fg">{member.name}</RadixDialog.Title>
              <span className="min-w-0 [overflow-wrap:anywhere] text-xs text-fg-muted">{sub}</span>
            </div>
          </div>
          <ul>
            {items.map(a => (
              <li key={a.kind}>
                <button
                  type="button"
                  onClick={() => onPick(a.kind, member)}
                  className={cn(
                    'flex min-h-touch w-full items-center gap-3 px-4 py-2 text-left text-sm font-medium active:bg-sunken',
                    a.danger ? 'text-tone-danger-fg' : 'text-fg',
                  )}
                >
                  <Icon icon={a.icon} size="lg" className={a.danger ? undefined : 'text-fg-muted'} />
                  {a.label}
                </button>
              </li>
            ))}
          </ul>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
