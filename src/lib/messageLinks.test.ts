import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LINK_LIMIT,
  detectPlatform,
  mailtoLink,
  openMessageLink,
  parseEmails,
  parsePhones,
  toAsciiDigits,
  waLink,
  whatsappNumber,
} from '@/lib/messageLinks'

const ch = (code: number) => String.fromCharCode(code)
const AHMED = '923001234567'

afterEach(() => vi.restoreAllMocks())

describe('toAsciiDigits', () => {
  it('turns Urdu, Arabic-Indic, Devanagari and fullwidth digits into 0-9 and leaves the rest', () => {
    expect(toAsciiDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789')
    expect(toAsciiDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789')
    expect(toAsciiDigits('०१२३४५६७८९')).toBe('0123456789')
    expect(toAsciiDigits('０１２３４５６７８９')).toBe('0123456789')
    expect(toAsciiDigits('Cell: ۰۳۰۰-1234567')).toBe('Cell: 0300-1234567')
  })
})

describe('whatsappNumber: one Pakistani mobile, however it is written', () => {
  it.each([
    ['0300 1234567'],
    ['0300-1234567'],
    ['03001234567'],
    ['0300 123 4567'],
    ['0300-123-4567'],
    ['0300 12 34 567'],
    ['(0300) 1234567'],
    ['0300.1234567'],
    ['3001234567'], // a spreadsheet dropped the 0
    ['300-1234567'],
    ['+92 300 1234567'],
    ['+92-300-1234567'],
    ['+923001234567'],
    ['+92 (300) 1234567'],
    ['+92 (0) 300 1234567'],
    ['+92 0300 1234567'],
    ['+ 92 300 1234567'],
    ['(+92) 300 1234567'],
    ['0092 300 1234567'],
    ['00923001234567'],
    ['0092-0300-1234567'],
    ['92 300 1234567'],
    ['923001234567'],
    ['92 0300 1234567'],
    ['tel:+923001234567'],
    ['  0300 1234567  '],
    ['Cell: 0300-1234567'],
    ['0300 1234567.'],
  ])('%s', raw => {
    expect(whatsappNumber(raw)).toEqual({ ok: true, number: AHMED, display: '0300 1234567' })
  })

  it('reads every network prefix (Jazz 030x, Zong 031x, Warid 032x, Ufone 033x, Telenor 034x, SCO 0355)', () => {
    for (const p of ['0300', '0301', '0309', '0310', '0315', '0320', '0321', '0331', '0333', '0340', '0345', '0355']) {
      expect(whatsappNumber(`${p} 7654321`)).toMatchObject({ ok: true, number: `92${p.slice(1)}7654321` })
    }
  })

  it('reads the formats in the app’s own fixtures and e2e data', () => {
    expect(whatsappNumber('+92 300 555 0188')).toEqual({ ok: true, number: '923005550188', display: '0300 5550188' })
    expect(whatsappNumber('+92 300 555 0142')).toMatchObject({ ok: true, number: '923005550142' })
    expect(whatsappNumber('0300 555 0118')).toMatchObject({ ok: true, number: '923005550118' })
    expect(whatsappNumber('+92 300 0000002')).toMatchObject({ ok: true, number: '923000000002' })
    expect(whatsappNumber('0300 1234567')).toMatchObject({ ok: true, number: AHMED })
    expect(whatsappNumber('+92 42 555 0138')).toEqual({ ok: false, reason: 'landline' }) // the fixtures' office line
  })

  it('reads Urdu and Arabic-Indic digits', () => {
    expect(whatsappNumber('۰۳۰۰ ۱۲۳۴۵۶۷')).toMatchObject({ ok: true, number: AHMED })
    expect(whatsappNumber('٠٣٠٠-١٢٣٤٥٦٧')).toMatchObject({ ok: true, number: AHMED })
    expect(whatsappNumber('+۹۲ ۳۰۰ 1234567')).toMatchObject({ ok: true, number: AHMED })
    expect(whatsappNumber('０３００１２３４５６７')).toMatchObject({ ok: true, number: AHMED })
  })

  it('ignores direction marks and odd spaces and dashes that come with a copy from WhatsApp or Word', () => {
    expect(whatsappNumber(`${ch(0x202a)}+92 300 1234567${ch(0x202c)}`)).toMatchObject({ ok: true, number: AHMED })
    expect(whatsappNumber(`${ch(0x200e)}0300${ch(0x200f)}-1234567${ch(0xfeff)}`)).toMatchObject({ ok: true, number: AHMED })
    expect(whatsappNumber(`0300${ch(0xa0)}1234567`)).toMatchObject({ ok: true, number: AHMED })
    expect(whatsappNumber(`0300${ch(0x2013)}1234567`)).toMatchObject({ ok: true, number: AHMED }) // en dash
    expect(whatsappNumber(`0300${ch(0x2212)}123${ch(0x2009)}4567`)).toMatchObject({ ok: true, number: AHMED }) // minus, thin space
    expect(whatsappNumber(`${ch(0xff0b)}92 300 1234567`)).toMatchObject({ ok: true, number: AHMED }) // fullwidth plus
  })
})

describe('whatsappNumber: several numbers in one field', () => {
  it.each([
    ['0300-1234567 / 0321-7654321', '923001234567'],
    ['0300-1234567, 0321-7654321', '923001234567'],
    ['0300-1234567; 0321-7654321', '923001234567'],
    ['0300-1234567 & 0321-7654321', '923001234567'],
    ['0300-1234567 or 0321-7654321', '923001234567'],
    ['0300 1234567 0321 7654321', '923001234567'], // no separator at all
    ['0300-1234567\n0321-7654321', '923001234567'],
    ['042-35761234, 0300-1234567', '923001234567'], // the landline is skipped
    ['Off: 042 3576 1234 Cell: 0333 1234567', '923331234567'],
    ['(042) 35761234 - 0333 1234567', '923331234567'],
    ['042 35761234 ext 22, 0300 1234567', '923001234567'],
    ['021 111 222 333 0300 1234567', '923001234567'], // a UAN number, then a mobile
    ['+92 51 2345678 / +92 345 1234567', '923451234567'],
  ])('%s', (raw, number) => {
    expect(whatsappNumber(raw)).toMatchObject({ ok: true, number })
  })

  it('prefers the number written next to "WhatsApp" (before or after it), else the first mobile', () => {
    expect(whatsappNumber('0300 1234567, WhatsApp: 0321 7654321')).toMatchObject({ number: '923217654321' })
    expect(whatsappNumber('0300 1234567 (office), WhatsApp 0321 7654321')).toMatchObject({ number: '923217654321' })
    expect(whatsappNumber('Cell 0300 1234567 WhatsApp 0321 7654321')).toMatchObject({ number: '923217654321' })
    expect(whatsappNumber('0300 1234567 / 0321 7654321 (WA)')).toMatchObject({ number: '923217654321' })
    expect(whatsappNumber('0300 1234567, WA 0321 7654321')).toMatchObject({ number: '923217654321' })
    expect(whatsappNumber('0300 1234567 (Whatsapp), 0321 7654321')).toMatchObject({ number: '923001234567' })
    expect(whatsappNumber('0321 7654321 (whatsapp only)')).toMatchObject({ number: '923217654321' })
    expect(whatsappNumber('Whats app: 0321 7654321 / call 0300 1234567')).toMatchObject({ number: '923217654321' })
    // "wa" inside a word is not a label
    expect(whatsappNumber('Kawa 0300 1234567, Rawalpindi 0321 7654321')).toMatchObject({ number: '923001234567' })
  })

  it('a landline labelled WhatsApp is still not used', () => {
    expect(whatsappNumber('WhatsApp: 042 35761234, 0300 1234567')).toMatchObject({ number: '923001234567' })
  })

  it('lists every number with its kind, in the order written', () => {
    expect(parsePhones('Off: 042-35761234 / WhatsApp: 0321 7654321, +971 50 123 4567')).toEqual([
      { kind: 'landline', digits: '924235761234', display: '04235761234', labelledWhatsApp: false },
      { kind: 'mobile', digits: '923217654321', display: '0321 7654321', labelledWhatsApp: true },
      { kind: 'international', digits: '971501234567', display: '+971501234567', labelledWhatsApp: false },
    ])
    expect(parsePhones('0300 1234567 0321 7654321').map(n => n.digits)).toEqual(['923001234567', '923217654321'])
    expect(parsePhones('021 111 222 333').map(n => [n.kind, n.digits])).toEqual([['landline', '9221111222333']])
    expect(parsePhones(null)).toEqual([])
    expect(parsePhones('')).toEqual([])
  })
})

describe('whatsappNumber: numbers abroad', () => {
  it.each([
    ['+971 50 123 4567', '971501234567'],
    ['00971 50 1234567', '971501234567'],
    ['+86 138 0013 8000', '8613800138000'],
    ['+1 (555) 123-4567', '15551234567'],
    ['+44 20 7946 0958', '442079460958'],
    ['+49-30-1234567', '49301234567'],
  ])('%s', (raw, number) => {
    expect(whatsappNumber(raw)).toEqual({ ok: true, number, display: `+${number}` })
  })

  it('a Pakistani mobile comes before a number abroad, wherever it is written', () => {
    expect(whatsappNumber('+971 50 123 4567 / 0300 1234567')).toMatchObject({ number: AHMED })
  })

  it('a number abroad stops at the next + or at 15 digits', () => {
    expect(parsePhones('+971 50 123 4567 +86 138 0013 8000').map(n => n.digits)).toEqual(['971501234567', '8613800138000'])
    expect(parsePhones('+971 50 123 4567 0300 1234567').map(n => n.digits)).toEqual(['971501234567', AHMED])
  })

  it('too short to be anything abroad', () => {
    expect(whatsappNumber('+971 1234')).toEqual({ ok: false, reason: 'unreadable' })
    expect(whatsappNumber('+971 12345')).toMatchObject({ ok: true, number: '97112345' }) // 8 digits is the shortest opened
  })
})

describe('whatsappNumber: when there is no number to open', () => {
  it.each([[null], [undefined], [''], ['   '], ['N/A'], ['-'], ['same as above'], [`${ch(0x200e)} ${ch(0xa0)}`]])('nothing saved: %j', raw => {
    expect(whatsappNumber(raw)).toEqual({ ok: false, reason: 'none' })
  })

  it.each([['042-35761234'], ['(042) 3576 1234'], ['+92 42 35761234'], ['021 111 222 333'], ['(051) 2345678'], ['0244 123456'], ['Off: 042 35761234, Fax: 042 35761235']])(
    'only a landline: %s',
    raw => {
      expect(whatsappNumber(raw)).toEqual({ ok: false, reason: 'landline' })
    },
  )

  it.each([['12345'], ['0300 12345'], ['+92 300 12345'], ['+92'], ['0300 1234567 8901'], ['0300-1234567-89'], ['1234 5678 9012 3456 7890']])(
    'not a number we can read: %s',
    raw => {
      expect(whatsappNumber(raw)).toEqual({ ok: false, reason: 'unreadable' })
    },
  )

  it('a list number or a broken second number after a good one is not a typo in it', () => {
    expect(whatsappNumber('1. 0300 1234567 2. 0321 7654321')).toMatchObject({ ok: true, number: AHMED })
    expect(whatsappNumber('0300 1234567 0321 765432')).toMatchObject({ ok: true, number: AHMED })
    expect(whatsappNumber('0300 1234567 (2)')).toMatchObject({ ok: true, number: AHMED })
  })
})

describe('waLink', () => {
  const text = 'Assalam o Alaikum Ahmed,\nRFQ-0177 & PO #12: 50% done? 100+ items = "ok"'

  it('wa.me with the full international number and the text encoded (spaces %20, never +)', () => {
    const link = waLink('0300-1234567', text, { maxLength: 5000 })
    expect(link).toEqual({ url: `https://wa.me/${AHMED}?text=${encodeURIComponent(text)}`, filled: true })
    expect(link!.url).toContain('%0A')
    expect(link!.url).toContain('%26')
    expect(link!.url).toContain('%23')
    expect(link!.url).toContain('%25')
    expect(link!.url).toContain('%2B')
    expect(link!.url).toContain('%3F')
    expect(link!.url).not.toMatch(/text=.*\+/)
    expect(new URL(link!.url).searchParams.get('text')).toBe(text)
  })

  it('Windows line ends become one new line each', () => {
    const link = waLink(AHMED, 'one\r\ntwo\rthree', { maxLength: 5000 })
    expect(link!.url).toBe(`https://wa.me/${AHMED}?text=one%0Atwo%0Athree`)
  })

  it('Urdu and emoji survive the round trip', () => {
    const urdu = 'شکریہ، آپ کا آرڈر تیار ہے 🙏'
    const link = waLink(AHMED, urdu, { maxLength: 5000 })
    expect(link!.url).toContain('%D8%B4')
    expect(new URL(link!.url).searchParams.get('text')).toBe(urdu)
  })

  it('half an emoji (a lone surrogate) does not throw: it becomes the replacement character', () => {
    const cut = `Price ${ch(0xd83d)} and ${ch(0xde4f)}`
    const link = waLink(AHMED, cut, { maxLength: 5000 })
    expect(link!.url).toContain('%EF%BF%BD')
    expect(() => decodeURIComponent(link!.url)).not.toThrow()
  })

  it('an empty message opens the chat with nothing filled in', () => {
    expect(waLink(AHMED, '  \n ')).toEqual({ url: `https://wa.me/${AHMED}`, filled: true })
  })

  it('no number WhatsApp can open: null', () => {
    expect(waLink(null, text)).toBeNull()
    expect(waLink('042-35761234', text)).toBeNull()
    expect(waLink('n/a', text)).toBeNull()
  })

  it('too long for a link: the empty chat, filled false (the caller copies the text)', () => {
    const exact = `https://wa.me/${AHMED}?text=${encodeURIComponent(text)}`.length
    expect(waLink(AHMED, text, { maxLength: exact })).toMatchObject({ filled: true })
    expect(waLink(AHMED, text, { maxLength: exact - 1 })).toEqual({ url: `https://wa.me/${AHMED}`, filled: false })
  })

  it('the default limit is 2000 on a desktop and 4000 on a phone', () => {
    const long = 'x'.repeat(2500)
    expect(waLink(AHMED, long)).toMatchObject({ filled: false }) // jsdom is a desktop
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36')
    expect(waLink(AHMED, long)).toMatchObject({ filled: true })
    expect(waLink(AHMED, 'x'.repeat(4500))).toMatchObject({ filled: false })
  })
})

describe('mailtoLink', () => {
  it('to, subject and body, each encoded; new lines as %0D%0A', () => {
    const link = mailtoLink({ to: 'ahmed@example.invalid', subject: 'RFQ-0177: flange & gasket?', body: 'Dear Ahmed,\nPlease confirm.\r\nRegards' }, { maxLength: 5000 })
    expect(link).toEqual({
      url: 'mailto:ahmed@example.invalid?subject=RFQ-0177%3A%20flange%20%26%20gasket%3F&body=Dear%20Ahmed%2C%0D%0APlease%20confirm.%0D%0ARegards',
      filled: true,
    })
  })

  it('several addresses in one field all go in To, once each; a name around an address is dropped', () => {
    expect(mailtoLink({ to: 'a@example.invalid; b@example.invalid, A@example.invalid' })!.url).toBe('mailto:a@example.invalid,b@example.invalid')
    expect(mailtoLink({ to: 'Ahmed Raza <ahmed@example.invalid>' })!.url).toBe('mailto:ahmed@example.invalid')
    expect(mailtoLink({ to: ['a@example.invalid', null, 'mailto:b@example.invalid'] })!.url).toBe('mailto:a@example.invalid,b@example.invalid')
  })

  it('cc after the recipients, without anyone already in To', () => {
    const link = mailtoLink({ to: 'a@example.invalid', cc: 'A@example.invalid, accounts@example.invalid', subject: 'Hi' })
    expect(link!.url).toBe('mailto:a@example.invalid?cc=accounts@example.invalid&subject=Hi')
  })

  it('an address with + or % is encoded, the @ stays', () => {
    expect(mailtoLink({ to: 'sales+rfq@example.invalid' })!.url).toBe('mailto:sales%2Brfq@example.invalid')
  })

  it('a subject is one line; an empty subject or body is left out', () => {
    expect(mailtoLink({ to: 'a@example.invalid', subject: 'Line one\nline two', body: '' })!.url).toBe('mailto:a@example.invalid?subject=Line%20one%20line%20two')
    expect(mailtoLink({ to: 'a@example.invalid', subject: '  ', body: 'Hi' })!.url).toBe('mailto:a@example.invalid?body=Hi')
  })

  it('no address: null', () => {
    expect(mailtoLink({ to: null, body: 'x' })).toBeNull()
    expect(mailtoLink({ to: '  ' })).toBeNull()
    expect(mailtoLink({ to: 'not an email' })).toBeNull()
    expect(mailtoLink({ to: [] })).toBeNull()
  })

  it('too long: recipients and subject only, filled false', () => {
    const draft = { to: 'a@example.invalid', cc: 'b@example.invalid', subject: 'RFQ-0177', body: 'x'.repeat(3000) }
    expect(mailtoLink(draft)).toEqual({ url: 'mailto:a@example.invalid?cc=b@example.invalid&subject=RFQ-0177', filled: false })
    expect(mailtoLink(draft, { maxLength: 4000 })).toMatchObject({ filled: true })
  })

  it('Urdu survives the round trip', () => {
    const body = 'محترم احمد صاحب\nشکریہ'
    const link = mailtoLink({ to: 'a@example.invalid', body }, { maxLength: 5000 })
    expect(decodeURIComponent(link!.url.split('body=')[1])).toBe(body.replace('\n', '\r\n'))
  })
})

describe('parseEmails', () => {
  it('finds each address once, in order, in any separator', () => {
    expect(parseEmails('a@example.invalid / b@example.invalid | c@example.invalid')).toEqual(['a@example.invalid', 'b@example.invalid', 'c@example.invalid'])
    expect(parseEmails('Sales: sales@example.invalid.')).toEqual(['sales@example.invalid'])
    expect(parseEmails(['x@example.invalid', 'X@EXAMPLE.INVALID'])).toEqual(['x@example.invalid'])
    expect(parseEmails('no address here')).toEqual([])
    expect(parseEmails(null)).toEqual([])
  })
})

describe('detectPlatform', () => {
  it.each([
    ['Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36', 0, 'android'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1', 5, 'ios'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15', 5, 'ios'], // iPadOS
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15', 0, 'desktop'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36', 0, 'desktop'],
  ] as const)('%s', (userAgent, maxTouchPoints, platform) => {
    expect(detectPlatform({ userAgent, maxTouchPoints })).toBe(platform)
  })

  it('no navigator (a server render) is a desktop; limits are as documented', () => {
    expect(detectPlatform(undefined)).toBe('desktop')
    expect(LINK_LIMIT).toEqual({ desktop: 2000, android: 4000, ios: 4000 })
  })
})

describe('openMessageLink', () => {
  it('clicks a real link: wa.me in a new tab without an opener, mailto: in place; the link is removed after', () => {
    const clicked: { href: string; target: string; rel: string }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, target: this.target, rel: this.rel })
      expect(this.isConnected).toBe(true)
    })
    openMessageLink(`https://wa.me/${AHMED}?text=Hi`)
    openMessageLink('mailto:a@example.invalid?subject=Hi')
    expect(clicked).toEqual([
      { href: `https://wa.me/${AHMED}?text=Hi`, target: '_blank', rel: 'noopener noreferrer' },
      { href: 'mailto:a@example.invalid?subject=Hi', target: '', rel: '' },
    ])
    expect(document.querySelectorAll('a').length).toBe(0)
  })
})
