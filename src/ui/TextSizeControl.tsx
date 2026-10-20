import { cn } from '@/lib/utils'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { useTextSize } from '@/ui/useTextSize'

const OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'small', label: 'Smaller' },
] as const

/** "Text size: Normal / Smaller" as a SegmentedControl. Applies at once, on this device (src/ui/useTextSize.ts). */
export function TextSizeControl({ className }: { className?: string }) {
  const [size, setSize] = useTextSize()
  return (
    <SegmentedControl
      aria-label="Text size"
      value={size}
      onValueChange={v => setSize(v === 'small' ? 'small' : 'normal')}
      options={OPTIONS}
      large
      className={className}
    />
  )
}

/** The Text size panel for Settings > Your details: a heading, one line on what it does, and the control. */
export function TextSizePanel({ className }: { className?: string }) {
  return (
    <section aria-labelledby="text-size-h" className={cn('grid gap-3 rounded border bg-surface p-5', className)}>
      <div className="grid gap-[2px]">
        <h2 id="text-size-h" className="text-base font-semibold">
          Text size
        </h2>
        <p className="max-w-[62ch] text-sm text-fg-2 text-pretty">
          Normal is the larger, easier-to-read size. Smaller fits more on the screen. It changes this device only, straight away.
        </p>
      </div>
      <TextSizeControl className="justify-self-start" />
    </section>
  )
}
