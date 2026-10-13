begin;
select plan(95);

-- Fixture users come from supabase/seed.sql.
-- admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04
-- The state logic is checked as the table owner with the admin's claims; the role checks switch to
-- `authenticated` further down. Dates are relative to today_pkt() so the test never goes stale.

-- ------------------------------------------------------------------ structure
select is((select count(*)::int from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
             and c.relname in ('v_order_items_total', 'v_company_roles', 'v_rfq_state', 'v_inquiry_state',
                               'v_invoice_state', 'v_gst_register')
             and coalesce(c.reloptions, '{}') @> array['security_invoker=true']), 6,
  'all S10 views of this file are security_invoker');
select ok(not exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
                      where c.oid in ('public.v_company_roles'::regclass, 'public.v_rfq_state'::regclass,
                                      'public.v_inquiry_state'::regclass, 'public.v_invoice_state'::regclass,
                                      'public.v_gst_register'::regclass, 'public.v_order_items_total'::regclass)
                        and a.grantee in (0, 'anon'::regrole::oid)),
  'anon and PUBLIC have no privileges on the views');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ------------------------------------------------------------------ fixtures: companies
insert into public.companies (id, name) values
  ('c0000000-0000-4000-8000-000000000001', 'Prospect Co'),
  ('c0000000-0000-4000-8000-000000000002', 'Customer Co'),
  ('c0000000-0000-4000-8000-000000000003', 'Cancelled Co'),
  ('c0000000-0000-4000-8000-000000000004', 'Inquiry Supplier'),
  ('c0000000-0000-4000-8000-000000000005', 'Both Co'),
  ('c0000000-0000-4000-8000-000000000006', 'Brand Supplier'),
  ('c0000000-0000-4000-8000-000000000007', 'Leg Supplier'),
  ('c0000000-0000-4000-8000-000000000008', 'Payee Co'),
  ('c0000000-0000-4000-8000-000000000009', 'Unrelated Co'),
  ('c0000000-0000-4000-8000-0000000000a1', 'Supplier One'),
  ('c0000000-0000-4000-8000-0000000000a2', 'Supplier Two'),
  ('c0000000-0000-4000-8000-0000000000a3', 'Supplier Three');
insert into public.brands (id, name) values ('c3000000-0000-4000-8000-000000000001', 'Belimo');

-- ------------------------------------------------------------------ fixtures: RFQs
-- r1 open, nothing floated, bid due in 4 days
-- r2 floated, awaiting; overdue; one question to ask
-- r3 partly covered, bid sent, one question waiting 6 days
-- r4 covered and won; answer to relay
-- r5 no offer anywhere, closed; answer already relayed
-- r6 closed AND has an order (clash -> won)
-- r7 closed only
-- r8 only a cancelled order -> still open
insert into public.rfqs (id, company_id, owner_id, due_on, quoted_on, closed_on, close_reason) values
  ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
   public.today_pkt() + 4, null, null, null),
  ('d0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
   public.today_pkt() - 1, null, null, null),
  ('d0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
   null, public.today_pkt() - 2, null, null),
  ('d0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002',
   null, null, null, null),
  ('d0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
   null, null, public.today_pkt() - 3, 'competitor'),
  ('d0000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002',
   null, null, public.today_pkt() - 3, 'price'),
  ('d0000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
   public.today_pkt() - 10, null, public.today_pkt() - 3, 'we_were_late'),
  ('d0000000-0000-4000-8000-000000000008', 'c0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002',
   null, null, null, null);
