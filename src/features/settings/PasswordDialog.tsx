import { useState } from 'react'
import { Check, CircleCheck, Copy, KeyRound, MessageSquareText, TriangleAlert } from 'lucide-react'
import type { Role } from '@/features/settings/api'
import { firstName, passwordGroups, roleLabel, signInMessage } from '@/features/settings/teamModel'
import { cn } from '@/lib/utils'
import { Avatar } from '@/ui/Avatar'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Icon } from '@/ui/Icon'

/*
 * The one place a generated password is shown (account created, password reset). It lives only in
 * this component's props and is gone when the dialog closes: nothing stores it. Done stays disabled
 * until the admin has copied the password or the sign-in message, because closing loses it for good
 * (the only way back is another reset). If the browser refuses clipboard access, Done unlocks and
 * the admin copies the password by hand from the box.
 */
export interface SecretDialogProps {
  kind: 'created' | 'reset'
  person: { name: string; email: string; role: Role }
  password: string
  onClose: () => void
}

type CopyState = 'idle' | 'copied' | 'blocked'

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function PasswordDialog({ kind, person, password, onClose }: SecretDialogProps) {
  const [copy, setCopy] = useState<CopyState>('idle')
  const [messageCopied, setMessageCopied] = useState(false)
  const first = firstName(person.name)
  const unlocked = copy !== 'idle' || messageCopied

  const copyPassword = async () => setCopy((await writeClipboard(password)) ? 'copied' : 'blocked')
  const copyMessage = async () => {
    const ok = await writeClipboard(
      signInMessage({ name: person.name, email: person.email, password, signInUrl: `${window.location.origin}/login` }),
    )
    if (ok) setMessageCopied(true)
    else setCopy('blocked')
  }

  return (
    // Closing is held until the password has been copied: Esc, the scrim and the close button all go through here.
    <Dialog open onOpenChange={open => !open && unlocked && onClose()}>
      <DialogContent
        title={kind === 'created' ? 'Account created' : 'Password reset'}
        icon={CircleCheck}
        tone="success"
        context={
          kind === 'created'
            ? `Give ${first} the email and password below so they can sign in.`
            : `${first} is signed out everywhere. Give them the new password below.`
        }
        lead={
          unlocked ? (
            <>
              <Icon icon={Check} size="sm" />
              {copy === 'blocked' ? 'Copy it by hand from the box' : 'Copied to clipboard'}
            </>
          ) : (
            'Copy the password to continue'
          )
        }
        footer={
          <Button variant="primary" disabled={!unlocked} onClick={onClose}>
            Done
          </Button>
        }
      >
        <div className="flex items-center gap-3 border-b pb-4">
          <Avatar name={person.name} size="lg" />
          <div className="grid min-w-0">
            <span className="line-clamp-2 break-words font-medium text-fg">{person.name}</span>
            <span className="flex min-w-0 gap-2 text-xs text-fg-muted">
              <span className="num truncate">{person.email}</span>
              <span>{roleLabel(person.role)}</span>
            </span>
          </div>
        </div>

        <div
          data-copied={copy === 'copied' || undefined}
          className={cn(
            'grid gap-2 rounded border px-4 py-3 transition-colors duration-fast ease-out',
            copy === 'copied' ? 'border-solid border-tone-success-fg bg-tone-success-bg' : 'border-dashed border-line-input bg-sunken',
          )}
        >
          <span className="flex items-center gap-2 text-xs font-medium text-fg-muted">
            <Icon icon={KeyRound} size="sm" />
            {kind === 'created' ? 'Password' : 'New password'}
          </span>
          <div className="flex items-center justify-between gap-3">
            <p
              data-testid="generated-password"
              className="num flex min-w-0 flex-wrap gap-x-3 text-lg font-medium tracking-normal text-fg"
            >
              {/* Grouped for reading aloud. Selecting or copying gives the raw password with no separators. */}
              {passwordGroups(password).map((g, i) => (
                <span key={i}>{g}</span>
              ))}
            </p>
            <Button variant={copy === 'copied' ? 'secondary' : 'primary'} icon={copy === 'copied' ? Check : Copy} onClick={copyPassword}>
              {copy === 'copied' ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>

        <Banner tone="warning" title="This password is shown once">
          Copy it now and send it to {first} yourself. After you close this window it can&apos;t be shown again. You would reset it
          instead.
        </Banner>

        <div className="flex flex-wrap items-center gap-3">
          <Button icon={MessageSquareText} onClick={copyMessage}>
            {messageCopied ? 'Sign-in message copied' : 'Copy sign-in message'}
          </Button>
          <span className="flex items-center gap-2 text-xs text-fg-muted">
            <Icon icon={TriangleAlert} size="sm" />
            For WhatsApp. It includes the password.
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
