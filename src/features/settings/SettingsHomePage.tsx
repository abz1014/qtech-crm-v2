import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { RatesTable } from '@/features/settings/RatesTable'
import { Icon } from '@/ui/Icon'
import { cn } from '@/lib/utils'

/*
 * Settings home (g2-login-team-settings, "Settings home, sales"): where sales and engineers land.
 * The exchange rates at a glance, and a link to the read-only company profile.
 */
function Card({ id, title, text, to, cta, children }: { id: string; title: string; text: string; to: string; cta: string; children?: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-4 rounded border bg-surface p-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-[2px]">
          <h2 id={id} className="text-base font-semibold">{title}</h2>
          <p className="max-w-[62ch] text-sm text-fg-muted text-pretty">{text}</p>
        </div>
        <Link
          to={to}
          className={cn(
            'inline-flex h-control shrink-0 items-center gap-2 rounded border border-line-strong bg-surface px-3 text-sm font-medium text-fg hover:bg-sunken',
          )}
        >
          {cta}
          <Icon icon={ChevronRight} />
        </Link>
      </header>
      {children}
    </section>
  )
}

export function SettingsHomePage() {
  return (
    <div className="grid content-start gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="max-w-[62ch] text-sm text-fg-muted">
          Company details for documents, and the rates used to compare prices in other currencies.
        </p>
      </header>
      <Card
        id="fxh"
        title="Exchange rates"
        text="Updated every night. Anyone on the team can enter today’s rate by hand, for example the bank’s rate."
        to="/settings/exchange-rates"
        cta="Open exchange rates"
      >
        <RatesTable label="Exchange rates summary" />
      </Card>
      <Card
        id="cph"
        title="Company profile"
        text="Legal name, address, tax numbers and standard terms. Ask an admin to change them."
        to="/settings/company"
        cta="View"
      />
    </div>
  )
}
