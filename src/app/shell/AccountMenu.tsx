import { useNavigate } from 'react-router-dom'
import { Download, KeyRound, LogOut, Settings, Users } from 'lucide-react'
import { ROLE_LABEL, session, type SessionUser } from '@/app/session'
import { cn } from '@/lib/utils'
import { promptInstall, useInstall } from '@/lib/pwa/install'
import { Avatar } from '@/ui/Avatar'
import { MenuGroup, MenuItem, MenuSeparator, Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { useTextSize } from '@/ui/useTextSize'

/**
 * Account menu: the top-bar avatar opens a Popover (menu variant) with the
 * person's name and role, Settings, the Text size choice (Normal or Smaller,
 * applied at once and kept on this device) and "Sign out". Esc closes it and
 * returns focus to the avatar.
 */
export function AccountMenu({ user, touch = false }: { user: SessionUser; touch?: boolean }) {
  const navigate = useNavigate()
  const { canPrompt } = useInstall()
  const [textSize, setTextSize] = useTextSize()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'grid place-items-center rounded-round transition-opacity duration-fast ease-out hover:opacity-85',
            touch && 'size-touch',
          )}
        >
          <span className="sr-only">Account menu, </span>
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
        <MenuItem icon={KeyRound} onClick={() => navigate('/settings/password')}>
          Change password
        </MenuItem>
        <MenuGroup label="Text size">
          <MenuItem keepOpen checked={textSize === 'normal'} onClick={() => setTextSize('normal')}>
            Normal
          </MenuItem>
          <MenuItem keepOpen checked={textSize === 'small'} onClick={() => setTextSize('small')}>
            Smaller
          </MenuItem>
        </MenuGroup>
        {canPrompt ? (
          <MenuItem icon={Download} onClick={() => void promptInstall()}>
            Install app
          </MenuItem>
        ) : null}
        <MenuSeparator />
        <MenuItem icon={LogOut} danger onClick={() => void session.signOut()}>
          Sign out
        </MenuItem>
      </PopoverContent>
    </Popover>
  )
}