insert into public.rfq_items (id, rfq_id, description) values
  ('d1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'r2 item'),
  ('d1000000-0000-4000-8000-000000000031', 'd0000000-0000-4000-8000-000000000003', 'r3 item one'),
  ('d1000000-0000-4000-8000-000000000032', 'd0000000-0000-4000-8000-000000000003', 'r3 item two'),
  ('d1000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000004', 'r4 item'),
  ('d1000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000005', 'r5 item');

-- orders: an active one for Customer Co (r4 and r6) and a cancelled one for Cancelled Co (r8)
insert into public.orders (id, company_id, owner_id, rfq_id, cancelled_on) values
  ('a1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002',
   'd0000000-0000-4000-8000-000000000004', null),
  ('a1000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002',
   'd0000000-0000-4000-8000-000000000006', null),
  ('a1000000-0000-4000-8000-000000000008', 'c0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002',
   'd0000000-0000-4000-8000-000000000008', public.today_pkt() - 1);

-- inquiries (supplier columns avoid unique clashes per RFQ)
insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on, no_offer_on, chase_count, last_relayed_at) values
  ('e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-0000000000a1',
   public.today_pkt() - 2, null, 0, null),                                    -- sent, awaiting
  ('e0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-0000000000a2',
   null, null, 0, null),                                                      -- shortlisted
  ('e0000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-0000000000a3',
   public.today_pkt() - 2, null, 0, null),                                    -- sent, has an open question
  ('e0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-0000000000a1',
   public.today_pkt() - 5, null, 2, null),                                    -- chased twice, quoted 1 of 2
  ('e0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-0000000000a1',
   public.today_pkt() - 5, null, 0, null),                                    -- quoted, answer to relay
  ('e0000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-0000000000a1',
   public.today_pkt() - 5, public.today_pkt() - 1, 0, now() + interval '1 hour');  -- no offer, relayed
insert into public.supplier_quote_lines (inquiry_id, rfq_item_id, unit_price, currency) values
  ('e0000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000031', 10, 'USD'),
  ('e0000000-0000-4000-8000-000000000004', 'd1000000-0000-4000-8000-000000000004', 10, 'USD');

-- clarifications
insert into public.clarifications (id, rfq_id, raised_by_inquiry_id, question, first_asked_at, last_asked_at,
                                   answer, answered_at, withdrawn_at) values
  -- r2: to ask (never asked)
  ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', null, 'To ask?', null, null, null, null, null),
  -- r2: raised by inquiry 6, still open
  ('b0000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000006',
   'Supplier asks?', null, null, null, null, null),
  -- r3: asked 6 days ago, waiting
  ('b0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000003', null, 'Waiting?',
   now() - interval '8 days', now() - interval '6 days', null, null, null),
  -- r3: withdrawn, must not count
  ('b0000000-0000-4000-8000-000000000033', 'd0000000-0000-4000-8000-000000000003', null, 'Withdrawn?',
   now() - interval '8 days', now() - interval '8 days', null, null, now()),
  -- r4: answered, raised by inquiry 4, not yet relayed
  ('b0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000004',
   'Answered?', now() - interval '3 days', now() - interval '3 days', 'Yes', now() - interval '1 day', null),
  -- r5: answered, raised by inquiry 5, relayed after the answer
  ('b0000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000005',
   'Relayed?', now() - interval '3 days', now() - interval '3 days', null, now() - interval '2 days', null);

-- supplier roles
insert into public.supplier_inquiries (rfq_id, supplier_id)
  values ('d0000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000004'),
         ('d0000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000005');
insert into public.company_brands (company_id, brand_id)
  values ('c0000000-0000-4000-8000-000000000006', 'c3000000-0000-4000-8000-000000000001');
insert into public.supplier_orders (order_id, supplier_id)
  values ('a1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000007');
insert into public.expenses (amount_pkr, category, payee_id)
  values (10, 'Freight', 'c0000000-0000-4000-8000-000000000008');
insert into public.rfqs (company_id, owner_id)
  values ('c0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000002');

-- ------------------------------------------------------------------ v_company_roles
select is((select role from public.v_company_roles where name = 'Prospect Co'), 'prospect',
  'company with only RFQs is a prospect');
select ok((select is_prospect and is_customer and not is_supplier from public.v_company_roles where name = 'Prospect Co'),
  'prospect flags');
select is((select role from public.v_company_roles where name = 'Customer Co'), 'customer',
  'company with a live order is a customer');
select ok((select not is_prospect from public.v_company_roles where name = 'Customer Co'),
  'a customer with a live order is not a prospect');
select is((select role from public.v_company_roles where name = 'Cancelled Co'), 'prospect',
  'only a cancelled order leaves the company a prospect');
select is((select role from public.v_company_roles where name = 'Inquiry Supplier'), 'supplier',
  'an inquiry makes a supplier');
select is((select role from public.v_company_roles where name = 'Both Co'), 'both',
  'a company with an RFQ and an inquiry is both');
