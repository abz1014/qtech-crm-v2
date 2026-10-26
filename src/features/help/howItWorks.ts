import type { HelpRole } from '@/features/help/recipes'

/*
 * The "How this works" card on Today (learnability spec 1.3): 3 to 5 lines per role, each with a "Show me" that opens the
 * matching recipe in the Help panel. A writer changes the words here without touching a screen. **Bold** is a screen word.
 * labelSync.test.ts checks that every recipe named here exists.
 */
export interface HowItWorksStep {
  /** One line. **bold** marks the on-screen word. */
  text: string
  /** The recipe "Show me" opens. */
  recipe: string
}

export const HOW_IT_WORKS: Record<HelpRole, HowItWorksStep[]> = {
  sales: [
    { text: 'A customer asks for prices: **New RFQ**, then paste their message.', recipe: 'new-rfq' },
    { text: '**Ask suppliers**: one message, copied into WhatsApp.', recipe: 'ask-suppliers' },
    { text: 'Prices come in: paste their reply, and the app compares them in PKR.', recipe: 'supplier-prices' },
    { text: '**Issue quotation** makes the PDF. To do reminds you to chase until it is won or lost.', recipe: 'issue-quotation' },
  ],
  engineer: [
    { text: '**To do** lists your site jobs and their dates.', recipe: 'today-jobs' },
    { text: 'On site, **Paste or photo** saves a photo or note to the RFQ or order. No forms.', recipe: 'paste-or-photo' },
    { text: 'One tap when done: **Delivered today**, **Mark done today**. Wrong tap? **Undo**.', recipe: 'goods-delivered' },
  ],
  admin: [
    { text: '**To collect**: record payments and send reminders.', recipe: 'record-payment' },
    { text: '**Invoices**: create invoices, mark TCS and FBR.', recipe: 'tcs-fbr' },
    { text: '**Expenses**: add many at once.', recipe: 'add-expenses' },
    { text: '**Lock a month** lists only what needs fixing, then you close the month.', recipe: 'month-end-close' },
    { text: '**Team**: add people. Each one sees only what their role needs.', recipe: 'add-person' },
  ],
}

/** The steps for a role, or none for a role the card does not know. */
export function howItWorksFor(role: string): HowItWorksStep[] {
  return (HOW_IT_WORKS as Record<string, HowItWorksStep[] | undefined>)[role] ?? []
}

/** Where the card remembers "Got it", per person on this device (the qtech.<thing>.<person id> convention). */
export const howItWorksKey = (userId: string) => `qtech.howItWorks.${userId}`
