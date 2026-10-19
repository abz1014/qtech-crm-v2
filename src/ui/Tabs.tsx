import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react'
import * as RadixTabs from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

/*
 * Tabs (INVENTORY: U03; D08 section 01). In-page and in-panel tabs with optional
 * count pills: role=tablist/tab/tabpanel, Left/Right move and select, Home/End jump.
 * NOT for site navigation: that is the `nav` of links in AppShell.
 *   <Tabs defaultValue="items">
 *     <TabList aria-label="RFQ sections"><Tab value="items">Items</Tab><Tab value="q" count={2}>Questions</Tab></TabList>
 *     <TabPanel value="items">…</TabPanel>
 *   </Tabs>
 */
export const Tabs = RadixTabs.Root

export const TabList = forwardRef<ElementRef<typeof RadixTabs.List>, ComponentPropsWithoutRef<typeof RadixTabs.List>>(
  function TabList({ className, ...rest }, ref) {
    return <RadixTabs.List ref={ref} className={cn('flex gap-1 overflow-x-auto border-b', className)} {...rest} />
  },
)

interface TabProps extends Omit<ComponentPropsWithoutRef<typeof RadixTabs.Trigger>, 'children'> {
  children: ReactNode
  /** Count pill beside the name ("Questions 2"). Mono. */
  count?: number
}

export const Tab = forwardRef<ElementRef<typeof RadixTabs.Trigger>, TabProps>(function Tab(
  { children, count, className, ...rest },
  ref,
) {
  return (
    <RadixTabs.Trigger
      ref={ref}
      className={cn(
        'group relative inline-flex h-control shrink-0 items-center gap-2 whitespace-nowrap rounded px-3 text-sm font-medium text-fg-2',
        'transition-colors duration-fast ease-out hover:text-fg data-[state=active]:text-fg disabled:text-fg-disabled',
        className,
      )}
      {...rest}
    >
      {children}
      {count !== undefined ? (
        <span className="num inline-grid h-[var(--lh-xs)] min-w-[var(--lh-xs)] place-items-center rounded-round bg-selected px-[6px] text-xs leading-none text-fg-2">
          {count}
        </span>
      ) : null}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-3 -bottom-px h-indicator bg-brand-green opacity-0 group-data-[state=active]:opacity-100"
      />
    </RadixTabs.Trigger>
  )
})

export const TabPanel = forwardRef<ElementRef<typeof RadixTabs.Content>, ComponentPropsWithoutRef<typeof RadixTabs.Content>>(
  function TabPanel({ className, ...rest }, ref) {
    return <RadixTabs.Content ref={ref} className={cn('pt-4 focus-visible:outline-offset-4', className)} {...rest} />
  },
)
