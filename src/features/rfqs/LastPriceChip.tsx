import { History } from 'lucide-react'
import type { LastPriceChip } from '@/lib/memory'
import { Icon } from '@/ui/Icon'
import { Tag } from '@/ui/Tag'

/*
 * "Last price for this item" under a reply row (R17; g2-rfq-detail.html .rep-sub). This supplier's last quote or last
 * ordered price for the SAME item (same model or same item), in its own currency, then PKR at the rate captured on the
 * day it was entered ("at the time", never today's). No captured rate means the original currency only. A price older
 * than 18 months carries its age; a price whose currency is unverified is not shown.
 */
export function LastPriceChipView({ chip }: { chip: LastPriceChip }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted md:col-span-full" data-last-price>
      <Icon icon={History} size="sm" />
      <span>
        Last price for this item:{' '}
        {chip.state === 'hidden' ? (
          <b className="font-medium text-fg-2">price on file, currency unverified</b>
        ) : (
          <>
            <b className="num font-medium text-fg-2">{chip.amount}</b>
            {chip.pkr ? (
              <>
                {' '}
                <span className="num">≈ PKR {chip.pkr}</span> <em className="not-italic underline decoration-dotted underline-offset-2">at the time</em>
                {chip.rate ? <span className="num">{` (rate ${chip.rate})`}</span> : null}
              </>
            ) : null}
            {chip.note ? <> · {chip.note}</> : null}
          </>
        )}
        {' · '}
        {chip.from === 'order' ? 'ordered ' : 'quoted '}
        <span className="num">{chip.date.text}</span>
        {chip.date.ago ? <span className="text-tone-warning-fg">{` (${chip.date.ago})`}</span> : null}
        {' · '}
        <em className="not-italic">{chip.tierLabel}</em>
      </span>
      {chip.imported ? <Tag dashed>Imported</Tag> : null}
    </p>
  )
}
