/*
 * Every visible word the verify suites look for, split by area under ./text/ (common words and figure helpers, then one file per suite).
 * This file only re-exports them, so a spec keeps importing `{ COMMON, SALES } from '../support/text'`.
 */
export * from './text/common'
export { SALES } from './text/sales'
export { QUOTES } from './text/quotes'
export { ORDERS } from './text/orders'
export { MONEY } from './text/money'
export { BOOKS } from './text/books'
export { ADMIN } from './text/admin'
export { ROLES } from './text/roles'
export { RESILIENCE } from './text/resilience'
