import { cn } from '@/lib/utils'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { useTextSize } from '@/ui/useTextSize'
import { useSingleKeyShortcuts } from '@/ui/useShortcutsSetting'
import { Checkbox } from '@/ui/form/Checkbox'

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
    <section aria-labelledby="text-size-h" className={cn('grid gap-3 rounded-panel border bg-surface p-5', className)}>
      <div className="grid gap-[2px]">
        <h2 id="text-size-h" className="text-base font-semibold">
          Text size
        </h2>
        <p className="max-w-[62ch] text-sm text-fg-2 text-pretty">
          Normal is the easier-to-read size. Larger is bigger still (18 px). Smaller fits more on the screen. It changes this device only, straight away.
        </p>
      </div>
      <TextSizeControl className="justify-self-start" />
    </section>
  )
}

/** "Keyboard shortcuts" for Settings > Your details (WCAG SC 2.1.4): N, C, G then T, "/" and "?" can be turned off. */
export function ShortcutsPanel({ className }: { className?: string }) {
  const [on, setOn] = useSingleKeyShortcuts()
  return (
    <section aria-labelledby="shortcuts-h" className={cn('grid gap-3 rounded-panel border bg-surface p-5', className)}>
      <div className="grid gap-[2px]">
        <h2 id="shortcuts-h" className="text-base font-semibold">
          Keyboard shortcuts
        </h2>
        <p className="max-w-[62ch] text-sm text-fg-2 text-pretty">
          N starts an RFQ, E adds an expense (admin), O starts an order without an enquiry, C opens Paste or photo, G then T goes to To do, / jumps to a list&apos;s search and ? opens the keyboard
          shortcuts. Turn these off if you use voice control or press keys by accident. Ctrl+K and Ctrl+Z always work. This device only.
        </p>
      </div>
      <Checkbox label="Single-key shortcuts on" checked={on} onCheckedChange={v => setOn(v === true)} />
    </section>
  )
}
