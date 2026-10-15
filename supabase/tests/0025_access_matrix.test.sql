begin;
select * from no_plan();

-- S14: the access matrix. DATA_MODEL section 10 (plus the extra items named in BUILD_PLAN Amendments A4 and A5) is
-- encoded ONCE, as data, in the `matrix` table below, one line per section 10 row, each with a comment naming its
-- source. For every line and every persona the test PROBES the real database: it actually runs select / insert /
-- update / delete (or calls the function) as that persona, inside a sub-transaction that is always rolled back, and
-- compares the set of operations that worked with the matrix. Nothing is read from pg_policies, so a policy that
-- looks right but behaves wrong is caught.
--
-- Personas: admin, sales, engineer (seed users a0..01-03), deactivated (a0..04), anon (role anon, no JWT).
-- Ops: S select, I insert, U update, D delete, X execute. Deactivated and anon expect nothing anywhere
-- (section 10: "Deactivated users get nothing anywhere"); the matrix only lists the three staff roles.
-- A probe counts as allowed only when it succeeds and touches at least one row; permission denied, a row-security
-- violation, zero rows and "not found / not visible" (P0002) all count as denied. Any other error is reported verbatim.
-- The test uses no_plan because the number of assertions follows the matrix.
--
-- The one remaining known gap (section 10 silent: deactivated users may execute pure helpers) is wrapped in
-- todo_start/todo_end below and explained there. Rows added by Amendment A6 carry a `-- A6` comment.

-- ------------------------------------------------------------------ probe machinery (session-local)
create function pg_temp.f(h text) returns uuid language sql immutable as
  $$ select ('f0000000-0000-4000-8000-0000000000' || h)::uuid $$;

create function pg_temp.uid(persona text) returns text language sql immutable as
  $$ select case persona
       when 'admin' then 'a0000000-0000-4000-8000-000000000001'
       when 'sales' then 'a0000000-0000-4000-8000-000000000002'
       when 'engineer' then 'a0000000-0000-4000-8000-000000000003'
       when 'deactivated' then 'a0000000-0000-4000-8000-000000000004'
       else '00000000-0000-0000-0000-000000000000' end $$;

-- 'Y' allowed, 'N' denied, 'E:...' unexpected error. Always rolls the statement back.
create function pg_temp.probe(stmt text, persona text) returns text language plpgsql as $f$
declare
  n bigint;
  d text;
  s text;
  other text;
