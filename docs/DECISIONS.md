# Decision log

Dated decisions for Q-Tech CRM v2. One line each. All dated 2026-10-13 unless noted.
Changes to `DATA_MODEL.md` need an entry here first.

- 2026-10-13: Brand-new codebase in `qtech-crm-v2/` with its own git repo; the old repo is kept beside it as a read-only reference.
- 2026-10-13: New Supabase project on the free plan; Mumbai region recommended; whether to go Pro or rely on exports is decided before go-live.
- 2026-10-13: Stack kept: React, Vite, TypeScript, Tailwind, shadcn/Radix, TanStack Query, react-hook-form, Zod, Supabase, Vercel.
- 2026-10-13: No email delivery. Password reset is started by an admin. The app never sends email or WhatsApp; supplier enquiries are copied to the clipboard.
- 2026-10-13: The costing calculator is removed. Each order has one expected cost, plus expenses tagged to the order. An admin marks "costs complete"; margin stays provisional until then.
- 2026-10-13: Margin and targets are measured on NET (excluding GST). Receivable and settled are measured on GROSS. Customers pay the full gross amount and withhold nothing.
- 2026-10-13: GST is 18% by default per line; 0 means exempt. All invoices go to FBR; there is one register. FBR states: pending, generated, receipt received, deposited.
- 2026-10-13: Revenue is cash-basis for management reporting; the GST register is by invoice date. The two clocks are never combined.
- 2026-10-13: Costs never include recoverable input tax.
- 2026-10-13: Targets are per person, quarterly, on net cash received, using calendar quarters. Each user sees their own; admin sees all.
- 2026-10-13: Engineers work the full CRM. Money (payments, expenses, costs, margin, cash) is admin-only. Sales see invoices, the GST register and each order's balance.
- 2026-10-13: Removed from scope: costing engine, follow-up task table, prospects table, employees and attendance (the Salaries expense category stays), budgets, payables module, email and WhatsApp sending, product catalog, PDF generation, general ledger, AI features, and quote versioning (for the MVP).
- 2026-10-13: One RFQ may produce several orders. Orders need no RFQ (WhatsApp and repeat orders).
- 2026-10-13: Legacy PO 253074 Unit A and Unit B are merged into one order with two invoices; Sapphire batch A stays a separate order.
- 2026-10-13: The old company-level quarterly targets are dropped; per-person targets are entered at cutover.
- 2026-10-13: The Phase 4 trial uses real data, which is kept; backups are live before the trial starts.
- 2026-10-13: The new project's credentials are stored as GitHub protected-environment secrets.
- 2026-10-13: The owner signs off scope. There is no fixed deadline.
- 2026-10-13: Frontend quality: every UI task invokes the `frontend-design` skill. Design comes before code: the owner approves mockups (Claude Design artifacts) at two gates before UI primitives are built. Target feel is calm, precise and refined (Linear / Stripe / Vercel), not a default template and not the old glass/glow look.
- 2026-10-13: Any webfont is self-hosted; the CSP keeps `font-src 'self'`. The Google Fonts allowances in `vercel.json` are removed in P7 if unused.
- 2026-10-13: CSP `connect-src` and `img-src` currently allow `*.supabase.co`; P7 tightens them to the exact new project host.
- 2026-10-13: The FBR exception rule in `src/lib/fbr.ts` also flags "deposited without Wasif receipt". Whether the receipt always precedes the deposit is unverified; check against live data in import task I06 and narrow the rule if it produces false exceptions.
- 2026-10-13: Brand colours: deep green #1a7b46 for primary and green text; brand green #429446 for non-text only; success is teal.
