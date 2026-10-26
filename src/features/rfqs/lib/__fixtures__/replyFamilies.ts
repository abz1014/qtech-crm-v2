// Supplier replies in the shapes they arrive in, one fixture per family. Every name, number and part number is invented.
// Each reply has OUR RFQ quoted below it (an Outlook "From:/Sent:/To:/Subject:" block, "-----Original Message-----" or ">" lines),
// as it does in the mailbox: the reader must take the offers from the reply and never from the RFQ underneath.

import type { ReplyItemRef } from '../replyParse'

export const FAMILY_ITEMS: ReplyItemRef[] = [
  { id: 'valve', description: 'Ball valve DN50 PN16 stainless steel', model: 'BV-5016-SS', qty: 10, unit: 'nos' },
  { id: 'trans', description: 'Pressure transmitter 4-20mA 0-10 bar', model: 'PT-310', qty: 4, unit: 'nos' },
  { id: 'prox', description: 'Proximity sensor M18 NPN', model: 'IP-M18N', qty: 20, unit: 'nos' },
]

/** Our RFQ as Outlook quotes it under a reply. Its prices, weeks and quantities must never be read as offers. */
export const OUTLOOK_RFQ = `
From: Wasif Khan <wasif@qtech.example>
Sent: Tuesday, October 13, 2026 9:12 AM
To: Lin Hao <sales@supplier.example>
Subject: RFQ QT-RFQ-0412 - valves and sensors

Dear Lin,
Please quote your best price for:
1. Ball valve DN50 PN16 stainless steel, BV-5016-SS - 10 pcs
2. Pressure transmitter 4-20mA 0-10 bar, PT-310 - 4 pcs
3. Proximity sensor M18 NPN, IP-M18N - 20 pcs
Our target is USD 150 each. Payment 100% advance. We need delivery within 2 weeks.
Is ex-stock possible?
Best regards
Wasif`

export const REPLY_TABLE = `Dear Wasif,

Please find our quotation below.

Item\tDescription\tQty\tUnit Price (USD)\tLead time
1\tBall valve DN50 PN16 stainless steel\t10\t185.00\t4 weeks
2\tPressure transmitter 4-20mA 0-10 bar\t4\t96.50\t2 weeks
3\tProximity sensor M18 NPN\t20\t12.40\tex-stock

Quotation No. QT-2026-0457
Date: 14 Oct 2026
Validity: 30 days
Payment: 50% advance, 50% before shipment
Delivery terms: FOB Shanghai

Best regards,
Lin
${OUTLOOK_RFQ}`

export const REPLY_PROSE = `Hi Wasif,

For the DN50 stainless ball valve we can offer USD 1,250/pc, delivery 4 weeks. For the pressure transmitter, EUR 980 each ex-works, 6-8 weeks. Prices valid 30 days. Our quote ref is SQ-8841, dated 14 Oct 2026. Payment terms are 30% advance, balance before shipment.

Regards
Lin
${OUTLOOK_RFQ}`

/** A written price whose separator can be read two ways: the reader must not choose. */
export const REPLY_AMBIGUOUS = `Hi Wasif,

Ball valve DN50 PN16: EUR 1.250 each, 5 weeks.
${OUTLOOK_RFQ}`

export const REPLY_REGRET_ALL = `Dear Wasif,

Thank you for your enquiry. Unfortunately we cannot offer these items: they are obsolete and no longer manufactured.

Best regards,
Lin

-----Original Message-----
From: Wasif Khan <wasif@qtech.example>
Sent: Tuesday, October 13, 2026 9:12 AM
To: Lin Hao <sales@supplier.example>
Subject: RFQ QT-RFQ-0412 - valves and sensors

Please quote your best price for 1. Ball valve DN50 PN16 stainless steel, BV-5016-SS - 10 pcs
2. Pressure transmitter 4-20mA 0-10 bar, PT-310 - 4 pcs
3. Proximity sensor M18 NPN, IP-M18N - 20 pcs. Our target is USD 150 each.`

export const REPLY_REGRET_ONE = `Dear Wasif,

Item 1: USD 185.00 each, 4 weeks.
Item 2: USD 96.50 each, 2 weeks.
The proximity sensor M18 NPN is not available, it is obsolete.

Best regards,
Lin
${OUTLOOK_RFQ}`