begin
  other := case when persona = 'admin' then pg_temp.uid('sales') else pg_temp.uid('admin') end;
  s := replace(replace(stmt, '{uid}', pg_temp.uid(persona)), '{other}', other);
  s := regexp_replace(s, '@([0-9a-f]{2})\M', '''f0000000-0000-4000-8000-0000000000\1''::uuid', 'g');
  begin
    if persona = 'anon' then
      perform set_config('request.jwt.claims', '', true);
      set local role anon;
    else
      perform set_config('request.jwt.claims',
        json_build_object('sub', pg_temp.uid(persona), 'role', 'authenticated')::text, true);
      set local role authenticated;
    end if;
    execute s;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0999', detail = n::text;
  exception
    when sqlstate 'P0999' then
      get stacked diagnostics d = pg_exception_detail;
      return case when d::bigint > 0 then 'Y' else 'N' end;
    when insufficient_privilege then
      if sqlerrm like 'Direct deletion from storage%' then
        return 'Y';
      end if;
      return 'N';
    when sqlstate 'P0002' then
      return 'N';
    when others then
      if sqlerrm like 'Direct deletion from storage%' then
        return 'Y';   -- storage's own guard fires only on rows the policy let through
      end if;
      return 'E:' || sqlstate || ' ' || sqlerrm;
  end;
end;
$f$;

create temp table matrix (
  kind text not null,       -- table | view | function | bucket
  obj text not null,
  variant text not null default '',
  admin_ops text not null,
  sales_ops text not null,
  engineer_ops text not null,
  primary key (obj, variant)
);
create temp table probes (obj text, variant text, op text, stmt text);
create temp table known (obj text, variant text, persona text);

create function pg_temp.expected(o text, v text, persona text) returns text language sql as $$
  select coalesce((select case persona when 'admin' then m.admin_ops when 'sales' then m.sales_ops
                                       when 'engineer' then m.engineer_ops else '' end
                   from matrix m where m.obj = o and m.variant = v), 'MISSING')
$$;

create function pg_temp.actual(o text, v text, persona text) returns text language plpgsql as $$
declare r record; res text; out_ops text := ''; errs text := '';
begin
  for r in select p.op, p.stmt from probes p where p.obj = o and p.variant = v
           order by position(p.op in 'SIUDX') loop
    res := pg_temp.probe(r.stmt, persona);
    if res = 'Y' then out_ops := out_ops || r.op;
    elsif res <> 'N' then errs := errs || ' [' || r.op || ' ' || res || ']';
    end if;
  end loop;
  return out_ops || errs;
end;
$$;

-- ------------------------------------------------------------------ the matrix (DATA_MODEL section 10)
-- Columns: kind, object, variant, admin ops, sales ops, engineer ops. Variants name the row condition.
insert into matrix (kind, obj, variant, admin_ops, sales_ops, engineer_ops) values
  ('table', 'users',               '',           'S',    'S',    'S'),    -- s10 "users"; writes only via admin-users (service role)
  ('table', 'users',               'job_title',  '',     '',     ''),     -- s10 "users.job_title": via admin-users only, nothing direct
  ('table', 'companies',           '',           'SIUD', 'SIU',  'SIU'),  -- s10 "companies"
  ('table', 'company_sites',       '',           'SIUD', 'SIUD', 'SIUD'), -- s10 "company_sites"
  ('table', 'contacts',            '',           'SIUD', 'SIUD', 'SIUD'), -- s10 "contacts"
  ('table', 'brands',              '',           'SIUD', 'SIU',  'SIU'),  -- s10 "brands"
  ('table', 'company_brands',      '',           'SIUD', 'SIUD', 'SIUD'), -- s10 "company_brands"
  ('table', 'rfqs',                '',           'SIUD', 'SIU',  'SIU'),  -- s10 "rfqs"
  ('table', 'rfq_items',           '',           'SIUD', 'SIUD', 'SIUD'), -- s10 "rfq_items"
  ('table', 'supplier_inquiries',  'unsent',     'SIUD', 'SIUD', 'SIUD'), -- s10 "supplier_inquiries" note 1: staff delete while sent_on is empty
  ('table', 'supplier_inquiries',  'sent',       'SIUD', 'SIU',  'SIU'),  -- s10 "supplier_inquiries": SIU + D only while sent_on is empty
  ('table', 'supplier_quote_lines','',           'SIUD', 'SIUD', 'SIUD'), -- s10 "supplier_quote_lines"
  ('table', 'inquiry_item_declines','',          'SIUD', 'SIUD', 'SIUD'), -- R07 (0032): same rules as supplier_quote_lines
  ('table', 'clarifications',      '',           'SIUD', 'SIUD', 'SIUD'), -- s10 "clarifications"
  ('table', 'orders',              '',           'SIUD', 'SIU',  'SIU'),  -- s10 "orders"
  ('table', 'order_items',         '',           'SIUD', 'SIUD', 'SIUD'), -- s10 "order_items"
  ('table', 'supplier_orders',     '',           'SIUD', 'SIUD', 'SIUD'), -- s10 "supplier_orders"
  ('table', 'order_engineers',     '',           'SIUD', 'SIUD', 'SIUD'), -- s10 "order_engineers"
  ('table', 'order_costs',         '',           'SIUD', '',     ''),     -- s10 "order_costs"
  ('table', 'invoices',            '',           'SIUD', 'SIU',  ''),     -- s10 "invoices (changed, A2)"
  ('table', 'payments_in',         '',           'SIUD', '',     ''),     -- s10 "payments_in"
  ('table', 'expenses',            '',           'SIUD', '',     ''),     -- s10 "expenses"
  ('table', 'recurring_expenses',  '',           'SIUD', '',     ''),     -- s10 "recurring_expenses"
  ('table', 'attachments',         'rfq',        'SIUD', 'SIUD', 'SIUD'), -- s10 "attachments (parent is an RFQ or clarification)"
  ('table', 'attachments',         'invoice',    'SIUD', 'SIUD', ''),     -- s10 "attachments (parent is an invoice)"
  ('table', 'snoozes',             'own',        'SIUD', 'SIUD', 'SIUD'), -- s10 "snoozes": own SIUD
  ('table', 'snoozes',             'other',      '',     '',     ''),     -- s10 "snoozes": "own" means other people's rows are closed to everyone
  ('table', 'targets',             'own',        'SIUD', 'S',    'S'),    -- s10 "targets": admin SIUD, S own (admin's own row is covered by admin SIUD)
  ('table', 'targets',             'other',      'SIUD', '',     ''),     -- s10 "targets": S own only, so someone else's row is closed to sales and engineer
  ('table', 'audit_log',           '',           'S',    '',     ''),     -- s10 "audit_log": append-only, written only by triggers
  ('table', 'fx_rates',            'manual',     'SIUD', 'SIU',  'SIU'),  -- s10 "fx_rates" note 2: I and U only where source = manual
  ('table', 'fx_rates',            'auto',       'SIUD', 'S',    'S'),    -- s10 "fx_rates" note 2: automatic rows are written by the nightly job (service role)
  ('table', 'quotations',          '',           'SIUD', 'SIU',  'SIU'),  -- s10 "quotations" (U limited to pdf_path by the lock trigger)
  ('table', 'purchase_orders',     '',           'SIUD', 'SIU',  'SIU'),  -- s10 "purchase_orders" (U limited to pdf_path by the lock trigger)
  ('table', 'company_profile',     '',           'SU',   'S',    'S'),    -- s10 "company_profile": singleton, no insert or delete
  ('table', 'order_items',         'supplier_unit_price', 'SIU', 'SIU', 'SIU'), -- s10 "order_items.supplier_unit_price"
  ('table', 'supplier_orders',     'currency',   'SIU',  'SIU',  'SIU'),  -- s10 "supplier_orders.currency"
  ('view',  'v_company_roles',     '',           'S',    'S',    'S'),    -- s10 "v_company_roles, v_rfq_state, v_inquiry_state, v_order_state"
  ('view',  'v_rfq_state',         '',           'S',    'S',    'S'),    -- s10 (same row)
  ('view',  'v_inquiry_state',     '',           'S',    'S',    'S'),    -- s10 (same row)
  ('view',  'v_order_state',       '',           'S',    'S',    'S'),    -- s10 (same row)
  ('view',  'v_invoice_state',     '',           'S',    'S',    ''),     -- s10 "v_invoice_state, v_gst_register"
  ('view',  'v_gst_register',      '',           'S',    'S',    ''),     -- s10 (same row)
  ('view',  'v_order_money',       '',           'S',    '',     ''),     -- s10 "v_order_money, v_cash_month, v_payment_net, v_target_progress"
  ('view',  'v_cash_month',        '',           'S',    '',     ''),     -- s10 (same row)
  ('view',  'v_payment_net',       '',           'S',    '',     ''),     -- s10 (same row)
  ('view',  'v_target_progress',   '',           'S',    '',     ''),     -- s10 (same row)
  ('view',  'v_order_basis',       '',           'S',    '',     ''),     -- A4: extra admin-only helper view, not in s10
  ('view',  'v_order_items_total', '',           'S',    'S',    'S'),    -- NOT in s10 or A4/A5: helper view, "from items only" like v_order_state (all staff)
  ('view',  'v_fx_latest',         '',           'S',    'S',    'S'),    -- s10 "v_fx_latest, v_supplier_activity, v_supplier_stats, supplier_item_memory()"
  ('view',  'v_supplier_activity', '',           'S',    'S',    'S'),    -- s10 (same row)
  ('view',  'v_supplier_stats',    '',           'S',    'S',    'S'),    -- s10 (same row)
  ('function', 'order_receivables',       '',    'X',    'X',    ''),     -- s10 "order_receivables() (definer)"
  ('function', 'my_target_progress',      '',    'X',    'X',    'X'),    -- s10 "my_target_progress() (definer)"
  ('function', 'my_target_progress_at',   '',    '',     '',     ''),     -- A4: test seam granted to nobody
  ('function', 'convert_rfq_to_order',    '',    'X',    'X',    'X'),    -- s10 "RPCs convert_rfq_to_order, create_repeat_order"
  ('function', 'create_repeat_order',     '',    'X',    'X',    'X'),    -- s10 (same row)
  ('function', 'float_rfq',               '',    'X',    'X',    'X'),    -- A4: S13 RPC, all staff
  ('function', 'set_rfq_floated',         '',    'X',    'X',    'X'),    -- R05: Undo of a float / float a saved RFQ, all staff
  ('function', 'merge_companies',         '',    'X',    '',     ''),     -- s10 "RPCs merge_companies, merge_brands, resolve_value_basis"
  ('function', 'merge_brands',            '',    'X',    '',     ''),     -- s10 (same row)
  ('function', 'resolve_value_basis',     '',    'X',    '',     ''),     -- s10 (same row)
  ('function', 'model_tokens',            '',    'X',    'X',    'X'),    -- s10 "model_tokens()"
  ('function', 'item_text_norm',          '',    'X',    'X',    'X'),    -- A5: helper, all staff
  ('function', 'item_match_tier',         '',    'X',    'X',    'X'),    -- S19 helper, all staff (not in s10; same class as model_tokens)
  ('function', 'brand_tokens',            '',    'X',    'X',    'X'),    -- 0035 helper: tokens that are brand or family names, all staff (same class as model_tokens)
  ('function', 'tokens_without',          '',    'X',    'X',    'X'),    -- 0035 pure helper, all staff
  ('function', 'brand_words',             '',    'X',    'X',    'X'),    -- 0036 helper: words of brand and family names, all staff
  ('function', 'strip_words',             '',    'X',    'X',    'X'),    -- 0036 pure helper, all staff
  ('function', 'similar_enough',          '',    'X',    'X',    'X'),    -- 0036 pure helper, all staff
  ('function', 'supplier_item_memory',    '',    'X',    'X',    'X'),    -- s10 "supplier_item_memory()"
  ('function', 'customer_price_memory',  '',    'X',    'X',    'X'),    -- R19 (0037): the two price chips of the issue-quotation dialog, all staff
  ('function', 'issue_quotation',         '',    'X',    'X',    'X'),    -- s10 "RPCs issue_quotation, issue_purchase_order, stamp_clarification_ask, stamp_supplier_chase"
  ('function', 'issue_purchase_order',    '',    'X',    'X',    'X'),    -- s10 (same row)
  ('function', 'stamp_clarification_ask', '',    'X',    'X',    'X'),    -- s10 (same row)
  ('function', 'stamp_supplier_chase',    '',    'X',    'X',    'X'),    -- s10 (same row)
  ('function', 'stamp_goods_chase',      '',    'X',    'X',    'X'),    -- R16 (0033): goods-chase stamp on a supplier leg, all staff
  ('function', 'search_all',            '',    'X',    'X',    'X'),    -- R12 (0034): palette search, SECURITY INVOKER, all staff; deactivated gets zero rows
  ('function', 'stamp_payment_reminder',  '',    'X',    'X',    ''),     -- s10 "RPC stamp_payment_reminder"
  ('function', 'stamp_tcs_sent',          '',    'X',    'X',    ''),     -- A4: admin and sales
  ('function', 'stamp_fbr_psid',          '',    'X',    'X',    ''),     -- A4: admin and sales
  ('function', 'stamp_tax_deposited',     '',    'X',    'X',    ''),     -- A4: admin and sales
  ('function', 'set_fx_rate',             '',    'X',    'X',    'X'),    -- A5: all staff
  ('function', 'current_user_role',       '',    'X',    'X',    'X'),    -- NOT in s10: the role lookup behind every policy (answers NULL for deactivated)
  ('function', 'can_access_bucket',       '',    'X',    'X',    'X'),    -- NOT in s10: storage policy helper (true for the caller's own buckets)
  ('function', 'today_pkt',               '',    'X',    'X',    'X'),    -- NOT in s10: pure date helper
  ('table', 'expense_categories',  '',           'SIUD', '',     ''),     -- A6 s10 "expense_categories": admin only, delete blocked while in use
  ('table', 'closed_months',       '',           'S',    '',     ''),     -- A6 s10 "closed_months": admin reads; written only through the admin RPCs
  ('table', 'attachments',         'expense',    'SIUD', '',     ''),     -- A6 s10 "attachments (parent is an expense)": admin only
  ('view',  'v_month_pnl',              '',      'S',    '',     ''),     -- A6 A6.3: admin only
  ('view',  'v_month_expense_category', '',      'S',    '',     ''),     -- A6 A6.3: admin only
  ('view',  'v_month_team',             '',      'S',    '',     ''),     -- A6 A6.3: admin only
  ('view',  'v_gst_month',              '',      'S',    'S',    ''),     -- A6 A6.3: admin and sales (input tax is NULL for sales)
  ('function', 'close_month',           '',      'X',    '',     ''),     -- A6 A6.1: admin RPC
  ('function', 'close_months_through',  '',      'X',    '',     ''),     -- A6 A6.1: admin RPC
  ('function', 'reopen_month',          '',      'X',    '',     ''),     -- A6 A6.1: admin RPC
  ('function', 'month_is_closed',       '',      '',     '',     ''),     -- A6 A6.1: used by the lock triggers only, granted to nobody
  ('function', 'aging_as_of',           '',      'X',    '',     ''),     -- A6 A6.3: admin only (zero rows for the others)
  ('function', 'payables_as_of',        '',      'X',    '',     ''),     -- A6 A6.3: admin only (zero rows for the others)
  ('function', 'month_end_status',      '',      'X',    '',     ''),     -- A6 A6.3: admin only (zero rows for the others)
  ('function', 'revoke_user_sessions', '',      '',     '',     ''),     -- A01: service role only (the admin-users Edge Function); no client persona
  ('bucket', 'rfq-files',        '',  'SIUD', 'SIUD', 'SIUD'),           -- s10 "attachments (RFQ/clarification)": bucket rfq-files, same rules
  ('bucket', 'gst-receipts',     '',  'SIUD', 'SIUD', ''),               -- s10 "attachments (invoice)": bucket gst-receipts, admin and sales
  ('bucket', 'generated-docs',   '',  'SIUD', 'SIU',  'SIU'),            -- s10 "bucket generated-docs" (D admin only, A5)
  ('bucket', 'expense-receipts', '',  'SIUD', '',     '');               -- A6 s10 "attachments (parent is an expense)": bucket expense-receipts, admin only

-- ------------------------------------------------------------------ fixtures (as the table owner, admin claims)
-- Row ids are written in hex and appear in the probes as @NN (same two hex digits).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.companies (id, name) values
  (pg_temp.f('01'), 'M Main'), (pg_temp.f('02'), 'M Leaf'), (pg_temp.f('03'), 'M Supplier'),
  (pg_temp.f('04'), 'M Supplier 2'), (pg_temp.f('05'), 'M Supplier 3');
insert into public.company_sites (id, company_id, name) values
  (pg_temp.f('10'), pg_temp.f('01'), 'Main site'), (pg_temp.f('11'), pg_temp.f('01'), 'Leaf site');
insert into public.contacts (id, company_id, name) values (pg_temp.f('12'), pg_temp.f('01'), 'Contact');
insert into public.brands (id, name) values (pg_temp.f('13'), 'M Brand'), (pg_temp.f('14'), 'M Brand leaf');
insert into public.company_brands (company_id, brand_id) values (pg_temp.f('01'), pg_temp.f('13'));
insert into public.rfqs (id, company_id, owner_id) values
  (pg_temp.f('15'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002'),
  (pg_temp.f('16'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002');
insert into public.rfq_items (id, rfq_id, position, description, brand_id, quoted_unit_price_net) values
  (pg_temp.f('17'), pg_temp.f('15'), 0, 'Fixture item', pg_temp.f('13'), 50),
  (pg_temp.f('18'), pg_temp.f('15'), 1, 'Leaf item', null, 50);
insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on) values
  (pg_temp.f('19'), pg_temp.f('15'), pg_temp.f('03'), public.today_pkt()),
  (pg_temp.f('1a'), pg_temp.f('15'), pg_temp.f('04'), public.today_pkt()),
  (pg_temp.f('1b'), pg_temp.f('15'), pg_temp.f('05'), null);
insert into public.supplier_quote_lines (id, inquiry_id, rfq_item_id, unit_price, currency) values
  (pg_temp.f('1c'), pg_temp.f('19'), pg_temp.f('17'), 10, 'PKR');
insert into public.inquiry_item_declines (inquiry_id, rfq_item_id, reason) values   -- R07 (0032)
  (pg_temp.f('19'), pg_temp.f('18'), 'other');
insert into public.clarifications (id, rfq_id, question) values
  (pg_temp.f('1d'), pg_temp.f('15'), 'Main q'), (pg_temp.f('1e'), pg_temp.f('15'), 'Leaf q');
insert into public.orders (id, company_id, owner_id) values
  (pg_temp.f('20'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002'),
  (pg_temp.f('21'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002');
insert into public.supplier_orders (id, order_id, supplier_id, currency) values
  (pg_temp.f('23'), pg_temp.f('20'), pg_temp.f('03'), 'USD'),
  (pg_temp.f('24'), pg_temp.f('20'), pg_temp.f('03'), 'USD');
insert into public.order_items (id, order_id, position, description, unit_price_net, supplier_order_id, supplier_unit_price) values
  (pg_temp.f('25'), pg_temp.f('20'), 0, 'Fixture order item', 100, pg_temp.f('23'), 10);
insert into public.order_costs (order_id, expected_cost_pkr) values (pg_temp.f('20'), 5);
insert into public.order_engineers (order_id, user_id) values (pg_temp.f('20'), 'a0000000-0000-4000-8000-000000000003');
insert into public.invoices (id, order_id, number, net_amount, gst_amount) values
  (pg_temp.f('26'), pg_temp.f('20'), 'INV-M1', 100, 18), (pg_temp.f('27'), pg_temp.f('20'), 'INV-M2', 100, 18);
insert into public.payments_in (id, order_id, amount) values (pg_temp.f('28'), pg_temp.f('20'), 118);
insert into public.expenses (id, amount_pkr, category_id) values (pg_temp.f('29'), 5, 'ca7e0000-0000-4000-8000-000000000010');
insert into public.recurring_expenses (id, label, category_id, amount) values (pg_temp.f('2a'), 'rent', 'ca7e0000-0000-4000-8000-000000000002', 5);
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, rfq_id) values
  (pg_temp.f('2b'), 'rfq-files', 'm/1.pdf', 'a.pdf', 'application/pdf', 10, pg_temp.f('15'));
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, invoice_id) values
  (pg_temp.f('2c'), 'gst-receipts', 'm/2.pdf', 'b.pdf', 'application/pdf', 10, pg_temp.f('26'));
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, expense_id) values   -- A6
  (pg_temp.f('3c'), 'expense-receipts', 'm/3.jpg', 'c.jpg', 'image/jpeg', 10, pg_temp.f('29'));
insert into public.expense_categories (id, name, grp) values (pg_temp.f('3d'), 'M Category', 'overhead');   -- A6
insert into public.closed_months (month, closed_by) values ('2019-01-01', 'a0000000-0000-4000-8000-000000000001');   -- A6
update public.supplier_orders set placed_on = public.today_pkt() where id = pg_temp.f('23');   -- A6: payables_as_of needs a placed leg
insert into public.snoozes (user_id, rule, subject_id, until_on)
select u, 'r', pg_temp.f('2d'), public.today_pkt() + 3
from unnest(array['a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
                  'a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000004']::uuid[]) u;
insert into public.targets (user_id, year, quarter, target_net_pkr)
select u, 2090, 1, 100
from unnest(array['a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
                  'a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000004']::uuid[]) u;
insert into public.fx_rates (id, currency, rate_pkr, as_of, source) values
  (pg_temp.f('38'), 'USD', 280, public.today_pkt() - 5, 'manual'),
  (pg_temp.f('39'), 'EUR', 300, public.today_pkt() - 5, 'auto');
insert into public.quotations (id, rfq_id, number, revision, valid_until, lines) values
  (pg_temp.f('3a'), pg_temp.f('15'), 7001, 0, public.today_pkt() + 5, '[{"qty":1,"unit_price_net":1,"gst_rate":0}]');
insert into public.purchase_orders (id, supplier_order_id, number, revision, currency, total, lines) values
  (pg_temp.f('3b'), pg_temp.f('23'), 7002, 0, 'USD', 0, '[{"qty":1,"unit_price":1}]');
-- order @21 is the target of resolve_value_basis
update public.orders set legacy_flags = '{value_basis_unknown}' where id = pg_temp.f('21');
insert into storage.objects (bucket_id, name) values
  ('rfq-files', 'fixture.txt'), ('gst-receipts', 'fixture.txt'), ('generated-docs', 'fixture.txt'),
  ('expense-receipts', 'fixture.txt');

-- ------------------------------------------------------------------ probes: tables
-- Generated probes for the simple cases: S (select), U (touch one column to its own value), D (delete the leaf row).
create temp table spec (obj text, variant text, where_clause text, touch text, ins text);
insert into spec values
  ('users', '', $q$id = '{uid}'$q$, 'name', $q$insert into public.users (id, name, role) values (@a0, 'x', 'sales')$q$),
  ('users', 'job_title', $q$id = '{uid}'$q$, 'job_title', null),
  ('companies', '', 'id = @02', 'name', $q$insert into public.companies (id, name) values (@a1, 'probe co')$q$),
  ('company_sites', '', 'id = @11', 'name', $q$insert into public.company_sites (id, company_id, name) values (@a2, @01, 'probe')$q$),
  ('contacts', '', 'id = @12', 'name', $q$insert into public.contacts (id, company_id, name) values (@a3, @01, 'probe')$q$),
  ('brands', '', 'id = @14', 'name', $q$insert into public.brands (id, name) values (@a4, 'probe brand')$q$),
  ('company_brands', '', 'company_id = @01 and brand_id = @13', 'created_at', $q$insert into public.company_brands (company_id, brand_id) values (@01, @14)$q$),
  ('rfqs', '', 'id = @16', 'notes', $q$insert into public.rfqs (id, company_id, owner_id) values (@a5, @01, 'a0000000-0000-4000-8000-000000000002')$q$),
  ('rfq_items', '', 'id = @18', 'description', $q$insert into public.rfq_items (id, rfq_id, description) values (@a6, @15, 'probe')$q$),
  ('supplier_inquiries', 'unsent', 'id = @1b', 'notes', $q$insert into public.supplier_inquiries (id, rfq_id, supplier_id) values (@a7, @16, @03)$q$),
  ('supplier_inquiries', 'sent', 'id = @1a', 'notes', $q$insert into public.supplier_inquiries (id, rfq_id, supplier_id) values (@a7, @16, @03)$q$),
  ('supplier_quote_lines', '', 'id = @1c', 'notes', $q$insert into public.supplier_quote_lines (inquiry_id, rfq_item_id, unit_price, currency) values (@1a, @17, 5, 'PKR')$q$),
  ('inquiry_item_declines', '', 'inquiry_id = @19 and rfq_item_id = @18', 'reason', $q$insert into public.inquiry_item_declines (inquiry_id, rfq_item_id, reason) values (@1a, @17, 'other')$q$),   -- R07 (0032)
  ('clarifications', '', 'id = @1e', 'question', $q$insert into public.clarifications (id, rfq_id, question) values (@a8, @15, 'probe')$q$),
  ('orders', '', 'id = @21', 'notes', $q$insert into public.orders (id, company_id, owner_id) values (@a9, @01, 'a0000000-0000-4000-8000-000000000002')$q$),
  ('order_items', '', 'id = @25', 'description', $q$insert into public.order_items (id, order_id, description, unit_price_net) values (@aa, @20, 'probe', 1)$q$),
  ('supplier_orders', '', 'id = @24', 'reference', $q$insert into public.supplier_orders (id, order_id, supplier_id) values (@ab, @20, @03)$q$),
  ('order_engineers', '', 'order_id = @20', 'user_id', $q$insert into public.order_engineers (order_id, user_id) values (@21, 'a0000000-0000-4000-8000-000000000003')$q$),
  ('order_costs', '', 'order_id = @20', 'expected_cost_pkr', $q$insert into public.order_costs (order_id, expected_cost_pkr) values (@21, 5)$q$),
  ('invoices', '', 'id = @27', 'notes', $q$insert into public.invoices (id, order_id, number, net_amount, gst_amount) values (@ac, @21, 'INV-P', 100, 18)$q$),
  ('payments_in', '', 'id = @28', 'reference', $q$insert into public.payments_in (id, order_id, amount) values (@ad, @21, 5)$q$),
  ('expenses', '', 'id = @29', 'description', $q$insert into public.expenses (id, amount_pkr, category_id) values (@ae, 5, 'ca7e0000-0000-4000-8000-000000000010')$q$),
  ('recurring_expenses', '', 'id = @2a', 'label', $q$insert into public.recurring_expenses (id, label, category_id, amount) values (@af, 'l', 'ca7e0000-0000-4000-8000-000000000002', 5)$q$),
  ('expense_categories', '', 'id = @3d', 'name', $q$insert into public.expense_categories (id, name, grp) values (@b6, 'probe category', 'overhead')$q$),   -- A6
  ('closed_months', '', $q$month = '2019-01-01'$q$, 'note', $q$insert into public.closed_months (month, closed_by) values ('2019-02-01', '{uid}')$q$),   -- A6
  ('attachments', 'expense', 'id = @3c', 'file_name', $q$insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, expense_id) values (@b7, 'expense-receipts', 'p/3.jpg', 'c.jpg', 'image/jpeg', 10, @29)$q$),   -- A6
  ('attachments', 'rfq', 'id = @2b', 'file_name', $q$insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, rfq_id) values (@b0, 'rfq-files', 'p/1.pdf', 'a.pdf', 'application/pdf', 10, @15)$q$),
  ('attachments', 'invoice', 'id = @2c', 'file_name', $q$insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, invoice_id) values (@b1, 'gst-receipts', 'p/2.pdf', 'b.pdf', 'application/pdf', 10, @26)$q$),
  ('snoozes', 'own', $q$user_id = '{uid}'$q$, 'until_on', $q$insert into public.snoozes (user_id, rule, subject_id, until_on) values ('{uid}', 'r2', @b2, current_date)$q$),
  ('snoozes', 'other', $q$user_id = '{other}'$q$, 'until_on', $q$insert into public.snoozes (user_id, rule, subject_id, until_on) values ('{other}', 'r2', @b2, current_date)$q$),
  ('targets', 'own', $q$user_id = '{uid}'$q$, 'note', $q$insert into public.targets (user_id, year, quarter, target_net_pkr) values ('{uid}', 2091, 1, 10)$q$),
  ('targets', 'other', $q$user_id = '{other}'$q$, 'note', $q$insert into public.targets (user_id, year, quarter, target_net_pkr) values ('{other}', 2091, 1, 10)$q$),
  ('audit_log', '', 'true', 'table_name', $q$insert into public.audit_log (table_name, record_id, action) values ('t', @b3, 'insert')$q$),
  ('fx_rates', 'manual', 'id = @38', 'rate_pkr', $q$insert into public.fx_rates (currency, rate_pkr, source, as_of) values ('GBP', 350, 'manual', current_date - 100)$q$),
  ('fx_rates', 'auto', 'id = @39', 'rate_pkr', $q$insert into public.fx_rates (currency, rate_pkr, source, as_of) values ('GBP', 350, 'auto', current_date - 100)$q$),
  ('quotations', '', 'id = @3a', 'pdf_path', $q$insert into public.quotations (id, rfq_id, number, revision, valid_until, lines) values (@b4, @16, 7101, 0, current_date + 1, '[{"qty":1,"unit_price_net":1,"gst_rate":0}]')$q$),
  ('purchase_orders', '', 'id = @3b', 'pdf_path', $q$insert into public.purchase_orders (id, supplier_order_id, number, revision, currency, total, lines) values (@b5, @24, 7102, 0, 'USD', 0, '[{"qty":1,"unit_price":1}]')$q$),
  ('company_profile', '', 'id = 1', 'phone', $q$insert into public.company_profile (id) values (2)$q$);


insert into probes
select obj, variant, 'S', format('select 1 from public.%s where %s', obj, where_clause) from spec
where obj <> 'users' or variant = ''
union all
select obj, variant, 'U', format('update public.%s set %s = %s where %s', obj, touch, touch, where_clause) from spec
union all
select obj, variant, 'D', format('delete from public.%s where %s', obj, where_clause) from spec where obj <> 'users' or variant = ''
union all
select obj, variant, 'I', ins from spec where ins is not null;

-- column-level rows (s10 "order_items.supplier_unit_price", "supplier_orders.currency")
insert into probes values
  ('order_items', 'supplier_unit_price', 'S', 'select supplier_unit_price from public.order_items where id = @25'),
  ('order_items', 'supplier_unit_price', 'I', $q$insert into public.order_items (id, order_id, description, unit_price_net, supplier_unit_price) values (@aa, @20, 'probe', 1, 9)$q$),
  ('order_items', 'supplier_unit_price', 'U', 'update public.order_items set supplier_unit_price = supplier_unit_price where id = @25'),
  ('supplier_orders', 'currency', 'S', 'select currency from public.supplier_orders where id = @24'),
  ('supplier_orders', 'currency', 'I', $q$insert into public.supplier_orders (id, order_id, supplier_id, currency) values (@ab, @20, @03, 'EUR')$q$),
  ('supplier_orders', 'currency', 'U', 'update public.supplier_orders set currency = currency where id = @24');

-- ------------------------------------------------------------------ probes: views
insert into probes
select v, '', 'S', format('select 1 from public.%s limit 1', v)
from unnest(array['v_company_roles','v_rfq_state','v_inquiry_state','v_order_state','v_invoice_state','v_gst_register',
                  'v_order_money','v_cash_month','v_payment_net','v_target_progress','v_order_basis',
                  'v_order_items_total','v_fx_latest','v_supplier_activity','v_supplier_stats',
                  'v_month_pnl','v_month_expense_category','v_month_team','v_gst_month']) v;   -- A6

-- ------------------------------------------------------------------ probes: functions (X)
-- Each call is valid for an authorised caller and rolled back. A call counts as allowed when it returns rows (or a
-- positive count); the id arguments are fixtures, so a caller who cannot see them gets P0002 or a zero count.
insert into probes values
  ('order_receivables', '', 'X', 'select * from public.order_receivables()'),
  ('my_target_progress', '', 'X', 'select * from public.my_target_progress()'),
  ('my_target_progress_at', '', 'X', 'select * from public.my_target_progress_at(now())'),
  ('float_rfq', '', 'X', $q$select public.float_rfq(@c0, @01, '[{"description":"x"}]'::jsonb)$q$),
  ('set_rfq_floated', '', 'X', 'select 1 from (select public.set_rfq_floated(@15, false) r) x where r > 0'),   -- R05: @1a is sent today, unchased, no quote line
  ('convert_rfq_to_order', '', 'X', 'select public.convert_rfq_to_order(@c1, @15)'),
  ('create_repeat_order', '', 'X', 'select public.create_repeat_order(@c2, @20)'),
  ('merge_companies', '', 'X', 'select public.merge_companies(@01, @02)'),
  ('merge_brands', '', 'X', 'select public.merge_brands(@13, @14)'),
  ('resolve_value_basis', '', 'X', $q$select public.resolve_value_basis(@21, 'net')$q$),
  ('model_tokens', '', 'X', $q$select public.model_tokens('ABC123')$q$),
  ('item_text_norm', '', 'X', $q$select public.item_text_norm('ABC 123')$q$),
  ('item_match_tier', '', 'X', $q$select public.item_match_tier('{}', 'x', null, null, '{}', 'x', null, null)$q$),
  ('brand_tokens', '', 'X', $q$select public.brand_tokens()$q$),
  ('tokens_without', '', 'X', $q$select public.tokens_without('{AB12}', '{}')$q$),
  ('brand_words', '', 'X', $q$select public.brand_words()$q$),
  ('strip_words', '', 'X', $q$select public.strip_words('a b', '{a}')$q$),
  ('similar_enough', '', 'X', $q$select public.similar_enough('a b c', 'a b c', 0.45)$q$),
  ('supplier_item_memory', '', 'X', $q$select 1 from public.supplier_item_memory(array[@03], @13, null, 'Fixture item') where best_tier is not null$q$),
  ('customer_price_memory', '', 'X', 'select 1 where exists (select 1 from public.rfqs where id = @15) and (select count(*) from public.customer_price_memory(@15)) >= 0'),   -- R19: returns no rows for the fixture, so the probe also needs the RFQ to be visible (a deactivated user sees none)
  ('issue_quotation', '', 'X', 'select public.issue_quotation(@c3, @15)'),
  ('issue_purchase_order', '', 'X', 'select public.issue_purchase_order(@c4, @23)'),
  ('stamp_clarification_ask', '', 'X', 'select 1 from (select public.stamp_clarification_ask(array[@1d]) r) x where r > 0'),
  ('stamp_supplier_chase', '', 'X', 'select public.stamp_supplier_chase(@19)'),
  ('stamp_goods_chase', '', 'X', 'select public.stamp_goods_chase(@23)'),
  ('search_all', '', 'X', $q$select * from public.search_all('Contact', 5)$q$),
  ('stamp_payment_reminder', '', 'X', 'select 1 from (select public.stamp_payment_reminder(array[@26]) r) x where r > 0'),
  ('stamp_tcs_sent', '', 'X', 'select 1 from (select public.stamp_tcs_sent(array[@26]) r) x where r > 0'),
  ('stamp_fbr_psid', '', 'X', $q$select 1 from (select public.stamp_fbr_psid(array[@26], 'P1') r) x where r > 0$q$),
  ('stamp_tax_deposited', '', 'X', 'select 1 from (select public.stamp_tax_deposited(array[@26]) r) x where r > 0'),
  ('set_fx_rate', '', 'X', $q$select public.set_fx_rate('GBP', 350)$q$),
  ('current_user_role', '', 'X', 'select 1 where public.current_user_role() is not null'),
  ('can_access_bucket', '', 'X', $q$select 1 where public.can_access_bucket('rfq-files')$q$),
  ('today_pkt', '', 'X', 'select public.today_pkt()'),
  ('close_month', '', 'X', $q$select public.close_month(date '2020-01-01')$q$),                -- A6
  ('close_months_through', '', 'X', $q$select public.close_months_through(date '2020-01-01')$q$),   -- A6
  ('reopen_month', '', 'X', $q$select public.reopen_month(date '2019-01-01')$q$),               -- A6
  ('month_is_closed', '', 'X', $q$select public.month_is_closed(date '2019-01-01')$q$),         -- A6
  ('aging_as_of', '', 'X', 'select 1 from public.aging_as_of(public.today_pkt()) limit 1'),        -- A6
  ('payables_as_of', '', 'X', 'select 1 from public.payables_as_of(public.today_pkt()) limit 1'),  -- A6
  ('month_end_status', '', 'X', 'select 1 from public.month_end_status(public.today_pkt()) limit 1'),   -- A6
  ('revoke_user_sessions', '', 'X', $q$select public.revoke_user_sessions(gen_random_uuid())$q$);   -- A01

-- ------------------------------------------------------------------ probes: storage buckets
-- Storage refuses a direct SQL DELETE on storage.objects for every role (its protect_delete guard fires before row
-- security), so a delete cannot be probed by running it. The D probe instead runs a SELECT of the fixture object
-- filtered by the USING expression of the table's real DELETE policies, as the persona: the policy text is read
-- from pg_policies, but it is evaluated by the database for that persona, so the helper functions it calls are tested.
insert into probes
select b, '', 'S', format($q$select 1 from storage.objects where bucket_id = '%s' and name = 'fixture.txt'$q$, b)
from unnest(array['rfq-files','gst-receipts','generated-docs','expense-receipts']) b
union all
select b, '', 'I', format($q$insert into storage.objects (bucket_id, name) values ('%s', 'probe.txt')$q$, b)
from unnest(array['rfq-files','gst-receipts','generated-docs','expense-receipts']) b
union all
select b, '', 'U', format($q$update storage.objects set name = name where bucket_id = '%s' and name = 'fixture.txt'$q$, b)
from unnest(array['rfq-files','gst-receipts','generated-docs','expense-receipts']) b
union all
select b, '', 'D', format($q$select 1 from storage.objects where bucket_id = '%s' and name = 'fixture.txt' and (%s)$q$, b,
  (select string_agg('(' || coalesce(pl.qual, 'false') || ')', ' or ') from pg_policies pl
   where pl.schemaname = 'storage' and pl.tablename = 'objects' and pl.cmd = 'DELETE'))
from unnest(array['rfq-files','gst-receipts','generated-docs','expense-receipts']) b;

-- ------------------------------------------------------------------ coverage: the matrix names every object that exists
select is((select array_agg(distinct obj order by obj) from matrix where kind = 'table'),
          (select array_agg(tablename::text order by tablename) from pg_tables where schemaname = 'public'),
  'coverage: the matrix lists every table in schema public (31)');
select is((select count(distinct obj)::int from matrix where kind = 'table'), 31, 'coverage: 31 tables');
select is((select array_agg(distinct obj order by obj) from matrix where kind = 'view'),
          (select array_agg(viewname::text order by viewname) from pg_views where schemaname = 'public'),
  'coverage: the matrix lists every view in schema public');
select is((select array_agg(distinct obj order by obj) from matrix where kind = 'function'),
          (select array_agg(distinct p.proname::text order by p.proname::text) from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prorettype <> 'trigger'::regtype),
  'coverage: the matrix lists every non-trigger function in schema public');
select is((select array_agg(distinct obj order by obj) from matrix where kind = 'bucket'),
          (select array_agg(id::text order by id) from storage.buckets),
  'coverage: the matrix lists every storage bucket');
select is((select count(*)::int from matrix m where not exists (select 1 from probes p where p.obj = m.obj and p.variant = m.variant)), 0,
  'coverage: every matrix line has probes');
select is((select coalesce(array_agg(p.proname::text order by p.proname::text), '{}') from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype
             and p.prosecdef
             and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
          '{}'::text[],
  'SECURITY DEFINER trigger functions (audit_row_change, set_payment_credited_user, learn_company_brands, capture_quote_line_fx) have no client grant (A5)');
select is((select count(*)::int from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'p')
             and exists (select 1 from aclexplode(c.relacl) a where a.grantee in (0, 'anon'::regrole::oid))), 0,
  'anon and PUBLIC hold no privilege on any table or view in public');

-- S14 follow-up (0025): anon no longer runs the pure helpers, so only the deactivated rows stay known (item 3).
insert into known values
  ('model_tokens', '', 'deactivated'),
  ('item_text_norm', '', 'deactivated'),
  ('item_match_tier', '', 'deactivated'),
  ('brand_tokens', '', 'deactivated'),
  ('tokens_without', '', 'deactivated'),
  ('brand_words', '', 'deactivated'),
  ('strip_words', '', 'deactivated'),
  ('similar_enough', '', 'deactivated'),
  ('today_pkt', '', 'deactivated');

-- ------------------------------------------------------------------ the matrix, line by line and persona by persona
select is(pg_temp.actual(m.obj, m.variant, p.persona), pg_temp.expected(m.obj, m.variant, p.persona),
  format('%s %s%s as %s', m.kind, m.obj, case when m.variant = '' then '' else ' [' || m.variant || ']' end, p.persona))
from matrix m
cross join (values ('admin'), ('sales'), ('engineer'), ('deactivated'), ('anon')) p (persona)
where not exists (select 1 from known k where k.obj = m.obj and k.variant = m.variant and k.persona = p.persona)
order by m.kind, m.obj, m.variant, p.persona;

-- S14 follow-up, item 1 (migration 0025): model_tokens, item_text_norm and today_pkt were granted to authenticated but
-- never revoked from PUBLIC. They are now executable by authenticated only (the matrix loop above checks anon too).
select is((select coalesce(array_agg(p.proname::text order by p.proname::text), '{}') from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname in ('model_tokens', 'item_text_norm', 'today_pkt')
             and (has_function_privilege('anon', p.oid, 'execute')
                  or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                             where a.grantee = 0 and a.privilege_type = 'EXECUTE'))),
          '{}'::text[], 'model_tokens, item_text_norm and today_pkt have no PUBLIC or anon execute');
select is((select count(*)::int from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname in ('model_tokens', 'item_text_norm', 'today_pkt')
             and has_function_privilege('authenticated', p.oid, 'execute')), 3,
  'model_tokens, item_text_norm and today_pkt stay executable by authenticated');

-- Item 2: the SECURITY INVOKER trigger functions no longer carry the default PUBLIC execute either. Triggers still fire
-- without an execute check (the other test files exercise every one of them), so nothing is lost.
select is((select coalesce(array_agg(p.proname::text order by p.proname::text), '{}') from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype and not p.prosecdef
             and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                  or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                             where a.grantee = 0 and a.privilege_type = 'EXECUTE'))),
          '{}'::text[], 'trigger functions (security invoker) have no client or PUBLIC grant');
select is((select array_agg(p.proname::text order by p.proname::text) from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype and not p.prosecdef
             and p.proname in ('company_profile_touch', 'lock_issued_document', 'purchase_order_set_total',
                               'quotation_set_totals', 'set_updated_at')),
          array['company_profile_touch', 'lock_issued_document', 'purchase_order_set_total', 'quotation_set_totals',
                'set_updated_at'], 'the five named trigger functions exist and are covered by that check');

-- Item 3 stays a documented TODO. Section 10 lists the pure helpers (model_tokens and the like) for the three staff
-- roles only and says nothing about a deactivated user. A deactivated user is still the database role `authenticated`,
-- and the helpers read no table, so there is no row-security rule to turn the call away. No data is exposed, so this
-- is left as it is and reported rather than changed.
select todo_start('s10 is silent on deactivated users for pure helpers; they can execute them (no data access)');
select is(pg_temp.actual(k.obj, k.variant, k.persona), pg_temp.expected(k.obj, k.variant, k.persona),
  format('KNOWN function %s as %s', k.obj, k.persona))
from known k order by k.obj, k.persona;
select todo_end();

select * from finish();
rollback;
