import { Image, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { CompanyProfile } from '@/features/settings/companyProfile'

/*
 * The pieces the order's two paper documents share, the service report of a visit and the delivery challan: the letterhead (the
 * wordmark and the company's name, address and contact, as on the invoice and the quotation), a footer with "Page n of N", and the
 * signature lines. Neither document carries a price, so no tax or bank detail is printed (an engineer cannot read those anyway).
 * Only reached through a lazy import of a document's render module, so @react-pdf stays out of the first load. Colours are the
 * design tokens' hex values: a PDF has no CSS variables. No lineHeight on the page: react-pdf drops render-prop text when a page
 * sets one, and the page number needs it.
 */
export const C = {
  ink: '#111113', // --neutral-900
  muted: '#5a5a63', // --neutral-600
  strong: '#d2d2d8', // --neutral-200
  sunken: '#f4f4f6', // --neutral-50
}

export const s = StyleSheet.create({
  page: { fontFamily: 'Geist', fontSize: 10, color: C.ink, paddingTop: 36, paddingBottom: 56, paddingHorizontal: 36 },
  mono: { fontFamily: 'Geist Mono' },
  muted: { color: C.muted },
  strongText: { fontWeight: 600 },
  right: { textAlign: 'right' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 14, borderBottomWidth: 1.5, borderBottomColor: C.ink },
  logo: { width: 150, height: 36.5, objectFit: 'contain' },
  company: { alignItems: 'flex-end', maxWidth: 290 },
  companyName: { fontSize: 10.5, fontWeight: 600 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  h1: { fontSize: 22, fontWeight: 600, letterSpacing: -0.4, marginBottom: 6 },
  meta: { width: 220 },
  metaRow: { flexDirection: 'row', marginBottom: 3 },
  metaLabel: { width: 84, textAlign: 'right', color: C.muted, paddingRight: 10 },
  metaValue: { flex: 1 },
  boxes: { flexDirection: 'row', marginTop: 16, borderTopWidth: 0.75, borderTopColor: C.strong, borderBottomWidth: 0.75, borderBottomColor: C.strong },
  box: { flex: 1, paddingVertical: 8 },
  boxL: { paddingRight: 14, borderRightWidth: 0.75, borderRightColor: C.strong },
  boxR: { paddingLeft: 14 },
  boxLabel: { fontSize: 9.5, fontWeight: 500, color: C.muted, marginBottom: 4 },
  refRow: { flexDirection: 'row', marginBottom: 2.5 },
  refLabel: { width: 78, color: C.muted },
  secTitle: { fontWeight: 600, paddingBottom: 3, marginBottom: 5, borderBottomWidth: 0.75, borderBottomColor: C.strong },
  th: { flexDirection: 'row', backgroundColor: C.sunken, borderTopWidth: 0.75, borderBottomWidth: 0.75, borderColor: C.strong, marginTop: 12, paddingVertical: 5, fontWeight: 600, fontSize: 9.5 },
  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: C.strong, paddingVertical: 6, fontSize: 9.5 },
  cNo: { width: 22, paddingLeft: 3 },
  cDesc: { flex: 1, paddingRight: 6 },
  cQty: { width: 64, textAlign: 'right', paddingRight: 6 },
  cSerial: { width: 150, paddingLeft: 6 },
  signRow: { marginTop: 24, flexDirection: 'row', justifyContent: 'space-between' },
  signBox: { width: 235, borderTopWidth: 0.75, borderTopColor: C.ink, paddingTop: 4, marginTop: 44 },
  foot: { position: 'absolute', left: 36, right: 36, bottom: 20, width: 523, flexDirection: 'row', borderTopWidth: 0.5, borderTopColor: C.strong, paddingTop: 5, fontSize: 9.5, color: C.muted },
})

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "2026-10-30" as "30 Oct 2026". */
export function longDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

/** Quantity as printed: 2, 2.5, 12.125. */
export function qty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(3)))
}

/** The first line of a description is the item, any further lines are its detail (as on the quotation and the invoice). */
export function splitDescription(text: string): { title: string; detail: string | null } {
  const [first, ...rest] = text.split(/\r?\n/)
  const detail = rest.join(' ').trim()
  return { title: first.trim(), detail: detail || null }
}

/** Wordmark on the left, the company on the right. */
export function Letterhead({ profile, logoSrc }: { profile: CompanyProfile; logoSrc: string }) {
  const contactLine = [profile.phone, profile.email, profile.website].filter(Boolean).join('   ')
  return (
    <View style={s.head}>
      <Image src={logoSrc} style={s.logo} />
      <View style={s.company}>
        <Text style={[s.companyName, s.right]}>{profile.legal_name ?? ''}</Text>
        {profile.address ? <Text style={[s.right, s.muted]}>{profile.address}</Text> : null}
        {contactLine ? <Text style={[s.right, s.muted]}>{contactLine}</Text> : null}
      </View>
    </View>
  )
}

/** The footer of every page: what the document is, and "Page n of N". */
export function PageFooter({ left, middle }: { left: string; middle?: string }) {
  return (
    <View style={s.foot} fixed>
      <Text style={[s.mono, { flex: 1 }]}>{left}</Text>
      <Text style={{ flex: 1, textAlign: 'center' }}>{middle ?? ''}</Text>
      <Text style={{ flex: 1, textAlign: 'right' }} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  )
}

/** Two lines to sign on, side by side, each with a name and a date to fill in. */
export function SignatureRow({ left, right }: { left: string; right: string }) {
  return (
    <View style={s.signRow} wrap={false}>
      <View style={s.signBox}>
        <Text style={s.muted}>{left}</Text>
        <Text style={[s.muted, { marginTop: 2 }]}>Name and date</Text>
      </View>
      <View style={s.signBox}>
        <Text style={s.muted}>{right}</Text>
        <Text style={[s.muted, { marginTop: 2 }]}>Name and date</Text>
      </View>
    </View>
  )
}