export const REPLY_REGRET_TWO = `Dear Wasif,

Items 2 and 3 are no longer manufactured, we cannot offer them.
Item 1: Ball valve BV-5016-SS USD 185.00 each, 4 weeks.

Lin
${OUTLOOK_RFQ}`

export const REPLY_QUESTION = `Hi Wasif,

Thanks for the RFQ. Could you please confirm the thread of the ball valve (BSP or NPT)? Also, which output do you need on item 3, PNP or NPN? We will quote once you reply.

Lin
${OUTLOOK_RFQ}`

/** A question with the engineer's own numbers in it ("is 4 weeks ok", "item 2 size 150"): not offers. */
export const REPLY_QUESTION_NUMBERS = `Hello,

Is 4 weeks delivery ok for item 2? And do you need the DN50 valve in size 150?
Please advise the quantity for item 3.
${OUTLOOK_RFQ}`

export const REPLY_CHINESE = `王先生您好，

报价如下：
1. BV-5016-SS 不锈钢球阀 DN50 PN16 ¥１,２５０/个，交货期15天
2. PT-310 压力变送器 单价：￥６８０元，现货
3. IP-M18N 接近开关 38.5元/个，货期7-10天
报价单号：SQ-2026-0166，报价有效期30天，付款方式：预付50%，款到发货。

李
${OUTLOOK_RFQ}`

export const REPLY_CHINESE_REGRET = `王先生您好，

抱歉，BV-5016-SS 已经停产，无法报价。其余两项报价：
2. PT-310 单价：￥680元，现货
3. IP-M18N 单价：￥38.5元，货期7天
${OUTLOOK_RFQ}`

export const REPLY_SUBSTITUTE = `Dear Wasif,

Item 1: BV-5016-SS USD 185.00 each, 4 weeks.
Item 2: PT-310 is obsolete, the replacement is PT-320, USD 104.00 each, 3 weeks.
Pressure transmitter for item 2 is also available as alternative model XT-77 at USD 99.00, ex-stock.

Lin
${OUTLOOK_RFQ}`

/** The substitute written without the old number: matched to our item by its description. */
export const REPLY_SUBSTITUTE_BY_DESCRIPTION = `Dear Wasif,

Proximity sensor M18 NPN - we suggest SN-M18-N2 instead, USD 14.20 each, 2 weeks.
${OUTLOOK_RFQ}`

/** Gmail style: "On ... wrote:" and ">" lines under the reply. */
export const REPLY_GMAIL = `Hi Wasif,

Ball valve BV-5016-SS: USD 185.00 each, 4 weeks.

On Tue, 13 Oct 2026 at 09:12, Wasif Khan <wasif@qtech.example> wrote:

> Please quote your best price for:
> 1. Ball valve DN50 PN16 stainless steel, BV-5016-SS - 10 pcs
> Our target is USD 150 each.`

/** A quotation PDF's text in the Italian "Preventivo" layout (EU number format, labels in Italian). */
export const QUOTE_ITALIAN = `Meccanica Rossi S.r.l.
Via Garibaldi 12, 25100 Brescia (BS)
P.IVA IT01234567890   Tel. +39 030 1234567

Spett.le Qtech
Preventivo n. 2026/118          Data: 14/10/2026
Vs. richiesta: QT-RFQ-0412

Pos.\tCodice\tDescrizione\tQ.tà\tPrezzo unitario\tImporto\tConsegna
1\tBV-5016-SS\tValvola a sfera DN50 PN16 inox\t10\t1.250,00\t12.500,00\t4 settimane
2\tPT-310\tTrasmettitore di pressione 4-20mA 0-10 bar\t4\t980,00\t3.920,00\t6-8 settimane
3\tIP-M18N\tSensore di prossimità M18 NPN\t20\t38,50\t770,00\tPronta consegna

Imponibile EUR 17.190,00
IVA 22% EUR 3.781,80
Totale EUR 20.971,80

Validità offerta: 30 giorni
Pagamento: Bonifico bancario 30 gg d.f.
Resa: Franco fabbrica Brescia
Banca: Banca Esempio IBAN IT00 X000 0000 0000 0000 0000 000
Cordiali saluti, Lin Hao
${OUTLOOK_RFQ}`

