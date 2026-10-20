import { cn } from '@/lib/utils'
import { parseInline, type Block, type Inline } from '@/features/help/markdown'

/*
 * Renders parsed help markdown (markdown.ts) as React elements. Text is always a React text node, never HTML, so a recipe
 * cannot inject markup or script. An on-screen label is drawn as a small non-interactive chip, so the person can match it
 * with the button they are looking for.
 */

export function InlineText({ parts }: { parts: readonly Inline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.kind === 'strong' ? (
          <strong key={i} className="font-semibold text-fg">
            {p.text}
          </strong>
        ) : p.kind === 'label' ? (
          <span key={i} data-label="" className="box-decoration-clone rounded border border-line-strong bg-sunken px-1 font-medium text-fg">
            {p.text}
          </span>
        ) : (
          p.text
        ),
      )}
    </>
  )
}

/** One line of help text with **bold** and [Label] marks (the How this works card uses it). */
export function InlineMarkdown({ text }: { text: string }) {
  return <InlineText parts={parseInline(text)} />
}

const NOTE = {
  tip: { lead: 'Tip:', className: 'bg-sunken text-fg-2' },
  safe: { lead: 'Safe to try:', className: 'bg-tone-success-bg text-tone-success-fg' },
} as const

export function MarkdownBlocks({ blocks, className }: { blocks: readonly Block[]; className?: string }) {
  return (
    <div className={cn('grid content-start gap-3 text-sm text-fg-2', className)}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'heading':
            return (
              <h4 key={i} className="text-base font-semibold text-fg">
                <InlineText parts={b.inline} />
              </h4>
            )
          case 'para':
            return (
              <p key={i} className="text-pretty">
                <InlineText parts={b.inline} />
              </p>
            )
          case 'steps':
            return (
              <ol key={i} className="grid list-decimal gap-2 pl-5 marker:font-semibold marker:text-fg-muted">
                {b.items.map((item, j) => (
                  <li key={j} className="pl-1 text-pretty">
                    <InlineText parts={item} />
                  </li>
                ))}
              </ol>
            )
          case 'bullets':
            return (
              <ul key={i} className="grid list-disc gap-1 pl-5 marker:text-fg-muted">
                {b.items.map((item, j) => (
                  <li key={j} className="pl-1 text-pretty">
                    <InlineText parts={item} />
                  </li>
                ))}
              </ul>
            )
          case 'note':
            return (
              <p key={i} className={cn('rounded px-3 py-2 text-pretty', NOTE[b.note].className)}>
                <strong className="font-semibold">{NOTE[b.note].lead}</strong> <InlineText parts={b.inline} />
              </p>
            )
        }
      })}
    </div>
  )
}
