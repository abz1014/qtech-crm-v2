/*
 * The server's own rule messages (raise exception in supabase/migrations) to plain sentences that say the fix
 * (learnability spec 3.4). mapPgError consults rpcMessage before its generic fallback.
 *
 * Every raise exception literal in the migrations must match an entry here: rpcMessages.test.ts scans them, so a new
 * unmapped RAISE fails CI. An entry is either a plain message (what happened, then the fix; no apology) or
 * `internal: true` for programmer, import and migration-only errors that no person can fix from a screen.
 * An entry with neither keeps the server's text, which is already written for people.
 */
export interface RpcAction {
  label: string
  href: string
}

export interface RpcEntry {
  match: RegExp
  message?: (m: RegExpMatchArray) => string
  internal?: true
  /** Help recipe id (docs/help/<id>.md). */
  help?: string
  action?: RpcAction
}

export interface RpcMessage {
  message: string
  help?: string
  action?: RpcAction
}

const MONTH_END: RpcAction = { label: 'Open Lock a month', href: '/money/month-end' }
const BANK: RpcAction = { label: 'Open Bank check', href: '/money/month-end/bank' }
const CATEGORIES: RpcAction = { label: 'Open categories', href: '/settings/categories' }
const TEAM: RpcAction = { label: 'Open Team', href: '/settings/team' }

const ADMIN_ONLY = 'Only an admin can do this. Nothing was saved. Ask an admin if it needs doing.'
const ADMIN_SALES = 'Only admin and sales can do this. Nothing was saved. Ask one of them if it needs doing.'
const RELOAD = 'Something this needs is no longer there. Reload the page, then try again.'