/** A Chinese supplier's price list as copied from a PDF: columns by tab, the currency in the heading. */
export const QUOTE_CHINESE_LIST = `无锡示例自动化有限公司
报价单
报价单号：SQ-2026-0166    日期：2026-10-14
币种：人民币    报价有效期：30天

序号\t品名\t规格型号\t数量\t单位\t单价(元)\t金额(元)\t交货期
1\t不锈钢球阀\tBV-5016-SS\t10\t个\t1250.00\t12500.00\t15天
2\t压力变送器\tPT-310\t4\t个\t680.00\t2720.00\t现货
3\t接近开关\tIP-M18N\t20\t个\t38.50\t770.00\t7-10天

合计(元)\t\t\t\t\t\t15990.00
付款方式：预付50%，款到发货
贸易条款：FOB 上海
${OUTLOOK_RFQ}`

/** Our RFQ quoted under a German Outlook, a Chinese Outlook and a Gmail-in-Chinese header: each cuts the reply off at its own heading. */
export const REPLY_GERMAN_HEADER = `Hallo Wasif,

Kugelhahn BV-5016-SS: USD 185.00 pro Stück, 4 Wochen.

Von: Wasif Khan <wasif@qtech.example>
Gesendet: Dienstag, 13. Oktober 2026 09:12
An: Lin Hao <sales@supplier.example>
Betreff: RFQ QT-RFQ-0412

Bitte um Angebot: 3. Proximity sensor M18 NPN, IP-M18N - 20 pcs. Zielpreis USD 150 each.`

export const REPLY_CHINESE_HEADER = `王先生您好，

IP-M18N 接近开关 单价：￥38.5元，货期7天。

发件人: Wasif Khan <wasif@qtech.example>
发送时间: 2026年10月13日 9:12
收件人: Lin Hao
主题: RFQ QT-RFQ-0412

请报价：IP-M18N 接近开关 20 pcs，目标价 USD 150 each。`

/** A forwarded supplier reply: the header under "Forwarded message" is the supplier's own, so the reply below it is read. */
export const REPLY_FORWARDED = `FYI, see below.

---------- Forwarded message ---------
From: Lin Hao <sales@supplier.example>
Date: Wed, 14 Oct 2026 at 10:02
Subject: RE: RFQ QT-RFQ-0412
To: Wasif Khan <wasif@qtech.example>

Ball valve BV-5016-SS: USD 185.00 each, 4 weeks.`

/** A copy that starts with the reply's own header block (an Outlook "Reply" saved as text). */
export const REPLY_OWN_HEADER_FIRST = `From: Lin Hao <sales@supplier.example>
Sent: Wednesday, October 14, 2026 10:02 AM
To: Wasif Khan <wasif@qtech.example>
Subject: RE: RFQ QT-RFQ-0412 - valves and sensors

Dear Wasif,
Ball valve BV-5016-SS: USD 185.00 each, 4 weeks.
${OUTLOOK_RFQ}`

/** A table copied from a Chinese mail client: the heading wraps ("Unit Price" / "(RMB)"), a description takes two lines, a price has no value. */
export const REPLY_CN_WRAPPED_TABLE = `Dear Aamir,

Good day, thank you for your inquiry. Please find the quotation below.

SL\tProduct Description\tQty (Pcs)\tUnit Price
(RMB)
\tDelivery Time
\tWeight(Unit)\t Origin\t
1\tModel: BV-5016-SS

Brand: Acme
10\t1250\t1-2 weeks
\t2 kg
\t China
2\tModel: PT-310
Brand: Beta
4\t680\t7-10 days
\t0.3 kg\tChina
3\tModel: IP-M18N
Brand: Gamma
20\tNA.\t
If you have any questions, feel free to reach out. Thank you.

Best Regards,
Ms. Li
Sales Department.
No. 2210, Building A3, Example Mansion, Sample District, Changchun City
Tel: +86 431 0000000

原始邮件:
*\t发件人：sales<sales@qtech.example>
*\t发送日期：2026-10-19 09:41:07(China(GMT+08:00))
*\t收件人：
*\t主题：RFQ - valves and sensors
Dear Concern,
Please quote the best price of below items.
1. Ball valve DN50 PN16 stainless steel, BV-5016-SS - 10 pcs
Target USD 150 each, delivery 2 weeks.`

