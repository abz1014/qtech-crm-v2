import type { PoPdfData } from '@/features/purchaseOrders/api'
import type { CompanyProfile } from '@/features/settings/companyProfile'
import { importWithReload } from '@/lib/importWithReload'

/**
 * The only way the app makes a supplier PO PDF. @react-pdf/renderer is large, so it is behind a dynamic import: the main bundle does
 * not contain it and the chunk is fetched the first time someone previews, issues or opens a PO.
 */
export async function generatePurchaseOrderPdf(data: PoPdfData, profile: CompanyProfile): Promise<Blob> {
  const { renderPurchaseOrderPdf } = await importWithReload(() => import('@/features/purchaseOrders/pdf/render'))
  return renderPurchaseOrderPdf(data, profile)
}
