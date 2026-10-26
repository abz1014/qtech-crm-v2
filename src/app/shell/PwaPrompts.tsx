import { useEffect, useRef } from 'react'
import { IOS_HINT_KEY, readFlag, useInstall, writeFlag } from '@/lib/pwa/install'
import { applyUpdate, isApplyingUpdate, useUpdateReady } from '@/lib/pwa/updates'
import { useToast } from '@/ui/useToast'

/**
 * Two quiet toasts, both from the PWA layer (R21). Renders nothing itself.
 *  - A new deploy is waiting and the app could not switch by itself (typing, or a dialog open: src/lib/pwa/updates.ts):
 *    "New version ready. Reload to update (your typing is kept)." with Reload. Reload never discards typing: with unsaved
 *    edits on screen it says so and offers Reload again. It switches by itself at the next safe moment.
 *  - iPhone Safari, once per device: how to add the app to the home screen.
 */
export function PwaPrompts() {
  const { toast } = useToast()
  const updateReady = useUpdateReady()
  const { showIosHint } = useInstall()
  const announced = useRef(false)

  useEffect(() => {
    // Already switching (a safe moment came first): nothing to ask.
    if (!updateReady || announced.current || isApplyingUpdate()) return
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
    offer('New version ready', 'Reload to update (your typing is kept).')
  }, [updateReady, toast])

  useEffect(() => {
    if (!showIosHint || readFlag(IOS_HINT_KEY)) return
    writeFlag(IOS_HINT_KEY)
    toast({ title: 'Add Q-Tech CRM to your home screen', body: 'Tap Share, then Add to Home Screen.', duration: 15000 })
  }, [showIosHint, toast])

  return null
}