/** The other ways a mail client introduces our quoted RFQ. */
export const REPLY_HEADER_STYLES = [
  `Ball valve BV-5016-SS: USD 185.00 each, 4 weeks.
------------------ Original ------------------
From:  "sales"<sales@qtech.example>;
Date:  Tue, Oct 20, 2026 08:11 PM
Subject:  RFQ
Please quote BV-5016-SS 10 pcs, target USD 150 each, 2 weeks.`,
  `Ball valve BV-5016-SS: USD 185.00 each, 4 weeks.
---- Replied Message ----
From\t<sales@qtech.example>
Date\t10/18/2026 18:14
Subject\tRFQ
Please quote BV-5016-SS 10 pcs, target USD 150 each, 2 weeks.`,
  `Ball valve BV-5016-SS: USD 185.00 each, 4 weeks.
<sales@qtech.example> 于2026年10月19日周一 09:41写道：
Please quote BV-5016-SS 10 pcs, target USD 150 each, 2 weeks.`,
  `Ball valve BV-5016-SS: USD 185.00 each, 4 weeks.
On Fri, Oct 16, 2026 at 11:34 AM <sales@qtech.example> wrote:
\tPlease quote BV-5016-SS 10 pcs, target USD 150 each, 2 weeks.`,
]

/** Two RFQ lines name the same model (a valve and the silencer that fits it): the row's quantity or number tells them apart. */
export const TWIN_ITEMS: ReplyItemRef[] = [
  { id: 'valve', description: 'Solenoid valve 5-port, BV-5016-SS, coil 220 V AC', model: 'BV-5016-SS', qty: 12 },
  { id: 'silencer', description: 'Brass exhaust silencer 1/2 inch, fits valve BV-5016-SS', model: null, qty: 30 },
]
export const REPLY_TWIN_TABLE = `SL\tProduct Description\tQty (Pcs)\tUnit Price\tDelivery Time
1\tModel: BV-5016-SS\t12\tRMB 280\t1-3 weeks
2\tModel: BV-5016-SS\t30\tRMB 35\t1-3 weeks`

/** A row that only points to the next one ("pls see below"), then the part the supplier really offers. */
export const POINTER_ITEMS: ReplyItemRef[] = [
  { id: 'valve', description: 'Ball valve DN50', model: 'BV-5016-SS', qty: 10 },
  { id: 'contactor', description: 'Contactor 3 pole 50A', model: 'LC-D50', qty: 2 },
]
export const REPLY_POINTER_TABLE = `Hello,
Item No.\tPart No.\tQty\tUnit Price\tTotal Price\tLead time
1\tBV-5016-SS\t10\t$185\t$1850\t5-7 days
2\tLC-D50\t2\t\t\tpls see below
\tLC-D55\t2\t$80\t$160\t3-5 days`

export const REPLY_ONLY_ITEM = `Hi,
The ball valve is the only item we can supply. You can order it on our website.
Best regards,
Sam
Sales
Unit 5 Sample Industrial Estate, Exampletown, EX1 2YZ
Tel: 01234 567890`

/** Numbers that are not prices: a standard, a part number, a postcode, an article number written with dots. */
export const REPLY_IDENTIFIERS = `Dear,

ISO 4414 standard cylinder
Part number: 482917
Article 512.3344.601
Unit price $181

Best wishes,
Miss Zhang
Address: No. 71, Lane 8, Example Road, Sample District, Ningbo
Post Code:210044
QQ: 5550001234`

/** A PDF quotation (English, ERP layout): numbered terms, the currency on its own line, the price written twice (unit and total). */
export const QUOTE_PDF_TEXT = `EXAMPLE M&C INC.
Tel: +86-000-0000000
QUOTATION
QUOTATION NO.: QX261017-F
DATE:October 17, 2026
DEAR SIR,
WE HAVE THE PLEASURE TO PRESENT YOU QUOTATION FOR THE FOLLOWING ARTICLES UNDER
TERMS AND CONDITIONS AS BELOW:
1. DATE OF SHIPMENT: IN 5-7 DAYS AFTER RECEIVING THE PAYMENT
2. TERMS OF PAYMENT: 100% PAYMENT PRIOR TO DISPATCH
3.
WARRANTY: 12 MONTHS
4. VALIDITY PEROID OF QUOTATION:\t3\tMONTHS
ITEM NO\tDESC\tQTY.\tUNIT PRICE\tTOTAL\tNOTES
1 Ball valve DN50 /\tstainless steel
Model: BV-5016-SS\t\t\t(EXW)
Input: Flange\tPN16\t1\tUSD\tUSD
Power Supply:\t220 VAC\tNODS\t185.00\t185.00
USD
Total
185.00
THANK YOU FOR YOUR INQUIRY. LOOKING FORWARD TO YOUR REPLY.`
