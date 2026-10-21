import { createElement, Suspense, useState, type ComponentType } from 'react'
import { lazyWithReload } from '@/lib/importWithReload'

/**
 * A dialog whose code (and its form library, react-hook-form and zod) is downloaded the first time it opens, not with the
 * page that offers it (perf/lcp). Same props, same behaviour: nothing is drawn while it has never been open (a closed dialog
 * draws nothing anyway); once opened it stays mounted, so closing animates and focus returns as before.
 *
 *   const AddExpenseDialog = lazyDialog(() => import('@/features/money/expenses/ExpenseDialog').then(m => m.AddExpenseDialog))
 */
export function lazyDialog<P extends { open: boolean }>(load: () => Promise<ComponentType<P>>): ComponentType<P> {
  const Dialog = lazyWithReload(() => load().then(component => ({ default: component }))) as unknown as ComponentType<P>
  function LazyDialog(props: P) {
    const [opened, setOpened] = useState(props.open)
    if (props.open && !opened) setOpened(true)
    return opened ? (
      <Suspense fallback={null}>
        {createElement(Dialog, props)}
      </Suspense>
    ) : null
  }
  return LazyDialog
}
