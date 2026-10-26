import { useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { CircleHelp, Download, Keyboard, KeyRound, LogOut, Receipt, Settings, Users } from 'lucide-react'
import { PaletteContext } from '@/app/palette/usePalette'
import { KEYBOARD_MEDIA } from '@/app/shell/shortcuts'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { ROLE_LABEL, session, type SessionUser } from '@/app/session'
import { useHelp } from '@/features/help/useHelp'
import { cn } from '@/lib/utils'
import { promptInstall, useInstall } from '@/lib/pwa/install'
import { VersionMenuItem } from '@/app/shell/VersionLabel'
import { Avatar } from '@/ui/Avatar'
import { Kbd } from '@/ui/Kbd'
import { MenuGroup, MenuItem, MenuSeparator, Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { useTextSize } from '@/ui/useTextSize'

/**
 * Account menu: the top-bar avatar opens a Popover (menu variant) with the
 * person's name and role, Settings, the Text size choice (Normal or Smaller,
 * applied at once and kept on this device) and "Sign out". Esc closes it and
 * returns focus to the avatar. The version ("Version a1b2c3d · 26 Oct 2026") sits above Sign out; tapping it checks for an update. "Keyboard shortcuts" (with its ? key) shows only where a keyboard is likely: a fine pointer
 * from md up.
 */
export function AccountMenu({ user, touch = false }: { user: SessionUser; touch?: boolean }) {
  const navigate = useNavigate()
  const { openHelp } = useHelp()
  const { canPrompt } = useInstall()
  const [textSize, setTextSize] = useTextSize()
  const openShortcuts = useContext(PaletteContext)?.openShortcuts
  const keyboard = useMediaQuery(KEYBOARD_MEDIA)
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
        {user.role === 'engineer' ? (
          // 0087 (owner decision 2026-10-22): engineers record what they paid themselves, for the admin to approve
          <MenuItem icon={Receipt} onClick={() => navigate('/my-expenses')}>
            I paid
          </MenuItem>
        ) : null}
        <MenuItem icon={CircleHelp} onClick={() => openHelp()}>
          Help
        </MenuItem>
        {keyboard && openShortcuts ? (
          <MenuItem icon={Keyboard} hint={<Kbd>?</Kbd>} onClick={openShortcuts}>
            Keyboard shortcuts
          </MenuItem>
        ) : null}
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
          <MenuItem keepOpen checked={textSize === 'large'} onClick={() => setTextSize('large')}>
            Larger
          </MenuItem>
        </MenuGroup>
        {canPrompt ? (
          <MenuItem icon={Download} onClick={() => void promptInstall()}>
            Install app
          </MenuItem>
        ) : null}
        <MenuSeparator />
        <VersionMenuItem />
        <MenuItem icon={LogOut} danger onClick={() => void session.signOut()}>
          Sign out
        </MenuItem>
      </PopoverContent>
    </Popover>
  )
}
