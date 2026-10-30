import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { formatPaisa } from '@/lib/money'
import type { CompanyProfile } from '@/features/settings/companyProfile'
import type { CreditNoteDoc } from '@/features/money/invoices/pdf/creditNoteDoc'
import { signatureLines } from '@/features/money/invoices/pdf/model'

/*
 * The credit note PDF (0112): the sales-tax invoice's look (InvoiceDocument.tsx: A4, Geist, the quotation's letterhead, the same
 * colours), one table row for what is credited, and the totals as amounts credited. The stored figures are printed as they are.
 * Imported only through generate.ts's dynamic import, like the invoice.
 */
const C = { ink: '#111113', muted: '#5a5a63', strong: '#d2d2d8', sunken: '#f4f4f6' }

const s = StyleSheet.create({
  page: { fontFamily: 'Geist', fontSize: 10, color: C.ink, paddingTop: 36, paddingBottom: 44, paddingHorizontal: 36 },
  mono: { fontFamily: 'Geist Mono' },
  muted: { color: C.muted },
  strongText: { fontWeight: 600 },
  right: { textAlign: 'right' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 14, borderBottomWidth: 1.5, borderBottomColor: C.ink },
  logo: { width: 150, height: 36.5, objectFit: 'contain' },
  company: { alignItems: 'flex-end', maxWidth: 290 },
  companyName: { fontSize: 10.5, fontWeight: 600 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  h1: { fontSize: 22, fontWeight: 600, letterSpacing: -0.4, lineHeight: 1.1, marginBottom: 6 },
  meta: { width: 230 },
  metaRow: { flexDirection: 'row', marginBottom: 3 },
  metaLabel: { width: 96, textAlign: 'right', color: C.muted, paddingRight: 10 },
  metaValue: { flex: 1 },
  boxes: { flexDirection: 'row', marginTop: 16, borderTopWidth: 0.75, borderTopColor: C.strong, borderBottomWidth: 0.75, borderBottomColor: C.strong },
  box: { flex: 1, paddingVertical: 8 },
  boxL: { paddingRight: 14, borderRightWidth: 0.75, borderRightColor: C.strong },
  boxR: { paddingLeft: 14 },
  boxLabel: { fontSize: 9.5, fontWeight: 500, color: C.muted, marginBottom: 4 },
  refRow: { flexDirection: 'row', marginBottom: 2.5 },
  refLabel: { width: 78, color: C.muted },
  th: { flexDirection: 'row', backgroundColor: C.sunken, borderTopWidth: 0.75, borderBottomWidth: 0.75, borderColor: C.strong, marginTop: 12, paddingVertical: 5, fontWeight: 600, fontSize: 9.5 },
  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: C.strong, paddingVertical: 6, fontSize: 9.5 },
  cDesc: { flex: 1, paddingLeft: 3, paddingRight: 6 },
  cNet: { width: 90, textAlign: 'right', paddingLeft: 4 },
  cTax: { width: 80, textAlign: 'right', paddingLeft: 4 },
  cGross: { width: 90, textAlign: 'right', paddingLeft: 4, paddingRight: 3 },
  totals: { alignSelf: 'flex-end', width: 320, marginTop: 12 },
  totRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  gross: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingVertical: 6, borderTopWidth: 1.5, borderBottomWidth: 0.75, borderTopColor: C.ink, borderBottomColor: C.ink },
  sign: { marginTop: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  note: { width: 250, color: C.muted, fontSize: 9.5 },
  signBox: { width: 230, borderTopWidth: 0.75, borderTopColor: C.ink, paddingTop: 4, marginTop: 40 },
  foot: { position: 'absolute', left: 36, right: 36, bottom: 20, width: 523, flexDirection: 'row', borderTopWidth: 0.5, borderTopColor: C.strong, paddingTop: 5, fontSize: 9.5, color: C.muted },
})

