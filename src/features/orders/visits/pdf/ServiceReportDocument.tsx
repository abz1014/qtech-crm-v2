import { Document, Page, Text, View } from '@react-pdf/renderer'
import type { CompanyProfile } from '@/features/settings/companyProfile'
import { C, Letterhead, longDay, PageFooter, qty, s, SignatureRow, splitDescription } from '@/features/orders/pdf/shared'
import type { ServiceReportDoc } from '@/features/orders/visits/pdf/doc'

/*
 * The service report PDF of a visit (migration 0130): the letterhead, who the customer and site are, the order, the type and date of the
 * visit, the engineer, the work done, the items on the order (with a blank serial column to write in), and a line each for the customer
 * and the engineer to sign. A4, Geist, the invoice's look. No price anywhere. Reached only through generate.ts's dynamic import.
 */
export function ServiceReportDocument({ doc, profile, logoSrc }: { doc: ServiceReportDoc; profile: CompanyProfile; logoSrc: string }) {
  const when = doc.doneOn ?? doc.visitOn
  return (
    <Document language="en-GB" title={`Service report ${doc.orderRef}`} author={profile.legal_name ?? ''} subject={`${doc.visitType} for ${doc.customer}`}>
      <Page size="A4" style={s.page}>
        <Letterhead profile={profile} logoSrc={logoSrc} />

        <View style={s.titleRow}>
          <View>
            <Text style={s.h1}>Service Report</Text>
            <Text style={s.muted}>{doc.visitType}</Text>
          </View>
          <View style={s.meta}>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Order</Text>
              <Text style={[s.metaValue, s.mono, s.strongText]}>{doc.orderRef}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Visit type</Text>
              <Text style={s.metaValue}>{doc.visitType}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>{doc.doneOn ? 'Done on' : 'Visit date'}</Text>
              <Text style={s.metaValue}>{when ? longDay(when) : ''}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Engineer</Text>
              <Text style={s.metaValue}>{doc.engineer ?? ''}</Text>
            </View>
          </View>
        </View>

        <View style={s.boxes}>
          <View style={[s.box, s.boxL]}>
            <Text style={s.boxLabel}>Customer</Text>
            <Text style={[s.strongText, { fontSize: 10 }]}>{doc.customer}</Text>
            {doc.siteName ? <Text>{doc.siteName}</Text> : null}
            {doc.siteAddress ? <Text>{doc.siteAddress}</Text> : null}
          </View>
          <View style={[s.box, s.boxR]}>
            <Text style={s.boxLabel}>Contact and references</Text>
            {doc.contactName ? (
              <View style={s.refRow}>
                <Text style={s.refLabel}>Contact</Text>
                <Text style={s.strongText}>{[doc.contactName, doc.contactPhone].filter(Boolean).join('  ')}</Text>
              </View>
            ) : null}
            {doc.customerPo ? (
              <View style={s.refRow}>
                <Text style={s.refLabel}>Your PO</Text>
                <Text style={[s.strongText, s.mono]}>{doc.customerPo}</Text>
              </View>
            ) : null}
            <View style={s.refRow}>
              <Text style={s.refLabel}>Our order</Text>
              <Text style={[s.strongText, s.mono]}>{doc.orderRef}</Text>
            </View>
          </View>
        </View>

        <View style={{ marginTop: 14 }}>
          <Text style={s.secTitle}>Work done</Text>
          {doc.workDone ? <Text>{doc.workDone}</Text> : null}
          {/* a few ruled lines to write on when nothing was typed, or to add to what was */}
          {[0, 1, 2].map(i => (
            <View key={i} style={{ height: 18, borderBottomWidth: 0.5, borderBottomColor: C.strong }} />
          ))}
        </View>

        <View style={s.th} fixed>
          <Text style={s.cNo}>#</Text>
          <Text style={s.cDesc}>Items on the order</Text>
          <Text style={s.cQty}>Qty</Text>
          <Text style={s.cSerial}>Serial no.</Text>
        </View>
        {doc.items.length === 0 ? <Text style={[s.muted, { marginTop: 6 }]}>No goods on this order.</Text> : null}
        {doc.items.map(i => {
          const d = splitDescription(i.description)
          return (
            <View key={i.no} style={s.tr} wrap={false}>
              <Text style={[s.cNo, s.muted]}>{i.no}</Text>
              <View style={s.cDesc}>
                <Text style={s.strongText}>{d.title}</Text>
                {d.detail ? <Text style={[s.muted, { fontSize: 9.5 }]}>{d.detail}</Text> : null}
              </View>
              <Text style={[s.cQty, s.mono]}>{i.unit ? `${qty(i.qty)} ${i.unit}` : qty(i.qty)}</Text>
              <Text style={s.cSerial}> </Text>
            </View>
          )
        })}

        <SignatureRow left="Customer signature" right="Engineer signature" />

        <PageFooter left={doc.orderRef} middle={`Service report, ${doc.visitType}`} />
      </Page>
    </Document>
  )
}
