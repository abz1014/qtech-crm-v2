import { useState } from 'react'
import type { ContactChannel } from '@/lib/useChannelPreference'
import { MessageActions, type MessageActionsProps } from '@/ui/MessageActions'
import { ToastProvider } from '@/ui/Toast'

/*
 * Story-like demo of MessageActions: every state, with made-up contacts (numbers in the import fixtures' style,
 * .invalid addresses). The tests render it; the /dev/gallery owner can drop <MessageActionsDemo /> into a section
 * (or one state with `only`) without writing the cases again.
 */

const TEXT = 'Assalam o Alaikum Ahmed,\nA reminder on RFQ-0177: could you confirm the flange size for item 3?\nThanks,\nAyesha'
const EMAIL = { subject: 'RFQ-0177: flange size for item 3', body: 'Dear Ahmed,\n\nCould you confirm the flange size for item 3 on RFQ-0177?\n\nRegards,\nAyesha' }
const AHMED = { name: 'Ahmed Raza', phone: '+92 300 555 0188', email: 'ahmed.raza@example.invalid' }

const DEMOS = {
  ready: { title: 'Mobile and email saved (screen primary free)', props: { to: AHMED, text: TEXT, email: EMAIL, variant: 'primary' } },
  emailFirst: { title: 'Email used last: Open in email comes first', props: { to: AHMED, text: TEXT, email: EMAIL, variant: 'primary' }, channel: 'email' },
  noMobile: {
    title: 'No mobile number: WhatsApp disabled with the reason',
    props: { to: { name: 'Bilal Khan', phone: null, email: 'bilal@example.invalid' }, text: TEXT, email: EMAIL, variant: 'primary' },
    fix: true,
  },
  landline: { title: 'Only a landline, no email: Copy is the way', props: { to: { name: 'Ghani Glass', phone: '+92 42 555 0138' }, text: TEXT, variant: 'primary' } },
  severalNumbers: {
    title: 'Several numbers in one field: the WhatsApp one is used',
    props: { to: { name: 'Naveed Akhtar', phone: 'Off: 042-35761234 / WhatsApp: 0321 7654321', email: null }, text: TEXT },
  },
  copyAndMark: {
    title: 'Screen primary already used; Copy also marks',
    props: { to: AHMED, text: TEXT, email: EMAIL, copy: { label: 'Copy and mark chased' } },
  },
  tooLong: {
    title: 'Too long for a link: opening copies it first',
    props: { to: AHMED, text: `${TEXT}\n${'Item: 2" ball valve, SS316, PN40, flanged ends, with test certificate. '.repeat(40)}`, email: EMAIL, variant: 'primary' },
  },
  noContact: { title: 'No contact on the record', props: { to: null, text: TEXT } },
} satisfies Record<string, { title: string; props: MessageActionsProps; channel?: ContactChannel; fix?: boolean }>

export type MessageActionsDemoId = keyof typeof DEMOS

function Case({ id }: { id: MessageActionsDemoId }) {
  const demo: { title: string; props: MessageActionsProps; channel?: ContactChannel; fix?: boolean } = DEMOS[id]
  const [channel, setChannel] = useState<ContactChannel>(demo.channel ?? 'whatsapp')
  const [note, setNote] = useState<string | null>(null)
  return (
    <section aria-labelledby={`message-actions-${id}`} data-demo={id} className="grid gap-2 rounded border bg-surface p-4">
      <h3 id={`message-actions-${id}`} className="text-sm font-semibold">
        {demo.title}
      </h3>
      <MessageActions
        {...demo.props}
        channel={channel}
        onChannelChange={setChannel}
        onOpen={c => setNote(`Opened ${c === 'email' ? 'email' : 'WhatsApp'}. The screen now offers its own "Mark chased" tap.`)}
        onFixContact={demo.fix ? () => setNote('The screen opens the contact to add a mobile number.') : undefined}
      />
      {note ? (
        <p role="status" className="text-sm text-fg-muted">
          {note}
        </p>
      ) : null}
    </section>
  )
}

/** All the states (or one), each in its own titled card, inside a ToastProvider. */
export function MessageActionsDemo({ only }: { only?: MessageActionsDemoId }) {
  const ids = only ? [only] : (Object.keys(DEMOS) as MessageActionsDemoId[])
  return (
    <ToastProvider>
      <div className="grid gap-4">
        {ids.map(id => (
          <Case key={id} id={id} />
        ))}
      </div>
    </ToastProvider>
  )
}
