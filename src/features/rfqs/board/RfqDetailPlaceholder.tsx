import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { PageFrame } from '@/app/pages/PageFrame'
import { Button } from '@/ui/Button'

/** Stand-in for /rfqs/:id until R07 builds the RFQ page. A row on the board lands here. */
export function RfqDetailPlaceholder() {
  const { id } = useParams()
  return (
    <PageFrame title="RFQ" lede="The RFQ page is being built. Items, supplier replies and questions will open here.">
      <p className="num text-xs text-fg-muted" data-testid="rfq-id">
        {id}
      </p>
      <div>
        <Link to="/rfqs">
          <Button icon={ArrowLeft}>Back to RFQs</Button>
        </Link>
      </div>
    </PageFrame>
  )
}
