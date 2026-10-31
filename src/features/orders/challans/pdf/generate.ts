import { importWithReload } from '@/lib/importWithReload'
import type { ChallanDoc } from '@/features/orders/challans/pdf/doc'
import type { CompanyProfile } from '@/features/settings/companyProfile'

/* The only way the app makes a delivery challan PDF: @react-pdf/renderer is behind a dynamic import (the chunk the invoice and quotation share). */
export async function generateChallanPdf(doc: ChallanDoc, profile: CompanyProfile): Promise<Blob> {
  const { renderChallanPdf } = await importWithReload(() => import('@/features/orders/challans/pdf/render'))
  return renderChallanPdf(doc, profile)
}
