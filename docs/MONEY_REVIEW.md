# Money review (P9, 2026-10-19)

A correctness review of the money and bookkeeping maths before the owner runs the company books on the app. Scope: the money
migrations, views and functions, the money screens' pure rules, the order and PO totals, and the shared money, date and CSV helpers.
Read against DATA_MODEL (sections 2.13 to 2.18, 5, 5a, A3, A6, A7, A8), BUILD_PLAN A6 and DECISIONS.

Every bug below was first proved by a test that failed on main (commit `99103bf`: CI run 39209427419, DB run 39209427442, which
reports pgTAP `0058_money_review` failing 6 of 9), then fixed with the smallest change. The tests are
`src/features/money/moneyReview.test.ts` (MR-1 to MR-5) and `supabase/tests/0058_money_review.test.sql` (MR-6, MR-7).

## Bugs found and fixed

| # | Where | Bug | Proof (test) | Fix |
|---|---|---|---|---|
| MR-1 | `src/lib/money.ts` | No exact helper for qty x price, so callers multiplied floats. `1 x 1.005 x 100` is `100.49999999999999`: it rounds to 1.00 where Postgres `round(1.005, 2)` gives 1.01. | `MR-1 exact decimal products` | New `productPaisa(qty, price)` and `gstWholeRupeesPaisa(net, rate)`: decimal text to bigint, half away from zero, the same as numeric. |
| MR-2 | `orders/lib/orderMath.ts` (order items table, convert dialog total, resolve-basis preview) | Line net was `Math.round(qty x price x 100)` in floats. About 1.25% of (one-decimal qty, 2-decimal price) pairs disagree with `v_order_items_total` by a paisa, e.g. 0.1 x 0.35 shows 0.03, the database says 0.04; 0.1 x 21.95 shows 2.19, the database 2.20. | `MR-2 order line display matches v_order_items_total` | `lineNetPaisa` / `lineGstPaisa` use the exact helpers. |
| MR-3 | `purchaseOrders/lib/prefill.ts`, the PO PDF, the PO preview total | Same float product on the supplier PO: the Issue PO dialog, the preview and the **printed PO sent to the supplier** could show a line and a total a cent below the stored `purchase_orders.total` (`purchase_order_set_total`, 0022). USD 1.005 x 1 printed 1.00. | `MR-3 PO line totals match purchase_order_set_total` | `lineTotal`, `poTotal` and a new `poLineAmounts` (used by the PDF and the preview) are exact. |
| MR-4 | `money/lib/costEstimate.ts` (expected-cost suggestion) | A line on an issued PO was costed at the **PO's** quantity. A8 allows a split after the PO; the moved part then counted twice (on the old leg through the stale PO and on the new leg). 10 on a PO at 100, 4 split off at 90: suggested 1,360 instead of 960. | `MR-4 expected-cost suggestion after a split` | The PO's price times the line's current quantity. |
| MR-5 | `money/invoices` (Create invoice) | On an order mixing 18% and exempt lines, typing a smaller net for a part invoice left the GST at the whole remaining GST (for example 90 GST on a 500 part of a 1,000 / 90 order). | `MR-5 part invoice on a mixed-rate order` | `gstForNet`: 18% and exempt as before; mixed shares the remaining GST in proportion to the net typed (whole rupees). The person can still pick 18% or Exempt. |
| MR-6 | `next_invoice_number()` (0044) | `lpad()` truncates: after `INV-9999` it suggested `INV-1000` (an existing number; the unique index then refuses every save). A legacy bare series `99` suggested `10`. | pgTAP `MR-6` (tests 1, 2; test 3 guards the padding) | 0058: pad to `greatest(width, length)`. |
| MR-7 | `v_invoice_state.needs_fbr_attention` (0014), `month_end_status` `fbr_pending` (0028) | An exempt invoice (GST 0) has no tax to deposit, but every one from a past month was flagged "tax not deposited" in the GST register for ever, and counted on the month-end checklist and Today's close-month item. | pgTAP `MR-7` (tests 5, 6, 7, 9; tests 4 and 8 guard the 18% case and `gst_to_deposit`) | 0058: both also need `gst_amount > 0`. Same columns and signatures, so grants, the access matrix (S14) and the generated types are unchanged. |

## Owner decisions (2026-10-19) and what was built

