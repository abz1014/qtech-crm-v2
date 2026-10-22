import { Landmark, Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'
import type { PaidVia } from '@/features/money/expenses/model'

/**
 * Cash | Bank as two 44 px buttons at 16 px (redesign phase 1: readable first). Both are always visible, so one tap picks either;
 * the chosen one is pressed (aria-pressed) and drawn with an ink edge, never by colour alone.
 */
export function PaidByToggle({ value, onChange, order = ['cash', 'bank'] }: { value: PaidVia; onChange: (v: PaidVia) => void; order?: readonly PaidVia[] }) {
  return (
    <div role="group" aria-label="Paid by" className="inline-flex w-fit gap-[2px] rounded bg-selected p-[2px]">
      {order.map(v => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            'inline-flex min-h-touch items-center gap-2 rounded border px-4 text-base font-medium transition-colors',
            value === v ? 'border-fg bg-surface text-fg' : 'border-transparent text-fg-2 hover:text-fg',
          )}
        >
          <Icon icon={v === 'cash' ? Wallet : Landmark} className="text-fg-muted" />
          {v === 'cash' ? 'Cash' : 'Bank'}
        </button>
      ))}
    </div>
  )
}
