import { pdf } from '@react-pdf/renderer'
import { registerFonts } from '@/features/quotations/pdf/fonts'
import { PurchaseOrderDocument } from '@/features/purchaseOrders/pdf/PurchaseOrderDocument'
import type { PoPdfData } from '@/features/purchaseOrders/api'
import type { CompanyProfile } from '@/features/settings/companyProfile'

/** The lazy chunk's entry for the supplier PO PDF; the fonts and the wordmark are the quotation's (R19 infrastructure). */
export async function renderPurchaseOrderPdf(data: PoPdfData, profile: CompanyProfile): Promise<Blob> {
  registerFonts()
  const logoSrc = new URL(`${import.meta.env.BASE_URL}brand/logo-wordmark.png`, window.location.origin).href
  return pdf(<PurchaseOrderDocument data={data} profile={profile} logoSrc={logoSrc} />).toBlob()
}
