import { navItems, type NavKey } from '@/app/navConfig'
import { PageFrame } from '@/app/pages/PageFrame'
import { Icon } from '@/ui/Icon'

/** What each destination will hold. One line, in the person's words. */
const LEDE: Record<NavKey, string> = {
  today: 'What needs you today: quotations, chases, goods and payments.',
  rfqs: 'Enquiries from first contact to quotation, win or close.',
  orders: 'Orders from purchase order to delivery and invoice.',
  companies: 'Customers and suppliers, with their history.',
  money: 'Who owes us, invoices and GST, expenses, month end and reports.',
}

/**
 * Stand-in for a destination whose screen has not been built yet (the R, O, M
 * and P tasks replace it). Shows the shell around real content: the title and
 * the shape of the empty state the screen will use.
 */
export function DestinationPage({ navKey }: { navKey: NavKey }) {
  const item = navItems.find(i => i.key === navKey)
  if (!item) return null
  return (
    <PageFrame title={item.label} lede={LEDE[navKey]}>
      <div className="grid justify-items-center gap-3 rounded border bg-surface px-6 py-16 text-center">
        <span className="grid size-10 place-items-center rounded border bg-sunken text-fg-muted">
          <Icon icon={item.icon} size="xl" />
        </span>
        <p className="text-base font-medium">The {item.label} screen is not built yet</p>
        <p className="max-w-prose text-sm text-fg-muted">
          The navigation, your role and the page frame are live. This screen arrives with its own task.
        </p>
      </div>
    </PageFrame>
  )
}
