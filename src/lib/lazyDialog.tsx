import { createElement, Suspense, useState, type ComponentType } from 'react'
import { lazyWithReload } from '@/lib/importWithReload'
import { ChunkBoundary } from '@/ui/ChunkBoundary'

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
      <ChunkBoundary fallback={null}>
        <Suspense fallback={null}>{createElement(Dialog, props)}</Suspense>
      </ChunkBoundary>
    ) : null
  }
  return LazyDialog
}

/**
 * The same for a dialog its page draws only while it is open (`{adding ? <AddLineDialog … /> : null}`): its code is downloaded
 * the first time it is drawn. Nothing shows until it arrives (on a phone that has the app, the service worker has it already).
 */
export function lazyShown<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> {
  const Shown = lazyWithReload(() => load().then(component => ({ default: component }))) as unknown as ComponentType<P>
  function LazyShown(props: P) {
    return (
      <ChunkBoundary fallback={null}>
        <Suspense fallback={null}>{createElement(Shown, props)}</Suspense>
      </ChunkBoundary>
    )
  }
  return LazyShown
}
