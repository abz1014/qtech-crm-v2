Q-TECH CRM: ADMIN (one page)

Money has tabs: GST register, Receivables, Expenses, Margins, Exceptions, Month-end.

1. EXPENSES, QUICK ENTRY
 - Money, Expenses, "Add expenses".
 - Row: Amount, PKR. Category (type 2 or 3 letters). Date (today). Paid via (Bank or Cash). Note. Receipt photo.
 - Enter adds a row. Tab moves along. Ctrl+Enter saves all.
 - Phone: tap the Receipt photo button to open the camera.
 - One expense: "Add expense". From an order: "Add expense" on the order page.

2. PAYMENTS RECEIVED
 - Money, Receivables ("Order balances" for sales). Find the order.
 - Tap "Record payment".
 - Enter "Amount received, PKR", "Date received", "Paid via", optionally a Reference. Save.
 - The balance is gross, GST included.

3. INVOICE, GST AND FBR STAMPS
 - Money, GST register. "New invoice" or "Create invoice" from an order.
 - Open an invoice to add the "Consignment number", "Receipt file" and Notes.
 - Parcel sent by TCS: tap "Sent by TCS today".
 - Tax deposited: paste the PSID ("Add PSID"), then "Deposited today". Add "Deposit amount, PKR".
 - FBR receipt: open the invoice, "Add receipt".

4. BANK TICK
 - Money, Month-end, Bank tick. Pick the Statement month with the arrows.
 - Tap each item that appears on your bank statement. FBR deposits sharing a PSID tick together in one tap.
 - Compare "Ticked, money in" and "Ticked, money out" with the statement totals.
 - Goal: "Everything ticked". Cash items are never ticked.

5. MONTH-END CLOSE
 - Money, Month-end, Checklist. Read the warnings; tap one to fix it. None blocks.
 - Reports in the same strip: P&L, Expenses by category, Aging, We owe, GST/FBR, Team. Each has CSV export.
 - Tap "Close <month>" (for example "Close October"). Confirm. Done.
 - Closed by mistake: "Reopen" in "Closed months". It is logged.
 - Closed months freeze payments, expenses and invoices dated in them (bank ticks still work).

6. TEAM AND SETTINGS
 - Settings, Team: "Add person" (Full name, Email, Role, Job title, Phone), then "Create account". The password shows once; give it in person.
 - Per person: Change role, Edit phone, Edit job title, Reset password, Deactivate (at least one admin always stays).
 - Settings also has: Company profile, Targets, Expense categories, Exchange rates, Change password.

7. BACKUPS (every night, automatic)
 - A backup is made every night at 01:30. You only check it.
 - Weekly: GitHub, Actions, Backup. The latest run must be green.
 - Once a month: download the newest "backup-<date>", decrypt it with your private key (kept in the password manager and on the USB stick), confirm it opens.
 - Receipt files are not in the backup. Download them from Supabase, Storage, now and then.
 - If it fails twice, tell the orchestrator.
