import { cn } from '@/lib/utils'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { useTextSize } from '@/ui/useTextSize'
import { useSingleKeyShortcuts } from '@/ui/useShortcutsSetting'
import { Checkbox } from '@/ui/form/Checkbox'
import { KEYBOARD_MEDIA } from '@/ui/keyboardMedia'
import { useMediaQuery } from '@/lib/useMediaQuery'

const OPTIONS = [
  { value: 'small', label: 'Smaller' },
  { value: 'normal', label: 'Normal' },
  { value: 'large', label: 'Larger' },
] as const

/** "Text size: Smaller / Normal / Larger" as a SegmentedControl. Applies at once, on this device (src/ui/useTextSize.ts). */
export function TextSizeControl({ className }: { className?: string }) {
  const [size, setSize] = useTextSize()
  return (
    <SegmentedControl
      aria-label="Text size"
      value={size}
      onValueChange={v => setSize(v === 'small' || v === 'large' ? v : 'normal')}
      options={OPTIONS}
      large
      className={className}
    />
  )
}

/** The Text size panel for Settings > Your details: a heading, one line on what it does, and the control. */
export function TextSizePanel({ className }: { className?: string }) {
  return (
    <section aria-labelledby="text-size-h" className={cn('grid gap-3 border-t pt-4', className)}>
      <div className="grid gap-1">
        <h2 id="text-size-h" className="type-section">
          Text size
        </h2>
        <p className="max-w-prose text-base text-fg-2 text-pretty">
          Normal is the easier-to-read size. Larger is bigger still (18 px). Smaller fits more on the screen. It changes this device only, straight away.
        </p>
      </div>
      <TextSizeControl className="justify-self-start" />
    </section>
  )
}

/**
 * "Keyboard shortcuts" for Settings > Your details (WCAG SC 2.1.4): N, E, O, G then T, "/" and "?" can be turned off. The list of keys
 * shows only where a keyboard is likely (a fine pointer from 768 px; F-806, R-044); a phone gets the one sentence on what the switch is
 * for, since voice control still types keys there.
 */
export function ShortcutsPanel({ className }: { className?: string }) {
  const [on, setOn] = useSingleKeyShortcuts()
  const keyboard = useMediaQuery(KEYBOARD_MEDIA)
  return (
    <section aria-labelledby="shortcuts-h" className={cn('grid gap-3 border-t pt-4', className)}>
      <div className="grid gap-1">
        <h2 id="shortcuts-h" className="type-section">
          Keyboard shortcuts
        </h2>
        {keyboard ? (
          <p className="max-w-prose text-base text-fg-2 text-pretty">
            N starts an RFQ, E adds an expense (admin), O starts an order without an RFQ, G then T goes to Home, / jumps to a list&apos;s search and ? opens the keyboard
            shortcuts. Turn these off if you use voice control or press keys by accident. Ctrl+K and Ctrl+Z always work. This device only.
          </p>
        ) : (
          <p className="max-w-prose text-base text-fg-2 text-pretty">
            Single keys work with a keyboard. Turn them off if you use voice control or press keys by accident. This device only.
          </p>
        )}
      </div>
      <Checkbox label="Single-key shortcuts on" checked={on} onCheckedChange={v => setOn(v === true)} />
    </section>
  )
}
