import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { versionLabel } from '@/lib/pwa/buildInfo'
import { checkForUpdateNow, type CheckResult } from '@/lib/pwa/updates'
import { MenuItem } from '@/ui/Popover'
import { Icon } from '@/ui/Icon'

/*
 * Which build is this? "Version a1b2c3d · 26 Oct 2026" (owner asked 2026-10-26), at the bottom of Settings and in the account
 * menu. Tapping it is "Check for update now": it asks which build is live, fetches its worker and, when a newer build is
 * waiting, switches to it (a form with unsaved edits blocks it; src/lib/pwa/updates.ts checkForUpdateNow).
 */
export const CHECK_TEXT: Record<CheckResult | 'checking', string> = {
  checking: 'Checking…',
  latest: 'You have the latest version.',
  updating: 'Updating to the newest version…',
  blocked: 'Save your changes first, then check again.',
  offline: 'Cannot check: no connection.',
  pending: 'A newer version is on its way. Try again in a minute.',
}

function useCheck(check: () => Promise<CheckResult>) {
  const [state, setState] = useState<CheckResult | 'checking' | null>(null)
  const run = () => {
    if (state === 'checking' || state === 'updating') return
    setState('checking')
    void check().then(setState, () => setState('offline'))
  }
  return { state, run }
}

/** Settings: the version, and "Check for update now" under it. `check` is for tests. */
export function VersionLabel({ check = checkForUpdateNow }: { check?: () => Promise<CheckResult> }) {
  const { state, run } = useCheck(check)
  return (
    <div data-version-label="" className="grid justify-items-start gap-1 px-3 pb-2 pt-4 text-sm text-fg-muted">
      <button
        type="button"
        onClick={run}
        aria-label={`${versionLabel()}. Check for update now`}
        className="grid min-h-touch justify-items-start gap-[2px] rounded text-left hover:text-fg"
      >
        <span>{versionLabel()}</span>
        <span className="inline-flex items-center gap-1 font-medium text-fg-2 underline underline-offset-2">
          <Icon icon={RefreshCw} size="sm" />
          Check for update now
        </span>
      </button>
      <p role="status" className="min-h-[1.5em]">
        {state ? CHECK_TEXT[state] : ''}
      </p>
    </div>
  )
}

/** The account menu's row: the version, which checks for an update when tapped. The menu stays open to show the answer. */
export function VersionMenuItem({ check = checkForUpdateNow }: { check?: () => Promise<CheckResult> }) {
  const { state, run } = useCheck(check)
  return (
    <MenuItem
      icon={RefreshCw}
      keepOpen
      onClick={run}
      aria-label={`${versionLabel()}. Check for update now`}
      className="h-auto min-h-control py-2"
    >
      <span className="block whitespace-normal">{state ? CHECK_TEXT[state] : versionLabel()}</span>
    </MenuItem>
  )
}
