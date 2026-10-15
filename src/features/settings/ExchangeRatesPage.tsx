import { RatesTable } from '@/features/settings/RatesTable'

/** Exchange rates (R15): open to the whole team, read-only here. The rate behind every foreign price comparison. */
export function ExchangeRatesPage() {
  return (
    <div className="grid content-start gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Exchange rates</h1>
        <p className="max-w-[62ch] text-sm text-fg-muted">
          Updated every night. Anyone on the team can enter today’s rate by hand, for example the bank’s rate.
        </p>
      </header>
      <RatesTable />
    </div>
  )
}
