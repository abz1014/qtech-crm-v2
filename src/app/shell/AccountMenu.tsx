import { useNavigate } from 'react-router-dom'
import { LogOut, Settings, Users } from 'lucide-react'
import { ROLE_LABEL, session, type SessionUser } from '@/app/session'
import { cn } from '@/lib/utils'
import { Avatar } from '@/ui/Avatar'
import { MenuItem, MenuSeparator, Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'

/**
 * Account menu: the top-bar avatar opens a Popover (menu variant) with the
 * person's name and role and "Sign out". Esc closes it and returns focus to the avatar.
 */
export function AccountMenu({ user, touch = false }: { user: SessionUser; touch?: boolean }) {
  const navigate = useNavigate()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Account menu, ${user.name}`}
          className={cn(
            'grid place-items-center rounded-round transition-opacity duration-fast ease-out hover:opacity-85',
            touch && 'size-touch',
          )}
        >
          <Avatar name={user.name} />
        </button>
      </PopoverTrigger>
      <PopoverContent variant="menu" align="end" aria-label="Account">
        <div className="grid px-2 pb-1 pt-2 text-sm">
          <span className="font-medium">{user.name}</span>
          <span className="text-xs text-fg-muted">{ROLE_LABEL[user.role] ?? user.role}</span>
        </div>
        <MenuSeparator />
        <MenuItem icon={Settings} onClick={() => navigate('/settings')}>
          Settings
        </MenuItem>
        {user.role === 'admin' ? (
          <MenuItem icon={Users} onClick={() => navigate('/settings/team')}>
            Team
          </MenuItem>
        ) : null}
        <MenuSeparator />
        <MenuItem icon={LogOut} onClick={() => void session.signOut()}>
          Sign out
        </MenuItem>
      </PopoverContent>
    </Popover>
  )
}
