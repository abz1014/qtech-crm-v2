import type { ReactNode } from 'react'
import { FileText } from 'lucide-react'
import { Icon } from '@/ui/Icon'

/*
 * Reserved places for work that is built by other tasks (R09's clarifications panel is built: ClarificationsPanel.tsx). They are marked on the page so nobody mistakes them for a
 * missing feature, and each one has a stable data-slot attribute for the task that fills it:
 *
 *   data-slot="quotations"           R19  the quotations list and the "Issue quotation" action (the header has its own
 *                                         data-slot="issue-quotation" beside Mark bid sent)
 *
 * R19 replaces the body of this component; the props carry what they need to load their own data.
 */

function Slot({ slot, title, task, children, icon }: { slot: string; title: string; task: string; children: ReactNode; icon: typeof FileText }) {
  return (
    <section
      data-slot={slot}
      aria-label={title}
      className="rounded border border-dashed border-line-input bg-sunken px-5 py-4"
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-fg-2">
        <Icon icon={icon} className="text-fg-muted" />
        {title}
        <span className="num ml-auto rounded border border-line-strong bg-surface px-[6px] py-[2px] text-xs font-regular text-fg-muted">{task}</span>
      </div>
      <p className="mt-2 text-sm text-fg-muted">{children}</p>
    </section>
  )
}

export function QuotationsSlot({ rfqId }: { rfqId: string }) {
  void rfqId
  return (
    <Slot slot="quotations" title="Quotations" task="Reserved for R19" icon={FileText}>
      Issued quotations and the Issue quotation action go here.
    </Slot>
  )
}