| # | Decision | Built (migration 0058 unless noted) | Proof |
|---|---|---|---|
| D-MR1 | Accept per-line GST rounding; a split may move GST by about Rs 1. | Split line dialog wording: "Order totals stay the same, give or take Rs 1 of GST rounding". DECISIONS entry. | (wording only) |
| D-MR2 | Freeze a closed month's figures at close. | `month_snapshots` (written by a trigger on `closed_months`, deleted with it on reopen); `v_month_pnl` and `month_end_status` serve a closed month from it; `v_month_pnl_live` keeps the live figures; drift after a close is shown in the first open month after the last closed one as "Changes to closed months" (`adj_*`, `adjust_result`); `close_months_through` closes oldest first. The Month-end screens and CSVs read the snapshot for payments, categories, how paid, team, aging and we owe (as of the month's last day) and the GST month (filing columns stay live). | pgTAP `0058_money_review` D-MR2 (close, later edit, closed P&L unchanged, change shown in February, books still sum, frozen checklist, reopen recalculates, close again re-saves, sales read nothing); unit `MR-8` (P&L CSV adjustment row) |
| D-MR3 | A cancelled order stays in receivables only when it has an invoice. | `order_receivables()` filters; the Receivables page no longer drops cancelled orders itself, so it and Today agree. | pgTAP D-MR3 |
| D-MR4 | We owe is strict. | `payables_as_of`: paid is net cost; a rate over 30 days before the as-of date is unusable ("Needs a rate"). | pgTAP D-MR4 |

The four questions as they were put to the owner:

1. **Splitting a line can change the order's GST by a rupee.** GST is rounded to whole rupees per line (DATA_MODEL 2.13, still
   marked PROPOSED). A split makes two lines, each rounded: 2 x 25.00 at 18% is GST 9 on one line, but 5 + 5 = 10 on two. A8 and
   the Split dialog say "order totals do not change"; that is true to the rupee only. A fractional quantity can also move the net by
   a paisa. Options: (a) accept it (the Rs 1 allowance already absorbs it in "settled"); (b) round GST per order and rate instead of
   per line (changes 2.13, `v_order_items_total`, the quotation totals and the PDFs together); (c) round a split group (same RFQ
   item, price and rate) as one line. Recommendation: (a) until the 2.13 validation against the live GST invoices is done.
2. **A closed month's P&L is derived, not frozen.** The lock stops payments, expenses and invoice amounts dated in the month from
   changing, but `net_in` is recalculated from the order's basis every time (5a, by design). It can still move after the close when,
   for an order with a payment in that month: the first invoice is created or a later one deleted (basis items -> invoice), the price
   basis of a legacy order is resolved (unresolved -> net), or the lines are edited before invoicing (for example the exempt toggle).
   For single-rate orders the change is at most rounding; an exempt toggle moves it fully. Options: accept; or snapshot each month's
   P&L at close (`closed_months` keeps the figures); or lock line edits on orders with payments in a closed month.
3. **Cancelled orders and receivables disagree between screens.** `order_receivables()` returns cancelled orders. Receivables
   drops every cancelled order, including one that was invoiced and still owes (Create invoice allows invoicing a cancelled order
   "to record what was already supplied"), while Today's "payment overdue" keeps it. Pick one rule; suggested: keep a cancelled
   order only when it has an invoice (its balance is real), in the function, so both screens agree.
4. **Payables are approximate in two ways the spec allows:** `paid` is the bank debit (`amount_pkr`, so recoverable input tax
   counts as paid to the supplier), and the rate is the latest on or before the date with no age limit (a two-year-old USD rate
   would be used). Confirm, or use net cost and the 30-day "unusable" rule.

## Smaller notes (not changed)

- Burst entry: input tax above the amount is not stopped before saving; the database CHECK refuses the whole batch with a generic
  message (nothing is saved wrongly).
- An exempt invoice still reads FBR state "pending" in the register (it is no longer flagged); a "not needed" state would be clearer.
- GST register CSV has no UTF-8 byte order mark, so Excel on Windows may garble non-ASCII customer names. Its numbers are plain (no
  separators), and negative numbers stay numbers (the formula guard only prefixes text).
- `v_gst_month.psid_set_count` counts a blank PSID; the app always trims to NULL, so it is not reachable from the screens.
- Ranking texts round a negative spread with `Math.round` (towards plus infinity); display only, labelled "≈".
- The Month-end checklist and report tabs (M10) and their CSV are not built yet (only Bank tick is); `v_month_pnl`, `aging_as_of`,
  `payables_as_of`, `v_gst_month` and `v_month_team` were reviewed in SQL only.

## Checks made, with no bug found

**Rounding and paisa.** `lib/money` (`toPaisa`, `sumPaisa`, `paisaToFixed`, `formatPaisa`, `convertToPaisa`: bigint, half away from
zero); quotation totals (already exact); invoice GST `gstOn` (an exact half at 18% needs a net that is a multiple of 25, which floats
hold exactly; checked by brute force); resolve-basis preview `price / 1.18` (brute force 0.01 to 20,000.00: no difference from
numeric); bank tick sums (bigint); receivables, margins and expense list totals (float sums rounded to paisa for display).