const money = (paisa: bigint) => formatPaisa(paisa, 'always')
const longDay = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d} ${months[m - 1]} ${y}`
}

export function CreditNoteDocument({ doc, profile, logoSrc }: { doc: CreditNoteDoc; profile: CompanyProfile; logoSrc: string }) {
  const companyName = profile.legal_name ?? ''
  const taxLine = [profile.ntn ? `NTN ${profile.ntn}` : null, profile.strn ? `STRN ${profile.strn}` : null].filter(Boolean).join('   ')
  const contactLine = [profile.phone, profile.email, profile.website].filter(Boolean).join('   ')
  return (
    <Document language="en-GB" title={`Credit note ${doc.number}`} author={companyName} subject={`Credit note ${doc.number} against invoice ${doc.invoiceNumber} for ${doc.buyer.name}`}>
      <Page size="A4" style={s.page}>
        <View style={s.head}>
          <Image src={logoSrc} style={s.logo} />
          <View style={s.company}>
            <Text style={[s.companyName, s.right]}>{companyName}</Text>
            {profile.address ? <Text style={[s.right, s.muted]}>{profile.address}</Text> : null}
            {taxLine ? <Text style={[s.right, s.mono]}>{taxLine}</Text> : null}
            {contactLine ? <Text style={[s.right, s.muted]}>{contactLine}</Text> : null}
          </View>
        </View>

        <View style={s.titleRow}>
          <View>
            <Text style={s.h1}>Credit Note</Text>
            <Text style={s.muted}>Sales tax credit note</Text>
          </View>
          <View style={s.meta}>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Credit note no.</Text>
              <Text style={[s.metaValue, s.mono, s.strongText]}>{doc.number}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Date</Text>
              <Text style={s.metaValue}>{longDay(doc.issuedOn)}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Against invoice</Text>
              <Text style={[s.metaValue, s.mono, s.strongText]}>{doc.invoiceNumber}</Text>
            </View>
            {doc.invoiceDate ? (
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>Invoice date</Text>
                <Text style={s.metaValue}>{longDay(doc.invoiceDate)}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={s.boxes}>
          <View style={[s.box, s.boxL]}>
            <Text style={s.boxLabel}>Buyer</Text>
            <Text style={[s.strongText, { fontSize: 10 }]}>{doc.buyer.name}</Text>
            <Text>{doc.buyer.address}</Text>
            <View style={[s.refRow, { marginTop: 4 }]}>
              <Text style={s.refLabel}>NTN / CNIC</Text>
              <Text style={s.mono}>{doc.buyer.ntn ?? ''}</Text>
            </View>
            <View style={s.refRow}>
              <Text style={s.refLabel}>STRN</Text>
              {doc.buyer.registered && doc.buyer.strn ? <Text style={s.mono}>{doc.buyer.strn}</Text> : <Text>Not registered for sales tax</Text>}
            </View>
          </View>
          <View style={[s.box, s.boxR]}>
            <Text style={s.boxLabel}>References</Text>
            {doc.customerPo ? (
              <View style={s.refRow}>
                <Text style={s.refLabel}>Your PO</Text>
                <Text style={[s.strongText, s.mono]}>{doc.customerPo}</Text>
              </View>
            ) : null}
            {doc.orderRef ? (
              <View style={s.refRow}>
                <Text style={s.refLabel}>Our order</Text>
                <Text style={[s.strongText, s.mono]}>{doc.orderRef}</Text>
              </View>
            ) : null}
            <View style={s.refRow}>
              <Text style={s.refLabel}>Currency</Text>
              <Text style={s.strongText}>Pakistani rupees (PKR)</Text>
            </View>
          </View>
        </View>

        <View style={s.th}>
          <Text style={s.cDesc}>Description</Text>
          <Text style={s.cNet}>Credited excl. tax</Text>
          <Text style={s.cTax}>Sales tax</Text>
          <Text style={s.cGross}>Credited incl. tax</Text>
        </View>
        <View style={s.tr} wrap={false}>
          <View style={s.cDesc}>
            <Text style={s.strongText}>Credit against invoice {doc.invoiceNumber}</Text>
            <Text style={[s.muted, { fontSize: 9.5 }]}>{doc.reason}</Text>
          </View>
          <Text style={[s.cNet, s.mono]}>{money(doc.net)}</Text>
          <Text style={[s.cTax, s.mono]}>{money(doc.gst)}</Text>
          <Text style={[s.cGross, s.mono]}>{money(doc.gross)}</Text>
        </View>

        <View wrap={false}>
          <View style={s.totals}>
            <View style={s.totRow}>
              <Text>Value credited excluding sales tax</Text>
              <Text style={s.mono}>PKR {money(doc.net)}</Text>
            </View>
            <View style={s.totRow}>
              <Text>Sales tax credited</Text>
              <Text style={s.mono}>PKR {money(doc.gst)}</Text>
            </View>
            <View style={s.gross}>
              <Text style={s.strongText}>Total credited</Text>
              <Text style={[s.mono, { fontWeight: 500, fontSize: 11 }]}>PKR {money(doc.gross)}</Text>
            </View>
            <Text style={[s.right, s.muted, { fontSize: 9.5, marginTop: 5 }]}>{doc.words}</Text>
          </View>
          <View style={s.sign}>
            <Text style={s.note}>
              This credit note reduces the sales tax invoice <Text style={s.mono}>{doc.invoiceNumber}</Text> by the amounts above. Please quote <Text style={s.mono}>{doc.number}</Text> in your accounts.
            </Text>
            <View style={s.signBox}>
              <Text style={s.muted}>{signatureLines(companyName)[0]}</Text>
              <Text style={[s.muted, { marginTop: 2 }]}>{signatureLines(companyName)[1]}</Text>
            </View>
          </View>
        </View>

        <View style={s.foot} fixed>
          <Text style={[s.mono, { flex: 1 }]}>{doc.number}</Text>
          <Text style={{ flex: 1, textAlign: 'center' }}>Credit note</Text>
          <Text style={{ flex: 1, textAlign: 'right' }} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
