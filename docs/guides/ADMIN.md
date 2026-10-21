Q-TECH CRM: ADMIN (one page)

Money has four tabs: Who owes us, Invoices & GST, Expenses, Month end. "Reports" is at the top right of Money.
A number beside a tab means "this many need you". The (i) next to a word explains it in one line.
Press ? on a computer to see the keyboard shortcuts.

1. EXPENSES, QUICK ENTRY
 - Money, Expenses, "Add expenses" (one row or many).
 - Row: Amount, PKR. Category (type 2 or 3 letters). Date (today). Paid via (Bank or Cash). Note. Receipt photo.
 - Enter adds a row. Tab moves along. Ctrl+Enter saves all.
 - Phone: tap the Receipt photo button to open the camera.
 - From an order: open the supplier's menu under Supplier orders and tap "Pay <supplier>". It starts at what is still owed.

2. PAYMENTS RECEIVED
 - Money opens on "Who owes us" (the same page and name for sales). Find the order.
 - Tap "Record payment" (on a phone, the button on the order's card; also beside the payment reminder).
 - Enter "Amount received, PKR", "Date received", "Paid via", optionally a Reference. Save.
 - The balance is gross, GST included.

3. INVOICE, GST AND FBR STAMPS
 - Money, "Invoices & GST". "Create invoice" there or on an order.
 - Open an invoice to add the "Consignment number", "Receipt file" and Notes.
 - Parcel sent by TCS: tick the invoices, tap "Sent to customer today".
 - Tax deposited: paste the PSID ("Add PSID"), then "Deposited today". Add "Deposit amount, PKR".
 - FBR receipt: open the invoice, "Add receipt".

4. MONTH END (first 10 days of the month; Today reminds you)
 - Money, Month end. Only the checks with something to look at are listed; tap one to fix it. None blocks.
 - Tap "Close <month>" (for example "Close October"). Confirm. Done.
 - Closed by mistake: "Reopen" in "Closed months". It is logged.
 - Closed months freeze payments, expenses and invoices dated in them (bank matching still works).

5. MATCH BANK STATEMENT
 - Money, Month end, "Match bank statement". Pick the Statement month with the arrows.
 - Tap each item that appears on your bank statement. FBR deposits sharing a PSID tick together in one tap.
 - Compare "Ticked, money in" and "Ticked, money out" with the statement totals.
 - Goal: "Everything ticked". Cash items are never listed.

6. REPORTS
 - "Reports for <month>" on Month end, or "Reports" in Money. The arrows change the month.
 - Profit and loss, Expenses by category, Overdue by age, We owe suppliers, GST and FBR, Sales by person, Order margins.
 - "Open" shows one; "Export CSV" gives the exact figures (the screen shows whole rupees).
 - Margins and "Things to check" are also linked from the Month end list when they need you.

7. TEAM AND SETTINGS
 - Avatar menu, Settings, Team: "Add person" (Full name, Email, Role, Job title, Phone), then "Create account". The password shows once; give it in person.
 - Per person: Change role, Edit phone, Edit job title, Reset password, Deactivate (at least one admin always stays).
 - Settings is in two groups: Company (Team, Company profile, Targets, Expense categories, Exchange rates) and You (Your details, Change password). On a phone, Settings is a list and the back arrow returns to it.

8. BACKUPS (every night, automatic)
 - A backup is made every night at 01:30. You only check it.
 - Weekly: GitHub, Actions, Backup. The latest run must be green.
 - Once a month: download the newest "backup-<date>", decrypt it with your private key (kept in the password manager and on the USB stick), confirm it opens.
 - Receipt files are not in the backup. Download them from Supabase, Storage, now and then.
 - If it fails twice, tell the orchestrator.
