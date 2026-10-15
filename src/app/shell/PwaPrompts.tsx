import { useEffect, useRef } from 'react'
import { IOS_HINT_KEY, readFlag, useInstall, writeFlag } from '@/lib/pwa/install'
import { applyUpdate, useUpdateReady } from '@/lib/pwa/updates'
import { useToast } from '@/ui/useToast'

/**
 * Two quiet toasts, both from the PWA layer (R21). Renders nothing itself.
 *  - A new deploy is waiting: "New version available" with Reload. Reload never discards typing: with unsaved
 *    edits on screen it says so and offers Reload again, and nothing reloads on its own.
 *  - iPhone Safari, once per device: how to add the app to the home screen.
 */
export function PwaPrompts() {
  const { toast } = useToast()
  const updateReady = useUpdateReady()
  const { showIosHint } = useInstall()
  const announced = useRef(false)

  useEffect(() => {
    if (!updateReady || announced.current) return
    announced.current = true
    const offer = (title: string, body?: string) =>
      toast({
        title,
        body,
        duration: 0,
        action: {
          label: 'Reload',
          onClick: () => {
            if (applyUpdate() === 'blocked') offer('Save your changes, then reload', 'The update waits until your form is saved.')
          },
        },
      })
    offer('New version available')
  }, [updateReady, toast])

  useEffect(() => {
    if (!showIosHint || readFlag(IOS_HINT_KEY)) return
    writeFlag(IOS_HINT_KEY)
    toast({ title: 'Add Q-Tech CRM to your home screen', body: 'Tap Share, then Add to Home Screen.', duration: 15000 })
  }, [showIosHint, toast])

  return null
}
