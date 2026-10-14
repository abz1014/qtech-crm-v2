import type { ReactNode } from 'react'

/** A gallery section: an anchor, a heading and the one-line reason it is here. */
export const Section = ({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) => (
  <section id={id} aria-labelledby={`${id}-h`} className="grid min-w-0 grid-cols-1 gap-3 scroll-mt-4">
    <div className="grid gap-1">
      <h2 id={`${id}-h`} className="text-xl font-semibold tracking-snug">
        {title}
      </h2>
      {note ? <p className="max-w-prose text-sm text-fg-muted">{note}</p> : null}
    </div>
    {children}
  </section>
)

/** A labelled row inside a panel: what it is on the left, the live state on the right. */
export const Row = ({ title, note, children }: { title: string; note: string; children: ReactNode }) => (
  <div className="grid gap-3 border-t py-4 first:border-t-0 md:grid-cols-[320px_minmax(0,1fr)]">
    <div className="grid content-start gap-1">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-fg-muted">{note}</p>
    </div>
    <div className="flex min-w-0 flex-wrap items-center gap-4">{children}</div>
  </div>
)

/** A titled card for a group of states. */
export const Panel = ({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) => (
  <div className={`grid min-w-0 grid-cols-1 content-start gap-3 rounded border bg-surface p-4 ${className}`}>
    <h3 className="text-sm font-medium">{title}</h3>
    {children}
  </div>
)

/** One scene on its own: a landmark and a heading, so the page is valid beside the overlay it shows. */
export function SceneFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-canvas p-6">
      <h1 className="sr-only">{title}</h1>
      {children}
    </main>
  )
}
