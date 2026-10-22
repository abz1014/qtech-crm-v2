import type { Prefetch } from '@/app/routeChunks'
import { seesPrices } from '@/app/session'
import { prefetchRfqParts, rfqHeaderQuery, rfqInquiriesQuery, rfqItemsQuery } from '@/features/rfqs/hooks'

/** The RFQ page's first reads, started by the app before the page is drawn (src/app/routeChunks.ts). */
export const prefetch: Prefetch = ({ client, user, id }) =>
  id
    ? Promise.all([
        client.prefetchQuery(rfqHeaderQuery(id)),
        client.prefetchQuery(rfqItemsQuery(id)),
        client.prefetchQuery(rfqInquiriesQuery(id, seesPrices(user.role))),
        prefetchRfqParts(client, id, seesPrices(user.role)),
      ])
    : Promise.resolve()
