import { Building2, ChevronRight, KeyRound, User, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useSeesPrices } from '@/app/session'
import { CARD } from '@/ui/card'
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
 * An engineer sees no rates (currency amounts, owner decision 2026-10-22): neither shown nor fetched. Their page was nearly
 * blank (screen review 2026-11-24, item 21), so it lists what they can do here, each with one line: their own details, text
 * size and shortcuts, their password, and the company profile to read. Nothing on it carries an amount.
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
      <RatesTable />
    </div>
  )
}

interface HomeItem {
  to: string
  title: string
  body: string
  icon: LucideIcon
}

const ENGINEER_ITEMS: readonly HomeItem[] = [
  { to: '/settings/details', title: 'Your details', body: 'Your phone number, the text size and the keyboard shortcuts.', icon: User },
  { to: '/settings/password', title: 'Change password', body: 'Choose a new password for signing in.', icon: KeyRound },
  { to: '/settings/company', title: 'Company profile', body: 'The company details printed on documents. Ask an admin to change them.', icon: Building2 },
]

function NoRatesHome() {
  return (
    <div className="grid content-start gap-card-gap">
      <PageHeader title="Settings" lede="Your own settings, and the company details to read." />
      <ul className="grid gap-3 md:grid-cols-2" aria-label="Settings you can open">
        {ENGINEER_ITEMS.map(item => (
          <li key={item.to} className="min-w-0">
            <Link
              to={item.to}
              className={cn(CARD, 'flex min-h-touch items-start gap-3 p-card transition-colors duration-fast ease-out hover:bg-sunken')}
            >
              <Icon icon={item.icon} className="mt-px shrink-0 text-fg-2" />
              <span className="grid min-w-0 gap-1">
                <span className="text-base font-card text-fg">{item.title}</span>
                <span className="text-sm text-fg-muted">{item.body}</span>
              </span>
              <Icon icon={ChevronRight} size="sm" className="ml-auto mt-px shrink-0 text-fg-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
