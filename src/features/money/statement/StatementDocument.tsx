import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { CompanyProfile } from '@/features/settings/companyProfile'
import { KIND_LABEL, fixed, type Statement } from '@/features/money/statement/model'

/*
 * The statement of account PDF (process audit 7), in the invoice's style: A4, Geist, the same letterhead (company_profile and the
 * wordmark), opening balance, the lines with a running balance, closing balance. PKR is the text "PKR" (Geist has no rupee glyph).
 * Reached only through generate.ts's dynamic import (the PDF chunk). Colours are the design tokens' hex values.
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
  h1: { fontSize: 22, fontWeight: 600, letterSpacing: -0.4, lineHeight: 1.1, marginTop: 16, marginBottom: 6 },
  boxes: { flexDirection: 'row', marginTop: 10, borderTopWidth: 0.75, borderTopColor: C.strong, borderBottomWidth: 0.75, borderBottomColor: C.strong },
  box: { flex: 1, paddingVertical: 8 },
  boxL: { paddingRight: 14, borderRightWidth: 0.75, borderRightColor: C.strong },
  boxR: { paddingLeft: 14 },
  boxLabel: { fontSize: 9.5, fontWeight: 500, color: C.muted, marginBottom: 4 },
  th: { flexDirection: 'row', backgroundColor: C.sunken, borderTopWidth: 0.75, borderBottomWidth: 0.75, borderColor: C.strong, marginTop: 14, paddingVertical: 5, fontWeight: 600, fontSize: 9.5 },
  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: C.strong, paddingVertical: 5, fontSize: 9.5 },
  cDate: { width: 62, paddingLeft: 3 },
  cDoc: { flex: 1, paddingRight: 6 },
  cNum: { width: 78, textAlign: 'right', paddingLeft: 4 },
  cBal: { width: 86, textAlign: 'right', paddingLeft: 4, paddingRight: 3 },
  total: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingVertical: 6, borderTopWidth: 1.5, borderBottomWidth: 0.75, borderTopColor: C.ink, borderBottomColor: C.ink, fontWeight: 600 },
  foot: { position: 'absolute', left: 36, right: 36, bottom: 20, width: 523, flexDirection: 'row', borderTopWidth: 0.5, borderTopColor: C.strong, paddingTop: 5, fontSize: 9.5, color: C.muted },
})

const longDay = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d} ${months[m - 1]} ${y}`
}
const shortDay = (iso: string): string => longDay(iso).replace(/ (\d{4})$/, ' $1')

export function StatementDocument({
  statement,
  customerName,
  profile,
  logoSrc,
  printedOn,
}: {
  statement: Statement
  customerName: string
  profile: CompanyProfile
  logoSrc: string
  printedOn: string
}) {
  const companyName = profile.legal_name ?? ''
  const taxLine = [profile.ntn ? `NTN ${profile.ntn}` : null, profile.strn ? `STRN ${profile.strn}` : null].filter(Boolean).join('   ')
  const contactLine = [profile.phone, profile.email, profile.website].filter(Boolean).join('   ')
  const bank = [profile.bank_account_title, profile.bank_name].filter(Boolean).join(', ')
  return (
    <Document language="en-GB" title={`Statement of account, ${customerName}`} author={companyName} subject={`Statement of account for ${customerName}, ${longDay(statement.from)} to ${longDay(statement.to)}`}>
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

        <Text style={s.h1}>Statement of Account</Text>
        <View style={s.boxes}>
          <View style={[s.box, s.boxL]}>
            <Text style={s.boxLabel}>Customer</Text>
            <Text style={[s.strongText, { fontSize: 10 }]}>{customerName}</Text>
          </View>
          <View style={[s.box, s.boxR]}>
            <Text style={s.boxLabel}>Period</Text>
            <Text style={s.strongText}>
              {longDay(statement.from)} to {longDay(statement.to)}
            </Text>
            <Text style={s.muted}>Printed {longDay(printedOn)} · all amounts in PKR</Text>
          </View>
        </View>

        <View style={s.th} fixed>
          <Text style={s.cDate}>Date</Text>
          <Text style={s.cDoc}>Document</Text>
          <Text style={s.cNum}>Charged</Text>
          <Text style={s.cNum}>Paid / credited</Text>
          <Text style={s.cBal}>Balance</Text>
        </View>
        <View style={[s.tr, { backgroundColor: C.sunken }]} wrap={false}>
          <Text style={s.cDate}>{shortDay(statement.from)}</Text>
          <Text style={[s.cDoc, s.strongText]}>Opening balance</Text>
          <Text style={s.cNum} />
          <Text style={s.cNum} />
          <Text style={[s.cBal, s.mono, s.strongText]}>{fixed(statement.opening)}</Text>
        </View>
        {statement.rows.map((r, i) => (
          <View key={i} style={s.tr} wrap={false}>
            <Text style={s.cDate}>{shortDay(r.on)}</Text>
            <Text style={s.cDoc}>
              {KIND_LABEL[r.kind]}
              {r.ref ? <Text style={s.mono}>{`  ${r.ref}`}</Text> : null}
              {r.orderNumber ? <Text style={s.muted}>{`  · order ${String(r.orderNumber).padStart(4, '0')}`}</Text> : null}
              {r.note ? <Text style={s.muted}>{`  · ${r.note}`}</Text> : null}
            </Text>
            <Text style={[s.cNum, s.mono]}>{r.debit > 0n ? fixed(r.debit) : ''}</Text>
            <Text style={[s.cNum, s.mono]}>{r.credit > 0n ? fixed(r.credit) : ''}</Text>
            <Text style={[s.cBal, s.mono]}>{fixed(r.balance)}</Text>
          </View>
        ))}
        {statement.rows.length === 0 ? (
          <View style={s.tr}>
            <Text style={[s.cDoc, s.muted]}>Nothing happened on this account in this period.</Text>
          </View>
        ) : null}

        <View style={s.total} wrap={false}>
          <Text>Closing balance on {longDay(statement.to)}</Text>
          <Text style={s.mono}>PKR {fixed(statement.closing)}</Text>
        </View>
        <Text style={[s.muted, { marginTop: 6 }]}>
          A positive balance is what {customerName} owes us. Charged {fixed(statement.charged)}, paid or credited {fixed(statement.credited)} in this period.
        </Text>
        {bank ? <Text style={[s.muted, { marginTop: 8 }]}>{`Pay to ${bank}${profile.bank_iban ? `, IBAN ${profile.bank_iban}` : ''}`}</Text> : null}

        <View style={s.foot} fixed>
          <Text style={{ flex: 1 }}>{customerName}</Text>
          <Text style={{ flex: 1, textAlign: 'right' }} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