select is((select role from public.v_company_roles where name = 'Brand Supplier'), 'supplier',
  'a company_brands row makes a supplier');
select is((select role from public.v_company_roles where name = 'Leg Supplier'), 'supplier',
  'a supplier order makes a supplier');
select is((select role from public.v_company_roles where name = 'Payee Co'), 'supplier',
  'an expense payee is a supplier (visible to admin)');
select is((select role from public.v_company_roles where name = 'Unrelated Co'), null,
  'a company with no relations has no role');

-- ------------------------------------------------------------------ v_rfq_state: outcome, bid, deadline
select is((select outcome from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000001'), 'open', 'r1 is open');
select is((select outcome from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000004'), 'won',
  'an RFQ with a live order is won');
select is((select outcome from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000005'), 'closed',
  'an RFQ with closed_on and no order is closed');
select ok((select outcome = 'won' and outcome_clash from public.v_rfq_state
           where rfq_id = 'd0000000-0000-4000-8000-000000000006'),
  'a closed RFQ that has an order shows as won and flags the clash');
select ok((select not outcome_clash from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000005'),
  'a plain closed RFQ has no clash');
select is((select outcome from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000008'), 'open',
  'a cancelled order does not win the RFQ');
select is((select bid_state from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000001'), 'to_bid',
  'no quoted_on means to_bid');
select is((select bid_state from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000003'), 'bid_sent',
  'quoted_on set means bid_sent');
select is((select days_to_due from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000001'), 4,
  'days_to_due counts from today in Karachi');
select ok((select not is_overdue from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000001'),
  'a future due date is not overdue');
select ok((select is_overdue and days_to_due = -1 from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000002'),
  'a passed due date on an open RFQ is overdue');
select ok((select not is_overdue from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000007'),
  'a closed RFQ is never overdue');
select is((select days_to_due from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000003'), null,
  'no due date, no days_to_due');

-- sourcing
select is((select sourcing_state from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000001'),
  'not_floated', 'sourcing: not floated');
select is((select sourcing_state from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000002'),
  'floated_awaiting', 'sourcing: floated, awaiting');
select is((select sourcing_state from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000003'),
  'partly_covered', 'sourcing: partly covered');
select is((select sourcing_state from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000004'),
  'covered', 'sourcing: covered');
select is((select sourcing_state from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000005'),
  'no_offer_anywhere', 'sourcing: no offer anywhere');
select is((select items_uncovered::int from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000003'), 1,
  'an item every responder skipped is uncovered');
select is((select items_uncovered::int from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000002'), 0,
  'with no responder there is nothing uncovered yet');

-- clarification dimension
select is((select clarification_state from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000002'),
  'to_ask', 'clarification: to ask');
select is((select to_ask::int from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000002'), 2,
  'both unasked questions count (own and supplier-raised)');
select is((select clarification_state from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000003'),
  'waiting_on_customer', 'clarification: waiting on customer');
select ok((select waiting = 1 and waiting_days = 6 and to_ask = 0 from public.v_rfq_state
           where rfq_id = 'd0000000-0000-4000-8000-000000000003'),
  'one question waiting, asked 6 days ago; the withdrawn one does not count');
select is((select clarification_state from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000004'),
  'answers_to_relay', 'clarification: answers to relay');
select is((select to_relay::int from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000004'), 1,
  'an answered supplier question not yet relayed counts');
select is((select clarification_state from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000005'),
  'none', 'clarification: none once the answer has been relayed');
select is((select clarification_state from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000001'),
  'none', 'clarification: none when there are no questions');

-- ------------------------------------------------------------------ v_inquiry_state
select is((select contact_state from public.v_inquiry_state where inquiry_id = 'e0000000-0000-4000-8000-000000000002'),
  'shortlisted', 'inquiry contact: shortlisted');
select is((select contact_state from public.v_inquiry_state where inquiry_id = 'e0000000-0000-4000-8000-000000000001'),
  'sent', 'inquiry contact: sent');
select ok((select contact_state = 'chased' and chase_count = 2 from public.v_inquiry_state
           where inquiry_id = 'e0000000-0000-4000-8000-000000000003'),
  'inquiry contact: chased x2');
select is((select response_state from public.v_inquiry_state where inquiry_id = 'e0000000-0000-4000-8000-000000000001'),
  'awaiting', 'inquiry response: awaiting');
select ok((select response_state = 'quoted' and items_quoted = 1 and items_total = 2
                  and quote_received_on = public.today_pkt()
           from public.v_inquiry_state where inquiry_id = 'e0000000-0000-4000-8000-000000000003'),
  'inquiry response: quoted 1 of 2 items, with the first quote date');
select is((select response_state from public.v_inquiry_state where inquiry_id = 'e0000000-0000-4000-8000-000000000005'),
  'no_offer', 'inquiry response: no offer');
select is((select blocked_state from public.v_inquiry_state where inquiry_id = 'e0000000-0000-4000-8000-000000000006'),
  'open_questions', 'inquiry blocked: open questions');
select is((select blocked_state from public.v_inquiry_state where inquiry_id = 'e0000000-0000-4000-8000-000000000004'),
  'answers_waiting', 'inquiry blocked: answers waiting to relay');
select is((select blocked_state from public.v_inquiry_state where inquiry_id = 'e0000000-0000-4000-8000-000000000005'),
  'none', 'inquiry blocked: none after relaying');
select is((select blocked_state from public.v_inquiry_state where inquiry_id = 'e0000000-0000-4000-8000-000000000001'),
  'none', 'inquiry blocked: none without questions');

-- ------------------------------------------------------------------ invoices: courier, FBR, register
-- this month = today; last month = the day before this month starts
insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount,
                             copy_received_on, tcs_sent_on, client_received_on, psid, wasif_receipt_on,
                             tax_deposited_on, legacy_flags, last_reminded_on, reminder_count) values
  -- courier ladder, FBR pending
  ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'I-1', public.today_pkt(),
   100, 18, null, null, null, null, null, null, '{}', null, 0),
  ('b1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'I-2', public.today_pkt(),
   100, 18, public.today_pkt(), null, null, null, null, null, '{}', null, 0),
  ('b1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'I-3', public.today_pkt(),
   100, 18, public.today_pkt(), public.today_pkt(), null, null, null, null, '{}', public.today_pkt(), 2),
  ('b1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'I-4', public.today_pkt(),
   100, 18, public.today_pkt(), public.today_pkt(), public.today_pkt(), null, null, null, '{}', null, 0),
  -- sent with no copy_received: still "sent" (furthest step)
  ('b1000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'I-5', public.today_pkt(),
   100, 18, null, public.today_pkt(), null, null, null, null, '{}', null, 0),
  -- FBR ladder
  ('b1000000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000001', 'F-GEN', public.today_pkt(),
   100, 18, null, null, null, 'PSID123', null, null, '{}', null, 0),
  ('b1000000-0000-4000-8000-000000000012', 'a1000000-0000-4000-8000-000000000001', 'F-LEG', public.today_pkt(),
   100, 18, null, null, null, null, null, null, array['fbr_generated_legacy'], null, 0),
  ('b1000000-0000-4000-8000-000000000013', 'a1000000-0000-4000-8000-000000000001', 'F-REC', public.today_pkt(),
   100, 18, null, null, null, 'PSID123', public.today_pkt(), null, '{}', null, 0),
  ('b1000000-0000-4000-8000-000000000014', 'a1000000-0000-4000-8000-000000000001', 'F-DEP', public.today_pkt(),
   100, 18, null, null, null, 'PSID123', public.today_pkt(), public.today_pkt(), '{}', null, 0),
  ('b1000000-0000-4000-8000-000000000015', 'a1000000-0000-4000-8000-000000000001', 'F-BLANK', public.today_pkt(),
   100, 18, null, null, null, '   ', null, null, '{}', null, 0),
  -- exceptions: a later step without an earlier one
  ('b1000000-0000-4000-8000-000000000016', 'a1000000-0000-4000-8000-000000000001', 'F-X1',
   public.today_pkt(), 100, 18, null, null, null, null, null, public.today_pkt(), '{}', null, 0),
  ('b1000000-0000-4000-8000-000000000017', 'a1000000-0000-4000-8000-000000000001', 'F-X2',
   public.today_pkt(), 100, 18, null, null, null, null, public.today_pkt(), null, '{}', null, 0),
  ('b1000000-0000-4000-8000-000000000018', 'a1000000-0000-4000-8000-000000000001', 'F-X3',
   public.today_pkt(), 100, 18, null, null, null, 'PSID123', null, public.today_pkt(), '{}', null, 0),
  -- last month: undeposited needs attention; deposited does not
  ('b1000000-0000-4000-8000-000000000021', 'a1000000-0000-4000-8000-000000000001', 'M-OLD',
   (date_trunc('month', public.today_pkt()) - interval '1 day')::date, 100, 18, null, null, null, 'PSID123', null, null,
   '{}', null, 0),
  ('b1000000-0000-4000-8000-000000000022', 'a1000000-0000-4000-8000-000000000001', 'M-OLD-DEP',
   (date_trunc('month', public.today_pkt()) - interval '1 day')::date, 100, 18, null, null, null, 'PSID123',
   public.today_pkt(), public.today_pkt(), '{}', null, 0);
insert into public.invoices (id, company_id, invoice_date, net_amount, gst_amount, legacy_flags)
  values ('b1000000-0000-4000-8000-000000000031', 'c0000000-0000-4000-8000-000000000009', null, 50, 9, array['undated']);

select is((select courier_state from public.v_invoice_state where invoice_id = 'b1000000-0000-4000-8000-000000000001'),
  'not_started', 'courier: not started');
select is((select courier_state from public.v_invoice_state where invoice_id = 'b1000000-0000-4000-8000-000000000002'),
  'copy_received', 'courier: copy received');
select is((select courier_state from public.v_invoice_state where invoice_id = 'b1000000-0000-4000-8000-000000000003'),
  'sent', 'courier: sent (the normal resting state; client_received_on is optional)');
select is((select courier_state from public.v_invoice_state where invoice_id = 'b1000000-0000-4000-8000-000000000004'),
  'delivered_to_client', 'courier: delivered to client when client_received_on is set');
select is((select courier_state from public.v_invoice_state where invoice_id = 'b1000000-0000-4000-8000-000000000005'),
  'sent', 'courier: the furthest step wins even if copy_received_on is empty');
select is((select fbr_state from public.v_invoice_state where invoice_id = 'b1000000-0000-4000-8000-000000000001'),
  'pending', 'FBR: pending');
select is((select fbr_state from public.v_invoice_state where invoice_id = 'b1000000-0000-4000-8000-000000000011'),
  'generated', 'FBR: generated when a PSID is set');
select is((select fbr_state from public.v_invoice_state where invoice_id = 'b1000000-0000-4000-8000-000000000012'),
  'generated', 'FBR: generated through the fbr_generated_legacy flag with no PSID');
select is((select fbr_state from public.v_invoice_state where invoice_id = 'b1000000-0000-4000-8000-000000000013'),
  'receipt_received', 'FBR: receipt received');
select is((select fbr_state from public.v_invoice_state where invoice_id = 'b1000000-0000-4000-8000-000000000014'),
  'deposited', 'FBR: deposited');
select is((select fbr_state from public.v_invoice_state where invoice_id = 'b1000000-0000-4000-8000-000000000015'),
  'pending', 'FBR: a blank PSID does not count as generated');
select ok((select not fbr_exception from public.v_invoice_state where invoice_id = 'b1000000-0000-4000-8000-000000000012'),
  'the legacy flag alone is not an exception');
select ok((select not fbr_exception from public.v_invoice_state where invoice_id = 'b1000000-0000-4000-8000-000000000014'),
  'a complete ladder is not an exception');
select ok((select fbr_state = 'deposited' and fbr_exception from public.v_invoice_state
           where invoice_id = 'b1000000-0000-4000-8000-000000000016'),
  'deposited with no PSID shows as deposited and is an exception');
select ok((select fbr_state = 'receipt_received' and fbr_exception from public.v_invoice_state
           where invoice_id = 'b1000000-0000-4000-8000-000000000017'),
  'receipt with no PSID is an exception');
select ok((select fbr_state = 'deposited' and fbr_exception from public.v_invoice_state
           where invoice_id = 'b1000000-0000-4000-8000-000000000018'),
  'deposited without a receipt is an exception');
select ok((select needs_fbr_attention from public.v_invoice_state where invoice_id = 'b1000000-0000-4000-8000-000000000021'),
  'an undeposited invoice from a past month needs FBR attention');
select ok((select not needs_fbr_attention from public.v_invoice_state where invoice_id = 'b1000000-0000-4000-8000-000000000022'),
  'a deposited invoice from a past month does not');
select ok((select not needs_fbr_attention from public.v_invoice_state where invoice_id = 'b1000000-0000-4000-8000-000000000001'),
  'an invoice from this month does not');
select ok((select not needs_fbr_attention from public.v_invoice_state where invoice_id = 'b1000000-0000-4000-8000-000000000031'),
  'an undated legacy invoice does not');
select ok((select gross_amount = 118 from public.v_invoice_state where invoice_id = 'b1000000-0000-4000-8000-000000000001'),
  'gross is net plus GST');
select ok((select reminder_state = 'reminded' and reminder_count = 2 and last_reminded_on = public.today_pkt()
           from public.v_invoice_state where invoice_id = 'b1000000-0000-4000-8000-000000000003'),
  'reminder: reminded x2 with the last date');
select is((select reminder_state from public.v_invoice_state where invoice_id = 'b1000000-0000-4000-8000-000000000001'),
  'not_reminded', 'reminder: not reminded');

-- GST register
select is((select count(*)::int from public.v_gst_register), (select count(*)::int from public.invoices),
  'the register lists every invoice, including the unlinked one');
select ok((select company_name = 'Customer Co' and order_number is not null and invoice_month = date_trunc('month', public.today_pkt())::date
           from public.v_gst_register where invoice_id = 'b1000000-0000-4000-8000-000000000001'),
  'register row carries the company, the order and the month');
select is((select company_name from public.v_gst_register where invoice_id = 'b1000000-0000-4000-8000-000000000031'),
  'Unrelated Co', 'an unlinked invoice takes its company from company_id');
select is((select fbr_state from public.v_gst_register where invoice_id = 'b1000000-0000-4000-8000-000000000012'),
  'generated', 'the register carries the FBR state');

-- ------------------------------------------------------------------ roles
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select cmp_ok((select count(*)::int from public.v_rfq_state), '>=', 8, 'sales reads v_rfq_state');
select cmp_ok((select count(*)::int from public.v_invoice_state), '>=', 15, 'sales reads v_invoice_state');
select cmp_ok((select count(*)::int from public.v_gst_register), '>=', 15, 'sales reads v_gst_register');
select is((select role from public.v_company_roles where name = 'Payee Co'), null,
  'a payee-only company has no role for sales (expenses are admin-only)');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select cmp_ok((select count(*)::int from public.v_rfq_state), '>=', 8, 'engineer reads v_rfq_state');
select cmp_ok((select count(*)::int from public.v_inquiry_state), '>=', 6, 'engineer reads v_inquiry_state');
select cmp_ok((select count(*)::int from public.v_company_roles), '>=', 12, 'engineer reads v_company_roles');
select is((select count(*)::int from public.v_invoice_state), 0, 'engineer gets 0 rows from v_invoice_state');
select is((select count(*)::int from public.v_gst_register), 0, 'engineer gets 0 rows from v_gst_register');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.v_rfq_state), 0, 'deactivated user gets 0 rows from v_rfq_state');
select is((select count(*)::int from public.v_inquiry_state), 0, 'deactivated user gets 0 rows from v_inquiry_state');
select is((select count(*)::int from public.v_company_roles), 0, 'deactivated user gets 0 rows from v_company_roles');
select is((select count(*)::int from public.v_invoice_state), 0, 'deactivated user gets 0 rows from v_invoice_state');
select is((select count(*)::int from public.v_gst_register), 0, 'deactivated user gets 0 rows from v_gst_register');

reset role;
set local role anon;
select throws_ok($$select * from public.v_rfq_state$$, '42501', null, 'anon cannot read v_rfq_state');
select throws_ok($$select * from public.v_invoice_state$$, '42501', null, 'anon cannot read v_invoice_state');
select throws_ok($$select * from public.v_gst_register$$, '42501', null, 'anon cannot read v_gst_register');
reset role;

select * from finish();
rollback;
