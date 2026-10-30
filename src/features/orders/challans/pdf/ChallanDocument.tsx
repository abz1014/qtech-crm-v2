import { Document, Page, Text, View } from '@react-pdf/renderer'
import type { CompanyProfile } from '@/features/settings/companyProfile'
import { Letterhead, longDay, PageFooter, qty, s, SignatureRow, splitDescription } from '@/features/orders/pdf/shared'
import type { ChallanDoc } from '@/features/orders/challans/pdf/doc'

/*
 * The delivery challan PDF (migration 0131): the letterhead, the challan number and date, who and where the goods go, the lines with their
 * quantities, and a line for the person who received them to sign. A4, Geist, the invoice's look. No price, no tax, no bank detail.
 * Reached only through generate.ts's dynamic import.
 */
export function ChallanDocument({ doc, profile, logoSrc }: { doc: ChallanDoc; profile: CompanyProfile; logoSrc: string }) {
  return (
    <Document language="en-GB" title={`Delivery challan ${doc.number}`} author={profile.legal_name ?? ''} subject={`Delivery challan ${doc.number} for ${doc.customer}`}>
      <Page size="A4" style={s.page}>
        <Letterhead profile={profile} logoSrc={logoSrc} />

        <View style={s.titleRow}>
          <View>
            <Text style={s.h1}>Delivery Challan</Text>
          </View>
          <View style={s.meta}>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Challan no.</Text>
              <Text style={[s.metaValue, s.mono, s.strongText]}>{doc.number}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Date</Text>
              <Text style={s.metaValue}>{longDay(doc.issuedOn)}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Our order</Text>
              <Text style={[s.metaValue, s.mono]}>{doc.orderRef}</Text>
            </View>
          </View>
        </View>

        <View style={s.boxes}>
          <View style={[s.box, s.boxL]}>
            <Text style={s.boxLabel}>Deliver to</Text>
            <Text style={[s.strongText, { fontSize: 10 }]}>{doc.customer}</Text>
            {doc.deliverTo ? <Text>{doc.deliverTo}</Text> : null}
          </View>
          <View style={[s.box, s.boxR]}>
            <Text style={s.boxLabel}>References</Text>
            {doc.customerPo ? (
              <View style={s.refRow}>
                <Text style={s.refLabel}>Your PO</Text>
                <Text style={[s.strongText, s.mono]}>{doc.customerPo}</Text>
              </View>
            ) : null}
            {doc.contactName ? (
              <View style={s.refRow}>
                <Text style={s.refLabel}>Contact</Text>
                <Text style={s.strongText}>{[doc.contactName, doc.contactPhone].filter(Boolean).join('  ')}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={s.th} fixed>
          <Text style={s.cNo}>#</Text>
          <Text style={s.cDesc}>Description</Text>
          <Text style={s.cQty}>Qty</Text>
        </View>
        {doc.lines.map(l => {
          const d = splitDescription(l.description)
          return (
            <View key={l.no} style={s.tr} wrap={false}>
              <Text style={[s.cNo, s.muted]}>{l.no}</Text>
              <View style={s.cDesc}>
                <Text style={s.strongText}>{d.title}</Text>
                {d.detail ? <Text style={[s.muted, { fontSize: 9.5 }]}>{d.detail}</Text> : null}
              </View>
              <Text style={[s.cQty, s.mono]}>{l.unit ? `${qty(l.qty)} ${l.unit}` : qty(l.qty)}</Text>
            </View>
          )
        })}

        {doc.notes ? (
          <View style={{ marginTop: 12 }} wrap={false}>
            <Text style={s.secTitle}>Notes</Text>
            <Text>{doc.notes}</Text>
          </View>
        ) : null}

        <View wrap={false}>
          <Text style={[s.muted, { marginTop: 14 }]}>Received the goods listed above in good order and condition.</Text>
          <SignatureRow left="Received by (customer)" right="Delivered by" />
        </View>

        <PageFooter left={doc.number} middle="Delivery challan" />
      </Page>
    </Document>
  )
}