export const RPC_MESSAGES: readonly RpcEntry[] = [
  // Months
  { match: /^(.+?) cannot be closed yet: it is the current month or later\.?$/, message: m => `${m[1]} can be closed from the 1st of next month.`, help: 'month-end-close' },
  { match: /^(.+?) is closed\. An admin can reopen it\.?$/, action: MONTH_END },
  { match: /^(.+?) is closed\. Reopen it first \(Money, Month-end\), then change this payment\.?$/, action: MONTH_END },
  { match: /^(.+?) is still open\. Close earlier months first/, message: m => `Close ${m[1]} first. Months close in order.`, help: 'month-end-close', action: MONTH_END },
  { match: /^The new date is in (.+?), which is closed\./, action: MONTH_END },
  // 0080 (owner decision 2026-10-22): months reopen newest first.
  {
    match: /^(.+?) cannot be reopened while (.+?) is closed\. Reopen (.+?) first\.?$/,
    message: m => `Reopen ${m[2]} first. Months reopen newest first, so ${m[1]} can be reopened once every month after it is open.`,
    help: 'month-end-close',
    action: MONTH_END,
  },
  { match: /^a month is required$/, message: () => 'Choose a month first.' },
  { match: /^only an admin can (close|reopen) a month$/, message: m => `Only an admin can ${m[1]} a month. Ask an admin if it needs doing.` },

  // Payments: these are already written for people
  { match: /^Give a reason for voiding this payment/ },
  { match: /^Nothing to correct: / },
  { match: /^Only the person who voided this payment can undo it\./ },
  { match: /^Paid via must be bank or cash\.$/ },
  { match: /^The amount must be above zero\.$/ },
  // 0085 session cutoff (HW-17/HW-45): already sentences; the app signs the person out on these
  { match: /^Your session has ended\. Sign in again\.$/ },
  { match: /^This account has been deactivated\.$/ },
  // 0090 record history
  { match: /^You cannot see the history of this record\.$/ },
  { match: /^This kind of record has no history page\.$/, internal: true },
  { match: /^record_history_rows is internal: call record_history$/, internal: true },
  // 0099 jobs: the migration refuses to run when create_repeat_order cannot be patched (never raised at run time)
  { match: /^create_repeat_order could not be patched for repeat_of_order_id$/, internal: true },
  { match: /^record_history_rows could not be patched for priced files$/, internal: true },
  { match: /^The correction of this payment has been changed since\./ },
  { match: /^The date received is required\.$/ },
  { match: /^This payment is already voided\./ },
  { match: /^This payment is no longer there\./ },
  { match: /^This payment is not voided\./ },
  { match: /^This payment is ticked against the (.+?) bank statement\./, action: BANK },
  { match: /^This payment is voided and kept as history\./ },
  { match: /^Undo works for 10 minutes after a void\./ },
  { match: /^only an admin can undo a void$/, message: () => 'Only an admin can undo a void. Ask an admin, or record the payment again.' },
  { match: /^only an admin can void or correct a payment$/, message: () => 'Only an admin can void or correct a payment. Ask an admin if it needs doing.' },
  { match: /^a correction is recorded only through correct_payment$/, internal: true },
  { match: /^a payment is voided (or restored )?only through /, internal: true },
  { match: /^which payment a correction replaces cannot be changed$/, internal: true },
  { match: /^settled before cutover is set by the legacy import only$/, internal: true },
  { match: /^legacy_source is set by the legacy import only$/, internal: true },
  { match: /^\w+ \d{4} has not ended: only months that have ended can be locked as Imported\.$/, internal: true },
  { match: /^No active admin: the imported months cannot be locked\.$/, internal: true },
  { match: /^payment reminders are for admin and sales only$/, message: () => ADMIN_SALES },

  // Quotations and POs
  { match: /^a quoted price above zero is needed for: (.+)$/, message: m => `A quotation can't carry a price of 0. Enter the price for "${m[1]}", or untick it.`, help: 'issue-quotation' },
  {
    match: /^the quantity of (.+) changed to (.+) since this quotation was opened$/,
    message: m => `Someone changed the quantity of "${m[1]}" to ${m[2]} while this was open. Nothing was issued. Check the new total below, then issue again.`,
    help: 'issue-quotation',
  },
  { match: /^a quoted price is needed for: (.+)$/, message: m => `Add a price for "${m[1]}", then issue the quotation again.`, help: 'issue-quotation' },
  { match: /^a selling price is needed for: (.+)$/, message: m => `Add a selling price for "${m[1]}", then try again.` },
  { match: /^a price is needed for: (.+)$/, message: m => `Add the supplier price for "${m[1]}", then issue the PO again.`, help: 'issue-po' },
  { match: /^set the currency of this supplier order before issuing a PO$/, message: () => "Pick the supplier's currency on this supplier order, then issue the PO.", help: 'issue-po' },
  { match: /^an issued (.+?) cannot be changed; issue a new revision$/, message: () => "An issued quotation or PO can't be edited. Use Revise.", help: 'revise-quotation' },
  { match: /^the PDF of this issued (.+?) is already attached; only an admin can replace it$/, message: m => `This ${m[1]} already has its PDF. Only an admin can replace it.` },
  { match: /^the RFQ has no items to (quote|convert)$/, message: () => 'Add at least one item first.' },
  // 0077: already plain; Create order opens that order instead (existingOrderOf in src/features/orders/api.ts).
  { match: /^This RFQ is already order ORD-.+\.$/ },
  // 0094 (HW-60): the quotation or a quantity moved on while Mark won was open. Already plain; the dialog reloads the lines.
  { match: /^The quotation changed since you opened this\. Review again\.$/ },
  // 0095: order, PO and repeat-order fixes (already written for people)
  { match: /^PO (.+) is already on order (ORD-.+?)\. Open that order instead of adding a second\.$/ },
  { match: /^RFQ-.+ already has live order ORD-.+\.$/ },
  { match: /^This order was cancelled\. Repeat it anyway\?$/ },
  { match: /^The order lines changed\. Review again\.$/ },
  { match: /^PO R.+ was just issued by .+\. Revise instead\?$/ },
  { match: /^the supplier order has no goods lines to issue$/, message: () => 'Add at least one goods line to this supplier order, then issue the PO.' },
  { match: /^the chosen quote line is not a quote for the item: (.+)$/, message: m => `The chosen supplier quote does not belong to "${m[1]}". Choose the quote again.` },
  { match: /^an item (to quote )?does not belong to this RFQ$/, message: () => RELOAD },
  { match: /^every item needs a description$/, message: () => 'Every item needs a description. Fill in the empty ones, then save.' },
  { match: /^invoice numbers are for admin and sales only$/, message: () => ADMIN_SALES },
  { match: /^supplier categories are tagged by admin and sales only$/, message: () => ADMIN_SALES },   // 0093
  { match: /^(FBR|TCS) stamping is for admin and sales only$/, message: () => ADMIN_SALES },
  { match: /^prices, quantities and GST on an order are changed by admin and sales only$/, message: () => ADMIN_SALES },

  // Supplier orders and splits
  { match: /^a line does not belong to this supplier order$/, message: () => RELOAD },
  { match: /^a service line cannot be split$/, message: () => 'A service line cannot be split. Split only goods lines.' },
  { match: /^choose a different supplier order from the one the line is on$/, message: () => 'Choose a different supplier order from the one the line is on.' },
  { match: /^name either an existing supplier order or a supplier to move the quantity to$/, message: () => 'Choose a supplier order or a supplier to move the quantity to.' },
  { match: /^split parts of an item must use different suppliers: (.+)$/, message: m => `Each part of "${m[1]}" needs a different supplier.` },
  { match: /^the quantity to move must be more than 0 and less than the line quantity \((.+?)\)$/, message: m => `Move more than 0 and less than ${m[1]}.` },
  { match: /^the supplier order is not a leg of this order$/, message: () => RELOAD },

  // Merges, roles, ownership
  { match: /^merge conflict: both companies have an RFQ with the same customer reference$/, message: () => 'Both companies have an RFQ with the same customer reference. Change one reference, then merge.' },
  { match: /^merge conflict: both companies have an order with the same customer PO number$/, message: () => 'Both companies have an order with the same customer PO number. Change one, then merge.' },
  { match: /^merge conflict: both companies were sent the same RFQ as supplier$/, message: () => 'Both companies were sent the same RFQ as supplier. Remove one of them from that RFQ, then merge.' },
  { match: /^merge needs two different (brands|companies)$/, message: m => `Choose two different ${m[1]} to merge.` },
  { match: /^a brand and a family cannot be merged$/, message: () => 'A brand and a family cannot be merged. Choose two brands or two families.' },
  { match: /^only an admin can (merge brands|merge companies|change who owns an RFQ|change who owns an order|resolve a value basis|change the legacy flags of an order|set legacy flags on an order|set legacy flags|change legacy flags)$/, message: () => ADMIN_ONLY },
  { match: /^the system must keep at least one active admin$/, message: () => 'Make someone else an admin first. The app always keeps one.', action: TEAM },
  { match: /^category "(.+?)" is inactive; pick an active category$/, message: m => `"${m[1]}" is archived. Pick another category, or bring it back in Settings, Expense categories.`, action: CATEGORIES },
  // 0086: groups, moves and merges (already written for people)
  { match: /^There is no expense group for this kind of expense\. Add a group first\.$/, action: CATEGORIES },
  { match: /^".+?" has expenses in .+? and that month is closed\. (Moving|Merging) it /, action: CATEGORIES },
  { match: /^The group ".+?" has categories, so its kind cannot change\./ },
  { match: /^Only an admin can merge categories\.$/, message: () => ADMIN_ONLY },
  { match: /^One of these categories is no longer there\./ },
  { match: /^Pick two different categories to merge\.$/ },
  { match: /^".+?" is archived\. Bring it back first, or merge into another category\.$/ },
  // 0091: misc ("Other") expenses take a typed title; a repeated title becomes a category
  { match: /^Write what it was for, e\.g\. Courier from shop to office$/ },
  { match: /^The "Other" category of a group is where one-off expenses go, / },
  { match: /^Only an admin can turn a one-off title into a category\.$/, message: () => ADMIN_ONLY },
  { match: /^No expense under ".+?" has that title any more\./ },
  { match: /^(Only the Other category of a group has one-off titles to promote\.|Choose which title to turn into a category\.|Give the new category a name\.)$/ },
  { match: /^".+?" is (the Other category of a group\. Choose a different name|a category of another kind, so these expenses cannot move there)/ },
  { match: /^".+?" is archived\. Bring it back first, or choose a different name\.$/ },
  // 0087: engineers' "I paid" claims (already written for people)
  { match: /^Only an admin approves an expense claim\.$/, message: () => ADMIN_ONLY },
  { match: /^Choose how it was paid: cash given back, from petty cash, or by bank\.$/ },
  { match: /^A supplier payment is recorded with Pay on the supplier order\.$/, help: 'pay-supplier' },
  { match: /^That claim was not found\.$/, message: () => RELOAD },
  { match: /^This claim is already (.+)\.$/, message: m => `This claim was already ${m[1] === 'rejected' ? 'not approved' : m[1]}. Reload the page.` },
  { match: /^the order has no unresolved value basis$/, message: () => 'This order has no value basis left to resolve. Reload the page.' },
  { match: /^basis must be net or gross$/, message: () => 'Choose net or gross.' },
  { match: /^a PSID is required$/, message: () => 'Enter the PSID, then save.' },

  // 0092 (owner decisions): fixing and removing mistakes. The server texts are already plain; each carries a HINT
  // (not_yours, admin_only, not_found, has_order, has_invoice, has_payment, has_expense, has_po, bank_ticked, voided,
  // correction_chain, not_latest, in_use, linked_to_order) that mapPgError passes on as `hint`.
  { match: /^Only the person who entered this, or an admin, can change it\.$/ },
  // 0101: an engineer's visit type, on a site assigned to them only (HINT not_assigned)
  { match: /^Only an engineer assigned to this order can set its visit time or type\.$/, message: () => 'You can set the visit type only on a site assigned to you. Nothing was saved. Ask an admin to assign you.' },
  // 0098: a product category is renamed and curated by an admin (HINT admin_only)
  { match: /^Only an admin can (rename or curate a|add a curated) product category\.$/, message: () => 'Only an admin can rename or curate a product category. Nothing was saved.' },
  { match: /^Only an admin can delete this\. Nothing was deleted\.$/, message: () => ADMIN_ONLY },
  { match: /^Only an admin can (see|do) this\.$/, message: () => ADMIN_ONLY },   // 0120: admin_health, confirm_backup_decrypt_test
  { match: /^This (RFQ|order|invoice|quotation|purchase order|company) is no longer there\. Reload the page\.$/ },
  { match: /^This RFQ has an order\. / },
  { match: /^This order has an invoice\. / },
  { match: /^This order has a payment recorded against it, a voided one included, / },
  { match: /^This order has an expense recorded against it\. / },
  { match: /^This order has an issued purchase order\. / },
  { match: /^This invoice has its tax deposit ticked against the (.+?) bank statement\. /, action: BANK },
  { match: /^This payment is part of a correction, so it is kept as history\./ },
  { match: /^Only the latest revision can be deleted\. / },
  { match: /^This company is used by RFQs, orders, invoices or expenses, / },
  { match: /^An order line is based on this item, / },
  { match: /^0092: /, internal: true },
  // 0112 to 0115 (money integrity): void and credit notes, the invoice rules in the database, duplicate payments, FX typos. The
  // server texts are already plain and each carries a HINT (use_void, filed, paid, month_closed, has_credit_note, over_credited,
  // gst_mismatch, over_invoiced, invoice_filed, invoice_void, duplicate_payment, fx_rate_far) that mapPgError passes on as `hint`.
  { match: /^A credit note is kept as it was issued\./ },
  { match: /^Only admin and sales can see credit note numbers\.$/, message: () => ADMIN_SALES },
  { match: /^Invoice (.+?) is void, so it cannot take a credit note\.$/ },
  { match: /^This invoice has no number, so a credit note cannot be issued against it\.$/ },
  { match: /^Credit notes on (.+?) would come to more than the invoice itself / },
  { match: /^The GST on this credit note / },
  { match: /^Only an admin can (issue a credit note|void an invoice)\.$/, message: () => ADMIN_ONLY },
  { match: /^Enter the amount to credit / },
  { match: /^Say why the (credit note is issued|invoice is voided)\.$/ },
  { match: /^Invoice (.+?) is already void\.$/ },
  { match: /^This invoice has no number\. Delete it instead of voiding it\.$/ },
  { match: /^Invoice (.+?) has a PSID or a tax deposit recorded, so it cannot be voided\. / },
  { match: /^Invoice (.+?) already has a credit note, so it cannot be voided\.$/ },
  { match: /^(.+?) is closed, so invoice (.+?) cannot be voided\. / , action: MONTH_END },
  { match: /^A payment is already applied to invoice (.+?), so it cannot be voided\. / },
  { match: /^Invoice (.+?) has a number, so it is kept\. Void it instead: / },
  { match: /^0113 stopped: /, internal: true },
  { match: /^Enter the invoice number\.$/ },
  { match: /^An invoice is voided (from its own screen|with Void on the invoice screen)/ },
  { match: /^Invoice (.+?) is void and cannot be changed\.$/ },
  { match: /^Invoice (.+?) has a PSID or a tax deposit recorded, so its number, date and amounts are fixed\. / },
  { match: /^Invoice (.+?) has a credit note, so its amounts are fixed\. / },
  { match: /^This invoice is for Rs (.+?) but only Rs (.+?) is left to invoice on this order\. / },
  { match: /^The GST on this invoice \(Rs / },
  { match: /^Only an admin records a payment\.$/, message: () => ADMIN_ONLY },
  { match: /^The withholding tax cannot be below zero\.$/ },
  { match: /^Looks like a payment already recorded on / },
  { match: /^Rs (.+?) for 1 (.+?) is more than 20 percent away from the latest rate / },
  { match: /^0115: /, internal: true },
  // 0121 (supplier debt on a cancelled order) and 0122 (reassign owner): already plain.
  { match: /^Only an admin cancels a supplier order with the supplier\./ },
  { match: /^That supplier order was not found\./ },
  { match: /^This supplier order was never placed, so there is nothing to cancel with the supplier\./ },
  { match: /^Only an admin can change who owns an enquiry, job or order\./ },
  { match: /^Choose a current salesperson or admin as the new owner\./ },
  { match: /^Only an admin can see a person's open work\./ },
  { match: /^Choose someone else to take the work over\./ },
  { match: /^Unknown kind /, internal: true },
  { match: /^Only an admin pays back an expense claim\./ },
  { match: /^This claim is not waiting to be paid back\./ },
  { match: /^That invoice is not on this order\./ },
  // 0096 (money truth): linking imported invoices to their orders, and the owner's review of imported records. Already plain.
  { match: /^Only an admin can link or review imported records\.$/, message: () => ADMIN_ONLY },
  { match: /^Imported record not found$/, message: () => RELOAD },
  { match: /^This record was not imported, so it has no review state\.$/ },
  { match: /^This invoice was not imported, so it cannot be (linked|unlinked) here\.$/ },
  { match: /^This invoice was paid before the new system started, so it has no order to link to\.$/ },
  { match: /^This invoice is already linked to an order\. Unlink it first\.$/ },
  { match: /^The invoice and the order belong to different customers\.$/ },
  { match: /^This invoice is not linked to an order\.$/ },
  { match: /^This invoice has no customer of its own, so it cannot be taken off its order\.$/ },

  // Not found
  { match: /^(RFQ|inquiry|order|order line|supplier order) (.+?) not found$/, message: () => RELOAD },
  { match: /^(brand|company) not found$/, message: () => RELOAD },

  // Programmer, import and migration-only
  { match: /^(convert_rfq_to_order|create_repeat_order|float_rfq|issue_purchase_order|issue_quotation|set_legacy_review|set_rfq_floated|split_order_item) needs /, internal: true },
  { match: /^0074: /, internal: true },
  { match: /^import_purge_audit: /, internal: true },
  { match: /^audit_archive\./, internal: true },
  { match: /^order_receivables is not available to the /, internal: true },
  { match: /^receivables_list: unknown state /, internal: true },
  { match: /^the value basis of an order is changed only by resolve_value_basis$/, internal: true },
]

/** The table entry for a server text, internal ones included (the test uses this). */
export function rpcEntry(text: string): { entry: RpcEntry; m: RegExpMatchArray } | null {
  const t = text.trim()
  for (const entry of RPC_MESSAGES) {
    const m = t.match(entry.match)
    if (m) return { entry, m }
  }
  return null
}

/** A plain message for a server rule text, or null when none is mapped or the entry is internal. */
export function rpcMessage(text: string): RpcMessage | null {
  const hit = rpcEntry(text)
  if (!hit || hit.entry.internal) return null
  const { entry, m } = hit
  return {
    message: entry.message ? entry.message(m) : text.trim(),
    ...(entry.help ? { help: entry.help } : {}),
    ...(entry.action ? { action: entry.action } : {}),
  }
}
