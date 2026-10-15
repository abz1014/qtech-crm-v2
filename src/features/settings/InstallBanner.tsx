import { useState } from 'react'
import { Download, Share } from 'lucide-react'
import { DISMISS_KEY, IOS_BANNER_KEY, promptInstall, readFlag, useInstall, writeFlag } from '@/lib/pwa/install'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'

/**
 * "Install the app" (R21), at the top of Settings. Android Chrome: one button that opens the browser's own
 * install dialog. iPhone Safari: the Share, Add to Home Screen steps. Quiet by design: it sits in Settings
 * (not on the work screens), "Not now" is remembered on this device, and the account menu still offers Install.
 */
export function InstallBanner() {
  const { canPrompt, showIosHint } = useInstall()
  const [hidden, setHidden] = useState(() => readFlag(DISMISS_KEY))
  const [iosHidden, setIosHidden] = useState(() => readFlag(IOS_BANNER_KEY))

  if (canPrompt && !hidden) {
    return (
      <Banner
        tone="info"
        title="Install the app"
        className="mb-6"
        action={
          <span className="flex gap-2">
            <Button size="sm" variant="primary" onClick={() => void promptInstall()}>
              <Icon icon={Download} size="sm" />
              Install
            </Button>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => {
                writeFlag(DISMISS_KEY)
                setHidden(true)
              }}
            >
              Not now
            </Button>
          </span>
        }
      >
        Q-Tech CRM opens full screen from your home screen, like any other app.
      </Banner>
    )
  }

  if (showIosHint && !iosHidden) {
    return (
      <Banner
        tone="info"
        title="Add Q-Tech CRM to your home screen"
        className="mb-6"
        action={
          <Button
            size="sm"
            variant="quiet"
            onClick={() => {
              writeFlag(IOS_BANNER_KEY)
              setIosHidden(true)
            }}
          >
            Got it
          </Button>
        }
      >
        Tap <Icon icon={Share} size="sm" className="inline align-[-2px]" /> <span className="font-medium">Share</span> in Safari, then{' '}
        <span className="font-medium">Add to Home Screen</span>.
      </Banner>
    )
  }

  return null
}
