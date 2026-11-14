import { cn } from '@/lib/utils'

/*
 * The How this works step number (82-help.html .qb-help__n): a brand-tinted disc with the digit in the mono face. The order is the
 * information (the steps are a sequence), so the number earns its place. Help's panel and the card on Home draw the same disc.
 *
 * A step row puts a small "Show me" button beside the text and the disc. `besideButton` drops the disc, and STEP_TEXT_BESIDE_BUTTON
 * the text's first line, to the middle of the button's height, from the tokens, so the three read as one line at either text size.
 */
export const STEP_TEXT_BESIDE_BUTTON = 'pt-[calc((var(--control-sm-h)-var(--lh-base))/2)]'

export function StepNumber({ n, besideButton = false, className }: { n: number; besideButton?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-6 shrink-0 place-items-center rounded-pill bg-brand-100 font-mono text-sm font-heavy leading-none text-brand-700',
        besideButton && 'mt-[calc((var(--control-sm-h)-var(--sp-6))/2)]',
        className,
      )}
    >
      {n}
    </span>
  )
}
