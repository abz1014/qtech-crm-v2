Q-TECH CRM: ADMIN (one page)

Money has four tabs: Who owes us, Invoices & GST, Expenses, Month end. "Reports" is at the top right of Money.
A number on a tab means "this many need you". The (i) next to a word explains it in one line.

1. PAYMENTS RECEIVED
 - Money opens on "Who owes us". Find the order, tap "Record payment" (on a phone: the button on its card).
 - The amount is the balance due; change it for a part payment. Save.
 - The balance is gross, GST included.

2. EXPENSES
 - Money, Expenses, "Add expenses" (one row or many).
 - Amount, then the category (type 2 or 3 letters). Enter adds a row. Ctrl+Enter saves all.
 - Paying a supplier: "Add expense" on that supplier order, on the order page.

3. INVOICES, TCS AND FBR
 - "Create invoice" on the order, or Money, Invoices & GST, "New invoice".
 - Tick the invoices, then "Sent by TCS today". Paste the PSID once, then "Deposited today".
 - "Needs attention" shows what is late.

4. MONTH END (first 10 days of the month; Today reminds you)
 - Money, Month end. Only the checks with something to look at are listed. Tap one to fix it:
   Match bank statement, Expenses without a category, Recurring expenses not recorded, Margin not final, GST not deposited with FBR, Payments not split, Things to check.
 - None blocks. Tap "Close <month>", then confirm.
 - Closed by mistake: "Reopen" under "Closed months". It is logged.

5. MATCH BANK STATEMENT
 - From the Month end checklist. Tap each line that is on your statement; a whole PSID group is one tap.
 - Compare "Ticked, money in" and "Ticked, money out" with the statement. Cash is never listed.

6. REPORTS
 - "Reports for <month>" on Month end, or Reports in Money. Arrows change the month.
 - Profit and loss, Expenses by category, Overdue by age, We owe suppliers, GST and FBR, Sales by person, Order margins.
 - Open shows it; Export CSV gives the exact figures (the screen shows whole rupees).

7. TEAM AND SETTINGS
 - Avatar menu, Settings (or type "Settings" in Search). Team: "Add person", then "Create account"; the password shows once.
 - Settings: Company (Team, Company profile, Targets, Expense categories, Exchange rates) and You (Your details, Change password).
 - On a phone, Settings is a list; the back arrow returns to it.

8. BACKUPS (every night, automatic)
 - A backup is made every night at 01:30. You only check it.
 - Weekly: GitHub, Actions, Backup. The latest run must be green.
 - Once a month: download the newest "backup-<date>", decrypt it with your private key (kept in the password manager and on the USB stick), confirm it opens.
 - Receipt files are not in the backup. Download them from Supabase, Storage, now and then.
 - If it fails twice, tell the orchestrator.
