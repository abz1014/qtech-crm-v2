# Adopting Open in WhatsApp / Open in email (round 2)

The building blocks are on main (feat/open-message):
- `src/lib/messageLinks.ts`: waLink, mailtoLink, whatsappNumber, parsePhones, openMessageLink.
- `src/ui/MessageActions.tsx`, with demo states in MessageActions.demo.tsx.

Rules (DECISIONS 2026-10-20):
- Opening a link never marks anything as chased; a separate "Mark …" tap with Undo does.
- Copy stays as the fallback.
- A message too long for a link is copied first, then an empty chat or email opens, and a toast says to paste it.

## Same pattern at every site
1. Use `const [channel, setChannel] = useChannelPreference()` and pass `channel` / `onChannelChange`. Two separate hook calls don't see each other's changes.
2. Split `copyAndMark` into `mark()` (stamp + Undo toast, unchanged) and `copyAndMark = copy, then mark()`. Copy keeps its label and test selectors via `copy={{ label, onCopy: copyAndMark, busy, busyLabel }}`.
3. `onOpen={() => setOpened(true)}` and `variant={opened ? 'secondary' : 'primary'}`. After opening, show a primary "Mark chased" / "Mark reminded" / "Mark asked" button.

## Shared data change
Widen `Draft.contact` in `today/chaseDraft.ts:23` from `{name, phone}` to `Recipient | null` (ChaseParts.tsx:40) and pass the email through:
- customer: `header.data?.contact` (rfqs/api.ts:240), input type at chaseDraft.ts:39;
- supplier: chaseDraft.ts:102, add `inquiry.contactEmail`;
- payment: `data.contact` already has email (today/api.ts:530);
- goods: `getLegDraft` selects `'name, phone, email'` (today/api.ts:500); add `email` to `LegDraftData.contact` (:484) and the mapping (:505).

## Sites
1. **today/ContextPane.tsx**: copyAndMark :165, channel :101, buttons :392 (phone: `size="touch" fill`) and :399. `opened` is keyed by `item.key`; `markOnly` = lines 175–211 without the copy step.
2. **money/payments/ReminderPanel.tsx**: copyAndMark :201, channel :97, button :287. Recipient `draftQ.data.contact`. Add "Mark reminded"; the done strip :276 reads "Reminder N recorded today." when marked this way.
3. **orders/GoodsChaseDialog.tsx**: copyAndMark :65, channel :33, footer :123. Recipient `draft.contact` (needs the email change). The dialog stays open after opening; `mark()` closes it.
4. **rfqs/ClarificationsPanel.tsx**:
   - (a) ChaseGroup :399: the parent uses the hook and passes `onVariant`/`onMark`; recipient `rfq.contact`; add "Mark asked".
   - (b) Relay banner :187: compute `relayText` during render; recipient from InquiryRow contact fields (rfqs/api.ts:411–414); add "Mark as told".
5. **rfqs/SuppliersAsked.tsx** ChaseCard :272 (channel :192, recipient :201): `useSupplierChase` (:106/:117) returns both variants. ChaseNow (:181) stays copy-and-mark.
6. **Ask suppliers** (useAskSuppliers.ts:52; SuppliersToAskCard :111, FloatDialog :154, FloatElsewhere via useChooseSuppliers → RfqDetailScreen :181/:216): one message for N suppliers, so keep "Copy message for N suppliers". `ask` resolves `{ ok, text, supplierIds }`, and RfqDetailScreen then shows a "Send it to each supplier" card with `<MessageActions size="sm" … copy={false} />` per inquiry. Nothing to mark.
7. **rfqs/IntakeScreen.tsx** floated step (FloatedPanel, IntakeParts.tsx:259; IntakeScreen :695):
   - add a per-supplier list via `useRfqInquiries(saved?.id)`;
   - build the texts with `fillRfqRef(edit.text[v] ?? generateEnquiryDraft({…, variant: v}).body, rfqRef(saved.number))`;
   - don't pass `copiedText`, since the email copy starts with "Subject:";
   - the channel switch at IntakeParts.tsx:192 uses the hook; `floatItem` stays copy-only.
8. **orders/OrderHeaderBlock.tsx** cancel dialog :357–366: `listSentPos` (purchaseOrders/api.ts:281) loads the first contact per supplier. Use `<MessageActions size="sm" to={po.contact ?? { name: po.supplierName }} text={cancellationMessage(po, COMPANY_NAME)} email={{ subject: \`${po.ref} cancelled\` }} copy={{ label: 'Copy cancellation message', onCopy: existingHandler }} />`. Keep the secondary variant, because "Cancel order" is the dialog's primary.

Skipped (not messages to a person): CompanyPage.tsx:164 copy link, ItemsPanel.tsx:161 copy price, PasswordDialog.tsx:30. ChaseParts.tsx:73 "Copy subject" stays.
Line numbers are from main at eb8d878 and will move after the ux/* merges; find the sites by handler name.
