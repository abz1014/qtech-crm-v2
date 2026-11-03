import { importWithReload } from '@/lib/importWithReload'
import type { ServiceReportDoc } from '@/features/orders/visits/pdf/doc'
import type { CompanyProfile } from '@/features/settings/companyProfile'

/* The only way the app makes a service report PDF: @react-pdf/renderer is behind a dynamic import (the chunk the invoice and quotation share). */
export async function generateServiceReportPdf(doc: ServiceReportDoc, profile: CompanyProfile): Promise<Blob> {
  const { renderServiceReportPdf } = await importWithReload(() => import('@/features/orders/visits/pdf/render'))
  return renderServiceReportPdf(doc, profile)
}
