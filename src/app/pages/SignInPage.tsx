import { Banner } from '@/ui/Banner'

/**
 * Placeholder until A03 builds the real sign-in (LoginCard, D07). It exists so
 * routing has somewhere to send a signed-out person; it holds no form and
 * collects nothing.
 */
export function SignInPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas p-4">
      <div className="grid w-full max-w-sm gap-6">
        <img src="/brand/logo-wordmark.png" alt="Q Tech Solutions" width={174} height={42} className="h-[42px] w-auto justify-self-start" />
        <div className="grid gap-1">
          <h1 className="text-xl font-semibold tracking-snug">Sign in</h1>
          <p className="text-sm text-fg-muted">Use the email and password your admin gave you.</p>
        </div>
        <Banner tone="info" title="Sign-in is not connected yet">
          This build has the page shell only. Sign-in arrives with the account task.
        </Banner>
      </div>
    </main>
  )
}
