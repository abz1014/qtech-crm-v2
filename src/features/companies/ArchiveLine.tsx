import { Link } from 'react-router-dom'
import { Fine } from '@/features/companies/CompanyParts'

/**
 * "N older items in Archive": how many of a company's RFQs and orders the lists leave out (archived, migration 0141). Admin gets a
 * link to the Archive page filtered to this company; everyone else reads plain text. Nothing is shown for none.
 */
export function ArchiveLine({ companyId, count, isAdmin }: { companyId: string; count: number; isAdmin: boolean }) {
  if (count <= 0) return null
  const words = `${count} older ${count === 1 ? 'item' : 'items'} in Archive`
  return (
    <div className="px-5 pb-3 pt-1">
      {isAdmin ? (
        <Fine>
          <Link to={`/settings/archive?company=${companyId}`} className="underline-offset-2 hover:underline">
            {words}
          </Link>
        </Fine>
      ) : (
        <Fine>{words}</Fine>
      )}
    </div>
  )
}
