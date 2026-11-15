import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useSeesPrices } from '@/app/session'
import { useFxLatest } from '@/features/rfqs/hooks'
import { RatesTable } from '@/features/settings/RatesTable'
import { ratesStatusLine } from '@/features/settings/ratesModel'
import { Icon } from '@/ui/Icon'
import { PageHeader } from '@/ui/PageHeader'
import { button } from '@/ui/buttonStyles'
import { cn } from '@/lib/utils'

/*
 * Settings home: where sales and engineers land (an admin goes to Team). The side menu already lists Company profile and
 * Exchange rates, so the body does not repeat them as cards (audit 2026-10-22): it is today's rates, with one status line that
 * says what actually happened ("Last automatic update Thu 22 Oct. 2 rates entered by hand.") and one quiet link to add a rate.
 * An engineer sees no rates (currency amounts, owner decision 2026-10-22): neither shown nor fetched; the page points to the
 * company profile instead.
 */
export function SettingsHomePage() {
  return useSeesPrices() ? <RatesHome /> : <NoRatesHome />
}

// The page's one way on: a white button (buttonStyles), the same look as every secondary action in Forest.
const LINK = cn(button({ variant: 'secondary' }), 'max-md:h-touch')

function RatesHome() {
  const fx = useFxLatest()
  return (
    <div className="grid content-start gap-card-gap">
      <PageHeader
        title="Today's exchange rates"
        lede={fx.data ? ratesStatusLine(fx.data) : undefined}
        secondary={
          <Link to="/settings/exchange-rates" className={LINK}>
            Add a rate or see history
            <Icon icon={ChevronRight} />
          </Link>
        }
      />
      <RatesTable label="Today's exchange rates" />
    </div>
  )
}

function NoRatesHome() {
  return (
    <div className="grid content-start gap-card-gap">
      <PageHeader
        title="Settings"
        lede="Company details for documents. Ask an admin to change them."
        secondary={
          <Link to="/settings/company" className={LINK}>
            View company profile
            <Icon icon={ChevronRight} />
          </Link>
        }
      />
    </div>
  )
}
