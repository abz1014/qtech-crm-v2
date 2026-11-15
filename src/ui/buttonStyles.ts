import { cva, type VariantProps } from 'class-variance-authority'

/* The Button's look (Button.tsx holds the full description), shared with links drawn as buttons (buttonStyles). */
export const button = cva(
  [
    'group inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control border',
    'font-bold leading-none transition-[background-color,border-color,color,transform] duration-fast ease-out',
    'active:scale-press disabled:cursor-not-allowed disabled:active:transform-none',
  ],
  {
    variants: {
      variant: {
        primary: [
          'border-primary bg-primary text-primary-foreground [[data-surface=navy]_&]:shadow-on-navy',
          'hover:border-primary-hover hover:bg-primary-hover active:border-primary-active active:bg-primary-active',
          'disabled:border-transparent disabled:bg-deep disabled:text-fg-disabled',
        ],
        secondary: [
          'border-line-strong bg-surface text-fg',
          'hover:bg-selected active:bg-selected',
          'disabled:border-transparent disabled:bg-deep disabled:text-fg-disabled',
        ],
        quiet: [
          // Forest ghost: the green words are the affordance (--primary-text, re-inked to white on the forest), a tint on hover.
          'border-transparent bg-transparent text-primary',
          'hover:bg-selected active:bg-selected',
          'disabled:bg-transparent disabled:text-fg-disabled',
        ],
        lime: [
          // Forest hero only (30-job-page, 50-money-hub): the one action on a forest card, lime with forest words (8.61:1). Never on
          // white: lime there is under 3:1. The focus ring is lime on the forest too; its 2 px offset shows the forest between them.
          'border-lime-300 bg-lime-300 text-lime-on',
          'hover:border-lime-hover hover:bg-lime-hover active:border-lime-press active:bg-lime-press',
          'disabled:border-transparent disabled:bg-deep disabled:text-fg-disabled',
        ],
        danger: [
          // On the forest the surface is re-inked dark, so the outline sits on its own tint there (red on the forest is unreadable).
          'border-tone-danger-fg bg-surface text-tone-danger-fg [[data-surface=navy]_&]:bg-tone-danger-bg',
          'hover:bg-tone-danger-bg active:bg-tone-danger-bg',
          'disabled:border-transparent disabled:bg-deep disabled:text-fg-disabled',
        ],
      },
      size: {
        lg: 'h-control-lg px-5 text-base',
        md: 'h-control px-4 text-sm',
        sm: 'h-control-sm px-3 text-xs',
        /** Phone chrome: the 44px minimum tap target (--hit-touch). */
        touch: 'h-touch px-4 text-sm',
      },
      iconOnly: { true: 'px-0', false: '' },
    },
    compoundVariants: [
      { size: 'lg', iconOnly: true, className: 'w-control-lg' },
      { size: 'md', iconOnly: true, className: 'w-control' },
      { size: 'sm', iconOnly: true, className: 'w-control-sm' },
      { size: 'touch', iconOnly: true, className: 'w-touch' },
    ],
    defaultVariants: { variant: 'secondary', size: 'md', iconOnly: false },
  },
)

/**
 * The button's look for a link that navigates (a react-router Link drawn as a button: a page's way back, a hero's "Open To collect").
 * Same variants and sizes; the glyph colour is the caller's.
 */
export const buttonStyles = (o: { variant?: NonNullable<VariantProps<typeof button>['variant']>; size?: NonNullable<VariantProps<typeof button>['size']> } = {}) =>
  button({ variant: o.variant ?? 'secondary', size: o.size ?? 'md', iconOnly: false })

