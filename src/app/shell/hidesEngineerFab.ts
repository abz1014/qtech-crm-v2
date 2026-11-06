/*
 * Where the engineer's floating "Photo or note / I paid" pill is not shown. It sits over the bottom of the page by 12 px, so on
 * a screen whose last row or Save bar lives there it would cover it; and on the capture and expense screens it offers the
 * very thing the person is already doing.
 */
const NO_FAB = ['/capture', '/my-expenses', '/settings/details', '/settings/password', '/rfqs/new', '/enquiries/new']

/** True where the pill is hidden: those screens and anything beneath them. Query strings and hashes are not part of the path. */
export function hidesEngineerFab(pathname: string): boolean {
  const path = pathname.split(/[?#]/)[0]
  return NO_FAB.some(p => path === p || path.startsWith(`${p}/`))
}
