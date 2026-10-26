import type { HelpRole } from '@/features/help/recipes'

/*
 * What an empty screen says to someone who has not started yet (learnability spec 1.2). Today, the RFQ board and the
 * Orders list currently praise a new person ("Nothing needs you today", "None of your RFQs are open. Nice.") because
 * their list is empty. A first-use state instead says what the screen is for and offers ONE button: the next action.
 * The existing "all done" and "filter matched nothing" states stay as they are; they are right once the person has data.
 *
 * The words live here so a writer can change them without touching a screen. FirstUseState renders them.
 */

export type FirstUseScreen = 'today' | 'rfqs' | 'orders'

export type FirstUseAction =
  /** A route to open. */
  | { kind: 'link'; label: string; to: string }
  /** Opens the Paste or photo sheet. */
  | { kind: 'capture'; label: string }
  /** The screen's own "show everyone's" switch; the screen passes the handler and the count. */
  | { kind: 'everyone'; label: string }

export interface FirstUseCopy {
  title: string
  /** At most two short lines. */
  body: string
  /** The one button. A list with nothing to point at yet (Who owes us on a new CRM) has none; "Show me how" still shows. */
  action?: FirstUseAction
  /** A second, quiet button opening this Help recipe. */
  recipe?: string
}

export const FIRST_USE_COPY: Record<FirstUseScreen, Partial<Record<HelpRole, FirstUseCopy>>> = {
  today: {
    sales: {
      title: 'Your work shows up here',
      body: 'To do lists customers to chase, suppliers to ask and quotations due. It fills up once you log your first RFQ.',
      action: { kind: 'link', label: 'New RFQ', to: '/rfqs/new' },
      recipe: 'new-rfq',
    },
    engineer: {
      title: 'Your jobs show up here',
      body: 'When an order needs you on site, the admin adds you to it and it appears here with its date. You can already save a site photo or note to any RFQ or order.',
      action: { kind: 'capture', label: 'Paste or photo' },
      recipe: 'paste-or-photo',
    },
    admin: {
      title: 'Nothing needs you yet',
      body: 'To do lists payments to chase, invoices to send and month-end checks.',
      action: { kind: 'link', label: 'Open Money', to: '/money' },
      recipe: 'record-payment',
    },
  },
  rfqs: {
    sales: {
      title: 'No RFQs of yours yet',
      body: 'An RFQ is a customer asking for a price. Paste their message and the app splits it into items.',
      action: { kind: 'link', label: 'New RFQ', to: '/rfqs/new' },
      recipe: 'new-rfq',
    },
    admin: {
      title: 'No RFQs of yours yet',
      body: 'An RFQ is a customer asking for a price. Paste their message and the app splits it into items.',
      action: { kind: 'link', label: 'New RFQ', to: '/rfqs/new' },
      recipe: 'new-rfq',
    },
  },
  orders: {
    sales: {
      title: 'No orders of yours yet',
      body: 'Orders start when you mark an RFQ won. You never type an order from scratch.',
      action: { kind: 'link', label: 'Open RFQs', to: '/rfqs' },
      recipe: 'mark-won',
    },
    engineer: {
      title: 'No jobs yet',
      body: 'Orders you are put on appear here with the site and the date.',
      action: { kind: 'everyone', label: 'Show everyone’s' },
      recipe: 'today-jobs',
    },
  },
}

/** Admin, when the owner is still the only person on the team: the one button is adding people. */
export const ADMIN_ALONE: FirstUseCopy = {
  title: 'Just you so far',
  body: 'Add the people who will use the app. Each one sees only what their role needs.',
  action: { kind: 'link', label: 'Add person', to: '/settings/team' },
  recipe: 'add-person',
}

export function firstUseCopy(screen: FirstUseScreen, role: string, opts: { alone?: boolean } = {}): FirstUseCopy | null {
  if (screen === 'today' && role === 'admin' && opts.alone) return ADMIN_ALONE
  return (FIRST_USE_COPY[screen] as Record<string, FirstUseCopy | undefined>)[role] ?? null
}

/*
 * A list that has NEVER had a record (a brand-new CRM, or the company has not used this part yet). Its usual empty state praises
 * finished work ("Every order is paid in full", "Every quotation is out or closed"), which is untrue when nothing has ever been
 * entered. The screen shows this neutral line instead and keeps its own words for when records exist. Company-wide, not per
 * person: who owns what is the first-use state above.
 */
export type NothingYetScreen = 'rfqs' | 'orders' | 'receivables'

export const NOTHING_YET: Record<NothingYetScreen, FirstUseCopy> = {
  rfqs: {
    title: 'No RFQs yet',
    body: 'An RFQ is a customer asking for a price. Start one and it stays here until it is quoted, won or closed.',
    action: { kind: 'link', label: 'New RFQ', to: '/rfqs/new' },
    recipe: 'new-rfq',
  },
  orders: {
    title: 'No orders yet',
    body: 'An order starts when you mark an RFQ won, and stays here until it is delivered and paid.',
    action: { kind: 'link', label: 'Open RFQs', to: '/rfqs' },
    recipe: 'mark-won',
  },
  receivables: {
    title: 'No balances yet',
    body: 'Once an order is won, what the customer owes shows here until it is paid.',
    recipe: 'record-payment',
  },
}
