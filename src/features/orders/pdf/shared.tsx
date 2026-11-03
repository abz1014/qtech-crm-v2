import { Image, Text, View, type TextProps } from '@react-pdf/renderer'
import type { CompanyProfile } from '@/features/settings/companyProfile'
import { s } from '@/features/orders/pdf/styles'

/*
 * The components the service report and the delivery challan share: the letterhead, the footer with "Page n of N" and the signature
 * lines. Styles and helpers are in styles.ts. Only reached through a lazy import of a document's render module.
 */
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

/** Text that may hold line breaks (an address, the notes), one Text per line: react-pdf cannot lay out a raw line break in these faces. */
export function TextLines({ text, style }: { text: string; style?: TextProps['style'] }) {
  return (
    <>
      {text.split(/\r?\n/).map((line, i) => (
        <Text key={i} style={style}>
          {line || ' '}
        </Text>
      ))}
    </>
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
