import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { newEntries } from '@/app/shell/newEntries'
import { Button } from '@/ui/Button'
import { Kbd } from '@/ui/Kbd'
import { MenuItem, Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { cn } from '@/lib/utils'

/*
 * "+ New" (redesign phase 3, plan section (c)): one menu for the things a person starts, by role.
 *   admin     New enquiry (N) · Expense · Payment received · Order without enquiry
 *   sales     New enquiry (N) · Order without enquiry           payments are admin only (0010): no "Payment received"
 *   engineer  none: the menu is not drawn (an engineer's own button is Photo or note, on the job)
 * The key letters are shown, and they work only outside a text field (PaletteHost, shortcuts.ts).
 */
export function NewMenu({ role, className, labelClass, iconOnly = false, size = 'md' }: { role: string; className?: string; labelClass?: string; iconOnly?: boolean; size?: 'md' | 'touch' }) {
  const navigate = useNavigate()
  const entries = newEntries(role)
  if (entries.length === 0) return null
  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* Outlined, never green: each screen has its own one primary button (audit X1). */}
        <Button variant="secondary" size={size} icon={Plus} aria-label={iconOnly ? 'New' : undefined} className={cn(className)}>
          {iconOnly ? null : <span className={labelClass}>New</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent variant="menu" align="end" aria-label="New">
        {entries.map(e => (
          <MenuItem key={e.id} icon={e.icon} onClick={() => navigate(e.to)} hint={e.key ? <Kbd aria-hidden className="max-md:hidden">{e.key}</Kbd> : undefined}>
            {e.label}
          </MenuItem>
        ))}
      </PopoverContent>
    </Popover>
  )
}
