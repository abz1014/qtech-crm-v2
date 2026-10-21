import { useState } from 'react'
import { CircleArrowUp } from 'lucide-react'
import { hasDirtyForms } from '@/lib/pwa/dirtyForms'
import { reloadOntoNewVersion } from '@/lib/pwa/updates'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'

/*
 * "Update needed — tap Reload" (owner decision 2026-10-22, src/lib/pwa/minVersion.ts). Shown above the shell while this copy of
 * the app is older than the server's minimum: reading goes on, saves are refused. Reload moves the window onto the new version.
 * The unsaved-forms rule holds: with a form holding typed edits on screen, the first tap only says what a reload would clear (a
 * New RFQ keeps its draft on this device; other forms do not) and the second tap reloads. Nothing reloads on its own.
 */
export function UpdateNeededBanner() {
  const [warned, setWarned] = useState(false)
  const [busy, setBusy] = useState(false)

  const reload = () => {
    if (!warned && hasDirtyForms()) {
      setWarned(true)
      return
    }
    setBusy(true)
    void reloadOntoNewVersion()
  }

  return (
    <div
      role="alert"
      data-update-needed-banner=""
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-tone-danger-fg/25 bg-tone-danger-bg px-4 py-2 text-sm text-fg-2"
    >
      <Icon icon={CircleArrowUp} className="shrink-0 text-tone-danger-fg" />
      <p className="min-w-0 flex-1 text-pretty">
        <b className="font-semibold text-fg">Update needed — tap Reload</b>
        {' — '}
        {warned
          ? 'Reloading clears what is typed in the open form (a New RFQ keeps its draft). Copy anything you need, then tap Reload again.'
          : 'This copy of the app is out of date, so saving is paused. You can still read everything.'}
      </p>
      <Button size="sm" variant="primary" onClick={reload} busy={busy} busyLabel="Reloading">
        {warned ? 'Reload anyway' : 'Reload'}
      </Button>
    </div>
  )
}