**Gross, net and GST.** `v_order_items_total` (line net to 2 decimals, GST whole rupees per line, exempt 0); `v_order_basis`
(invoice basis once any invoice exists, else items); `v_payment_net` (`round(amount x N / G, 2)`, GST = remainder, exclusions
basis_unknown / zero_value / unattributed and which totals each leaves); `my_target_progress_at` repeats the same maths;
`v_order_money` and `order_receivables` (settled against gross with the Rs 1 allowance, receivable and overpaid never netted,
`due_on` = first invoice + terms); `invoiceStart` (what is left after earlier invoices).

**18% versus exempt; input tax.** Exempt lines add the same to N and G, so a fully exempt payment is all net. Input tax: margin and P&L
use `amount_pkr - input_tax_pkr`; `cash_out_total` and bank ticks use the full debit; `v_gst_month` shows input tax separately
(admin only, NULL for sales) and never nets it against output GST; the expense dialog and burst sheet send input tax only for
Supplier payment, Freight and Clearing.

**Partial payments, over-payments, advances, aging.** `paymentNote` (settles within Rs 1, part, over); `aging_as_of` FIFO to the
oldest invoice by date then number, remaining gross bucketed 0-30 / 31-60 / 61-90 / 90+, advances on uninvoiced orders listed
separately, never negative, money above the invoiced total not shown as an advance, unlinked legacy invoices never receive payments.

**Double counting.** An expense is one row: tagged to an order it is order cost once, and the same row is "paid" on its leg in
payables (different reports, never added together). Supplier legs: the expense dialog clears the leg when the order changes, so a leg
is never tagged without its order. `v_month_pnl` groups each expense once by its category's group.

**Cancelled orders.** Excluded from margins, invoiceable orders, payables (cancelled on or before the date), provisional-margin
checklist, ranking history, repeat-customer report; included on purpose in cash (`v_cash_month`, `v_month_pnl`: cash is cash) and
flagged by reconciliation ("payment on a cancelled order"). See decision 3 above for receivables.

**FX.** `v_fx_latest` (on or before today, manual beats auto on the same day, bands 7 / 30); `rank_item_quotes` (PKR price only from a
fresh or stale rate, `unusable` and `none` give no PKR and are not comparable when the item mixes currencies; spread = selling net
minus PKR price, NULL for engineers); cost estimate (rates over 30 days are not used, unconverted currencies listed); Issue PO PKR
hint (`unusable` not converted); `convertToPaisa` rate to 6 decimals.

**Split lines (A8).** `split_order_item` keeps quantity (source minus moved, `0 < qty < line qty`), copies selling price and GST rate,
never copies the other supplier's price; convert-dialog parts and remainder; `groupItems` sums group quantity. Net and GST: see
decision 1.

**Month lock on every write path.** Lock triggers on `payments_in`, `expenses`, `invoices` fire before insert, update and delete and
check the old and the new date (moving into or out of a closed month is refused); trigger order is lock first. Bank ticks
(`bank_month`, `tax_bank_month`) and filing stamps stay editable, and only they (payments and expenses compare the whole row minus
`bank_month`). The expense bulk upsert (`ON CONFLICT DO NOTHING`) still runs the insert trigger. Recurring "record" is refused in a
closed month. `close_month` refuses the current or a future month (Karachi date) and an earlier open month with rows;
`close_months_through` and `reopen_month` are admin only and audited. No service-role bypass.

**Dates and Asia/Karachi.** SQL money dates are `date` columns; "today" is `today_pkt()`; `date_trunc('month', date)::date` round-trips
in the session zone, so months never shift. Client "today" is `businessToday()` (Intl, Asia/Karachi); month ends, shifts, due dates
and statement months use UTC calendar arithmetic on the date parts; no money path uses `toISOString().slice(0, 10)` or local
`getMonth`. Quarter boundaries for targets use the Karachi date (00:30 PKT on 1 April is Q2).

**Invoice numbers, PO prefill.** `next_invoice_number` (prefix and width from the most recent invoice, highest number plus one;
MR-6); `po_line_prefill` (same sources and order as `issue_purchase_order`, already compared by its pgTAP test).

**CSV.** `generateCSV` writes finite numbers as numbers (a negative amount stays a number), guards text against formulas, escapes
quotes; DataTable exports money as plain numbers to the paisa with no thousands separators; the GST register exports raw numbers.
