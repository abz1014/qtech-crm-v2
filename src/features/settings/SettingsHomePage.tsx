import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useFxLatest } from '@/features/rfqs/hooks'
import { RatesTable } from '@/features/settings/RatesTable'
import { ratesStatusLine } from '@/features/settings/ratesModel'
import { Icon } from '@/ui/Icon'
import { PageHeader } from '@/ui/PageHeader'

/*
 * Settings home: where sales and engineers land (an admin goes to Team). The side menu already lists Company profile and
 * Exchange rates, so the body does not repeat them as cards (audit 2026-10-22): it is today's rates, with one status line that
 * says what actually happened ("Last automatic update Thu 22 Oct. 2 rates entered by hand.") and one quiet link to add a rate.
 */
export function SettingsHomePage() {
  const fx = useFxLatest()
  return (
    <div className="grid content-start gap-4">
      <PageHeader
        title="Today's exchange rates"
        lede={fx.data ? ratesStatusLine(fx.data) : undefined}
        secondary={
          <Link
            to="/settings/exchange-rates"
            className="inline-flex h-control shrink-0 items-center gap-2 rounded border border-line-strong bg-surface px-3 text-sm font-medium text-fg hover:bg-sunken max-md:h-touch"
          >
            Add a rate or see history
            <Icon icon={ChevronRight} />
          </Link>
        }
      />
      <RatesTable label="Today's exchange rates" />
    </div>
  )
}
