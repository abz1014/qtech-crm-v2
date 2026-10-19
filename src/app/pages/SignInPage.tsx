import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Eye, EyeOff, KeyRound, Smartphone, UserX } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useSession, useSignInNotice } from '@/app/session'
import { getSupabase } from '@/lib/supabase'
import { shortDay } from '@/features/capture/model'
import { listCaptures, markCaptureBeforeSignIn, safely } from '@/lib/capture/store'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/form/Field'
import { TextField } from '@/ui/form/TextField'
import { Icon } from '@/ui/Icon'

/*
 * Sign-in (docs/design/mockups/g2-login-team-settings.html, Login). Wordmark, two fields, one
 * action, one sentence about a lost password: no "forgot" link, the admin is the recovery path.
 * One message for a wrong email or a wrong password, so it never says which one was wrong.
 */
const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email.').email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
})
type Values = z.infer<typeof schema>

type Failure = 'invalid' | 'deactivated' | 'unreachable' | null

export function SignInPage() {
  const session = useSession()
  const notice = useSignInNotice()
  const [failure, setFailure] = useState<Failure>(null)
  const [submitting, setSubmitting] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [reveal, setReveal] = useState(false)
  // A shared item is saved on this device before the app checks the session, so signing in again cannot lose it (R22).
  const [kept, setKept] = useState<{ what: string; until: string } | null>(null)
  useEffect(() => {
    void safely(() => listCaptures(), []).then(items => {
      const newest = items[0]
      if (!newest) return
      markCaptureBeforeSignIn()
      const photos = newest.files.length
      const what = [newest.text.trim() ? (newest.source === 'share' ? '1 message' : '1 text') : '', photos ? `${photos} ${photos === 1 ? 'photo' : 'photos'}` : ''].filter(Boolean).join(' and ')
      setKept({ what, until: shortDay(new Date(newest.expiresAt).toISOString()) })
    })
  }, [])
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } })
  const { errors } = form.formState

  // Busy from the press until the session settles: signed in (the page is replaced) or a notice arrives.
  const busy = submitting || (attempted && session.status === 'loading' && notice === null)

  async function onSubmit(values: Values) {
    const supabase = getSupabase()
    if (!supabase) {
      setFailure('unreachable')
      return
    }
    setFailure(null)
    setAttempted(true)
    setSubmitting(true)
    const { error } = await supabase.auth.signInWithPassword({ email: values.email, password: values.password })
    setSubmitting(false)
    if (!error) return
    if (error.code === 'user_banned') setFailure('deactivated')
    else if (error.code === 'invalid_credentials' || error.status === 400) setFailure('invalid')
    else setFailure('unreachable')
  }

  // A notice from the session (signed out because deactivated) shows when this form has nothing to say itself.
  const shown: Failure = failure ?? (notice === 'deactivated' ? 'deactivated' : notice === 'unreachable' ? 'unreachable' : null)

  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 py-8 max-sm:items-start max-sm:bg-surface max-sm:px-0 max-sm:py-6">
      <div className="grid w-full max-w-[360px] gap-5 rounded border border-line bg-surface px-8 pb-6 pt-8 max-sm:max-w-none max-sm:border-0 max-sm:px-4">
        <img src="/brand/logo-wordmark.png" alt="Q Tech Solutions" width={181} height={44} className="h-[44px] w-auto justify-self-start" />
        <div className="grid gap-[2px]">
          <h1 className="text-xl font-semibold tracking-snug">{kept ? 'Sign in to continue' : 'Sign in'}</h1>
          <p className="text-sm text-fg-muted">{kept ? 'You were signed out.' : 'Use the email and password your admin gave you.'}</p>
        </div>

        {shown === 'invalid' ? (
          <Banner tone="danger" title="Email or password is incorrect">
            Check both and try again.
          </Banner>
        ) : null}
        {shown === 'deactivated' ? (
          <Banner tone="warning" icon={UserX} title="This account is deactivated">
            Ask your admin to reactivate it.
          </Banner>
        ) : null}
        {shown === 'unreachable' ? (
          <Banner tone="danger" title="Can’t reach the server">
            Check your connection and try again.
          </Banner>
        ) : null}
        {kept ? (
          <>
            <Banner tone="success" title="Your shared item is safe">
              Sign in and the Capture sheet opens with it.
            </Banner>
            <div className="flex items-center gap-3 rounded border border-line-strong bg-sunken p-3 text-sm">
              <span aria-hidden="true" className="grid size-[32px] shrink-0 place-items-center rounded border bg-surface text-fg-2">
                <Icon icon={Smartphone} />
              </span>
              <span className="grid">
                <b className="font-medium">{kept.what}</b>
                <span className="text-xs text-fg-muted">{`Kept on this phone until ${kept.until}`}</span>
              </span>
            </div>
          </>
        ) : null}
        {notice === 'unconfigured' ? (
          <Banner tone="warning" title="Sign-in is not set up in this build">
            The Supabase address and key are missing.
          </Banner>
        ) : null}

        <form noValidate onSubmit={form.handleSubmit(onSubmit)} aria-busy={busy || undefined} className="grid gap-4">
          <Field label="Email" error={errors.email?.message}>
            <TextField
              type="email"
              autoComplete="username"
              placeholder="name@company.pk"
              inputMode="email"
              readOnly={busy}
              {...form.register('email')}
            />
          </Field>
          <Field label="Password" error={errors.password?.message}>
            <div className="relative">
              <TextField
                type={reveal ? 'text' : 'password'}
                autoComplete="current-password"
                readOnly={busy}
                aria-invalid={shown === 'invalid' || undefined}
                className="pr-10"
                {...form.register('password')}
              />
              <button
                type="button"
                aria-label={reveal ? 'Hide password' : 'Show password'}
                aria-pressed={reveal}
                onClick={() => setReveal(r => !r)}
                className="absolute inset-y-0 right-0 grid w-control place-items-center rounded text-fg-muted hover:text-fg"
              >
                <Icon icon={reveal ? EyeOff : Eye} />
              </button>
            </div>
          </Field>
          <Button type="submit" variant="primary" size="lg" busy={busy} busyLabel="Signing in" className="w-full">
            Sign in
          </Button>
        </form>

        <p className="flex items-start gap-2 border-t border-line pt-4 text-sm text-fg-muted text-pretty">
          <Icon icon={KeyRound} className="mt-[2px]" />
          <span>Forgot your password? Ask your admin to reset it.</span>
        </p>
      </div>
    </main>
  )
}
