-- 0112 to 0115 (money-integrity audit): void and credit notes (C1), the invoice rules in the database (H1 H2 H3), duplicate
-- payments (M4), FX typos (M7), the month lock on the other money tables (M2), and the money oracle: the same figure on every
-- screen after a void and a credit note.
-- Fixture users come from supabase/seed.sql: admin a0..01, sales a0..02, engineer a0..03. Fixture ids are 11200000-...-0000000000NN
-- (written @NN in statements). Fixtures are written as the table owner (the API-role-only guards do not apply to them).
begin;
select * from no_plan();

create function pg_temp.uid(persona text) returns text language sql immutable as
  $$ select case persona
       when 'admin' then 'a0000000-0000-4000-8000-000000000001'
       when 'sales' then 'a0000000-0000-4000-8000-000000000002'
       when 'engineer' then 'a0000000-0000-4000-8000-000000000003'
       else '00000000-0000-0000-0000-000000000000' end $$;

create function pg_temp.u(h text) returns uuid language sql immutable as
  $$ select ('11200000-0000-4000-8000-0000000000' || h)::uuid $$;

-- Runs stmt as the persona the way the API runs it. 'ok:<first column>' | 'ok:<rows>' | 'E:<sqlstate>:<hint>|<message>'.
create function pg_temp.try_(persona text, stmt text, keep boolean default false) returns text language plpgsql as $f$
declare
  v text; d text; h text; m text; n bigint; s text;
begin
  s := regexp_replace(stmt, '@([0-9a-f]{2})\M', '''11200000-0000-4000-8000-0000000000\1''::uuid', 'g');
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(persona), 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform qtech_private.pre_request();
    execute s into v;
    get diagnostics n = row_count;
    d := case when left(ltrim(lower(s)), 6) = 'select' then 'ok:' || coalesce(v, '')
              when n = 0 then '<none>'
              else 'ok:' || n end;
    if keep then
      reset role;
      return d;
    end if;
    raise exception 'done' using errcode = 'P0999', detail = d;
  exception
    when sqlstate 'P0999' then
      get stacked diagnostics d = pg_exception_detail;
      return d;
    when others then
      get stacked diagnostics h = pg_exception_hint, m = message_text;
      return 'E:' || sqlstate || ':' || coalesce(h, '') || '|' || m;
  end;
end
$f$;

create function pg_temp.code_(persona text, stmt text, keep boolean default false) returns text language sql as
  $$ select split_part(pg_temp.try_(persona, stmt, keep), '|', 1) $$;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ------------------------------------------------------------------ fixtures
insert into public.companies (id, name) values (pg_temp.u('01'), '0112 Customer');

-- Orders (each with lines, qty 1, GST 18% unless said). 10: two lines 600 + 400 (GST 108 + 72). 11: one line 500 (GST 90).
-- 12: one line 1000 (GST 180), used for the filed-invoice rules. 13: payments (one line 1000). 14: an exempt line 300 and an 18% line 700.
insert into public.orders (id, company_id, owner_id, created_by) values
  (pg_temp.u('10'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('11'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('12'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('13'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('14'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('15'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001');   -- no lines: nothing to check an invoice against
insert into public.order_items (id, order_id, position, description, unit_price_net, gst_rate, created_by) values
  (pg_temp.u('20'), pg_temp.u('10'), 0, 'Line A', 600, 18, 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('21'), pg_temp.u('10'), 1, 'Line B', 400, 18, 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('22'), pg_temp.u('11'), 0, 'Line C', 500, 18, 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('23'), pg_temp.u('12'), 0, 'Line D', 1000, 18, 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('24'), pg_temp.u('13'), 0, 'Line E', 1000, 18, 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('25'), pg_temp.u('14'), 0, 'Exempt line', 300, 0, 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('26'), pg_temp.u('14'), 1, 'Taxed line', 700, 18, 'a0000000-0000-4000-8000-000000000001');

-- Invoices (today's month, open). 30: the whole of order 10 (1000 + 180). 31: order 11 (500 + 90). 32: order 12, filed (PSID).
-- 33: order 13, with a payment applied. 34: order 12's second... none. 35: order 11 is credited below.
insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount, created_by) values
  (pg_temp.u('30'), pg_temp.u('10'), 'T112-1', public.today_pkt(), 1000, 180, 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('31'), pg_temp.u('11'), 'T112-2', public.today_pkt(), 500, 90, 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('33'), pg_temp.u('13'), 'T112-4', public.today_pkt(), 1000, 180, 'a0000000-0000-4000-8000-000000000001');
insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount, psid, created_by) values
  (pg_temp.u('32'), pg_temp.u('12'), 'T112-3', public.today_pkt(), 1000, 180, 'PSID-1', 'a0000000-0000-4000-8000-000000000001');
insert into public.payments_in (id, order_id, amount, received_on, reference, created_by) values
  (pg_temp.u('40'), pg_temp.u('13'), 500, public.today_pkt() - 3, 'REF-A', 'a0000000-0000-4000-8000-000000000001');

-- ================================================================== A. void
select is(pg_temp.code_('sales', $q$select public.void_invoice(@30, 'x')::text$q$), 'E:42501:admin_only', 'void: admin only');
select is(pg_temp.code_('admin', $q$select public.void_invoice(@30, '  ')::text$q$), 'E:22023:reason', 'void: a reason is required');
select is(pg_temp.code_('admin', $q$select public.void_invoice(@ee, 'x')::text$q$), 'E:P0002:not_found', 'void: not found');
select is(pg_temp.code_('admin', $q$select public.void_invoice(@32, 'typo')::text$q$), 'E:P0001:filed',
  'void: refused once a PSID is recorded, and the message points to a credit note');
select alike(pg_temp.try_('admin', $q$select public.void_invoice(@32, 'typo')::text$q$), '%Issue a credit note instead.',
  'the refusal says Credit note');
select is(pg_temp.code_('admin', $q$select public.void_invoice(@33, 'typo')::text$q$), 'E:P0001:paid', 'void: refused while a payment is applied to it');

-- the books before the void: order 10 owes 1180 (invoice), the month's GST is the invoices'
select is((select balance from public.order_receivables(pg_temp.u('10'))), 1180.00::numeric, 'before the void order 10 owes 1180');
select is(pg_temp.code_('admin', $q$select public.void_invoice(@30, 'Wrong customer')::text$q$, true), 'ok:', 'void: an unfiled invoice with no payment is voided');
select is((select number from public.invoices where id = pg_temp.u('30')), 'T112-1', 'void: the number stays');
select ok((select voided_at is not null and voided_by = 'a0000000-0000-4000-8000-000000000001' and void_reason = 'Wrong customer'
                  and voided_net = 1000 and voided_gst = 180 and net_amount = 0 and gst_amount = 0
           from public.invoices where id = pg_temp.u('30')), 'void: who, when, why, the figures kept, and 0 / 0 in the sums');
select is(pg_temp.code_('admin', $q$select public.void_invoice(@30, 'again')::text$q$), 'E:P0001:already_void', 'void: twice is refused');
select is(pg_temp.code_('admin', $q$update public.invoices set net_amount = 5 where id = @30$q$), 'E:P0001:invoice_void', 'a void invoice cannot be changed');
select is(pg_temp.code_('admin', $q$update public.invoices set voided_at = null, void_reason = null, voided_by = null, voided_net = null, voided_gst = null where id = @30$q$),
  'E:P0001:invoice_void', 'and cannot be un-voided');
select is(pg_temp.code_('admin', $q$update public.invoices set voided_at = now(), void_reason = 'x', voided_net = 500, voided_gst = 90, net_amount = 0, gst_amount = 0 where id = @31$q$),
  'E:P0001:use_void', 'voiding by a plain UPDATE is refused: only void_invoice voids');
-- the order goes back to its items: it owes the items' 1180, not 0
select is((select balance from public.order_receivables(pg_temp.u('10'))), 1180.00::numeric, 'after the void order 10 is not invoiced: it owes its items (1180)');
select is(pg_temp.try_('admin', $q$select invoicing_state from public.v_order_state where order_id = @10$q$), 'ok:not_invoiced', 'the voided invoice does not count as invoicing');
select is((select count(*)::int from public.v_gst_register where invoice_id = pg_temp.u('30') and voided_at is not null and gross_amount = 0), 1,
  'the register still lists the voided invoice (its number), at 0');
select is((select invoice_count from public.v_gst_month where month = date_trunc('month', public.today_pkt())::date),
  3, 'the GST month counts the three live invoices (30 is void)');

-- delete: only an unnumbered invoice
select is(pg_temp.code_('admin', $q$select count(*)::text from public.delete_invoice(@31)$q$), 'E:P0001:use_void', 'delete_invoice: a numbered invoice is refused, pointing to Void');
select is(pg_temp.code_('admin', $q$delete from public.invoices where id = @31$q$), 'E:P0001:use_void', 'and a plain DELETE through the API is refused too');
insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount, legacy_flags)
values (pg_temp.u('36'), pg_temp.u('11'), null, public.today_pkt(), 0, 0, array['undated']);
select is(pg_temp.code_('admin', $q$select count(*)::text from public.delete_invoice(@36)$q$, true), 'ok:0', 'delete_invoice: an unnumbered invoice is deleted as before');

-- ================================================================== B. credit notes
select is(pg_temp.code_('sales', $q$select count(*)::text from public.create_credit_note(@31, 100, 'Return')$q$), 'E:42501:admin_only', 'credit note: admin only');
select is(pg_temp.code_('admin', $q$select count(*)::text from public.create_credit_note(@31, 100, '  ')$q$), 'E:22023:reason', 'credit note: a reason is required');
select is(pg_temp.code_('admin', $q$select count(*)::text from public.create_credit_note(@31, 600, 'Too much')$q$), 'E:P0001:over_credited', 'credit note: more than the invoice is refused');
select is(pg_temp.code_('admin', $q$select count(*)::text from public.create_credit_note(@30, 100, 'On a void one')$q$), 'E:P0001:invoice_void', 'credit note: not against a void invoice');
select is(pg_temp.try_('admin', $q$select number from public.create_credit_note(@31, 200, 'Part returned')$q$, true), 'ok:CN-0001', 'credit note: the first is CN-0001');
select is((select gst_amount from public.credit_notes where number = 'CN-0001'), 36.00::numeric, 'its GST follows the invoice (200 of 500 carries 36 of 90)');
select is(pg_temp.try_('admin', $q$select number from public.create_credit_note(@31, 100, 'Another part')$q$, true), 'ok:CN-0002', 'the next is CN-0002');
select is(pg_temp.code_('admin', $q$select count(*)::text from public.create_credit_note(@31, 100, 'Bad gst', 5)$q$), 'E:P0001:gst_mismatch', 'a GST that does not follow the invoice is refused');
select is(left(pg_temp.code_('admin', $q$update public.credit_notes set reason = 'x' where number = 'CN-0001'$q$), 8), 'E:42501:', 'a credit note cannot be edited (no update right)');
select is(left(pg_temp.code_('admin', $q$delete from public.credit_notes where number = 'CN-0001'$q$), 8), 'E:42501:', 'or deleted');
select is(pg_temp.code_('admin', $q$select public.void_invoice(@31, 'x')::text$q$), 'E:P0001:has_credit_note', 'an invoice with a credit note cannot be voided');
select is(pg_temp.code_('admin', $q$update public.invoices set net_amount = 400, gst_amount = 72 where id = @31$q$), 'E:P0001:has_credit_note', 'nor have its amounts changed');
select is((select count(*)::int from public.credit_notes where number in ('CN-0001', 'CN-0002') and company_id = pg_temp.u('01') and order_id = pg_temp.u('11')), 2,
  'the credit notes carry the invoice''s order and company');
select is(pg_temp.code_('engineer', 'select count(*)::text from public.credit_notes'), 'ok:0', 'an engineer reads no credit note');
select is(pg_temp.code_('sales', 'select count(*)::text from public.credit_notes'), 'ok:2', 'sales read them');

-- ------------------------------------------------------------------ the money oracle: one figure everywhere
-- order 11: invoice 500 + 90 = 590, credited 300 + 54 = 354 -> 236 is what it is invoiced for now
select is((select gross_target from public.order_receivables(pg_temp.u('11'))), 236.00::numeric, 'receivables: the order is invoiced for 590 less 354');
select is((select gross_target from public.v_order_money where order_id = pg_temp.u('11')), 236.00::numeric, 'the order money view agrees');
select is((select g from public.v_order_basis where order_id = pg_temp.u('11')), 236.00::numeric, 'and the basis payments are shared against');
select is((select net_sale from public.v_order_money where order_id = pg_temp.u('11')), 200.00::numeric, 'sales net of the order is 200 after the credit');
select is((select sum(remaining) from public.aging_as_of(public.today_pkt()) where order_id = pg_temp.u('11') and kind = 'invoice'), 236.00::numeric, 'aging lists 236 for the invoice');
select is((select gross_target from public.order_receivables(pg_temp.u('11'))), (select sum(remaining) from public.aging_as_of(public.today_pkt()) where order_id = pg_temp.u('11')),
  'receivables and aging agree for the order');
select is((select credit_note_count from public.v_gst_month where month = date_trunc('month', public.today_pkt())::date), 2, 'the GST month counts two credit notes');
select is((select credit_gst from public.v_gst_month where month = date_trunc('month', public.today_pkt())::date), 54.00::numeric, 'worth 54 of GST');
select is((select gst from public.v_gst_month where month = date_trunc('month', public.today_pkt())::date),
          (select sum(gst_amount) from public.v_gst_register where invoice_month = date_trunc('month', public.today_pkt())::date),
  'GST to FBR: the month''s GST equals the register''s lines, credit notes counted negative');
select is((select count(*)::int from public.v_gst_register where row_kind = 'credit_note' and gst_amount < 0 and net_amount < 0), 2, 'the register shows both as negative lines');
select is((select sales_net from public.v_month_profit where month = date_trunc('month', public.today_pkt())::date),
          (select net from public.v_gst_month where month = date_trunc('month', public.today_pkt())::date),
  'sales in the profit view equal the GST month''s net (voids out, credit notes taken off)');
select is((select sum(gross_amount) from public.v_gst_register where invoice_month = date_trunc('month', public.today_pkt())::date),
          (select net + gst from public.v_gst_month where month = date_trunc('month', public.today_pkt())::date), 'register gross equals month net + GST');

-- a credit note makes an over-paid order show as overpaid (the customer credit), never as owing
insert into public.payments_in (id, order_id, amount, received_on, created_by) values
  (pg_temp.u('41'), pg_temp.u('11'), 590, public.today_pkt(), 'a0000000-0000-4000-8000-000000000001');
select is((select overpaid_by from public.order_receivables(pg_temp.u('11'))), 354.00::numeric, 'paid 590 on a 236 order: 354 over-paid');
select is((select balance from public.order_receivables(pg_temp.u('11'))), 0.00::numeric, 'and nothing owing');

-- ================================================================== C. H1: GST, net and over-invoicing (as the API roles)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
-- order 10: free again (its invoice is void): 1000 + 180 to invoice. A part invoice for line A (600) carries 108.
select is(pg_temp.code_('admin', $q$insert into public.invoices (order_id, number, net_amount, gst_amount) values (@10, 'T112-5', 1200, 216) returning 1$q$),
  'E:P0001:over_invoiced', 'H1: a net above what is left is refused');
select is(pg_temp.code_('admin', $q$insert into public.invoices (order_id, number, net_amount, gst_amount) values (@10, 'T112-5', 600, 30) returning 1$q$),
  'E:P0001:gst_mismatch', 'H1: a GST that is not the order''s is refused');
select is(pg_temp.code_('admin', $q$insert into public.invoices (id, order_id, number, net_amount, gst_amount) values (@50, @10, 'T112-5', 600, 108) returning 1$q$, true),
  'ok:1', 'H1: line A alone with its own GST is accepted');
select is(pg_temp.code_('sales', $q$insert into public.invoices (order_id, number, net_amount, gst_amount) values (@10, 'T112-6', 400, 72.5) returning 1$q$, true),
  'ok:1', 'H1: within Rs 1 is accepted (and sales may invoice)');
select is(pg_temp.code_('admin', $q$insert into public.invoices (order_id, number, net_amount, gst_amount) values (@10, 'T112-7', 100, 18) returning 1$q$),
  'E:P0001:over_invoiced', 'H1: nothing is left to invoice on the order now (the second invoice took the rest): a third is refused');
select is(pg_temp.code_('admin', $q$insert into public.invoices (order_id, number, net_amount, gst_amount) values (@14, 'T112-8', 300, 0) returning 1$q$, true),
  'ok:1', 'H1: the exempt line alone, with no GST, is accepted');
select is(pg_temp.code_('admin', $q$insert into public.invoices (order_id, number, net_amount, gst_amount) values (@14, 'T112-9', 700, 126) returning 1$q$, true),
  'ok:1', 'H1: the taxed line alone carries 18%');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
-- an UPDATE that leaves the figures alone, are not re-checked
select is(pg_temp.code_('admin', $q$update public.invoices set notes = 'chased' where id = @33 returning 1$q$), 'ok:1', 'H1: an update that leaves order, net and GST alone is not re-checked');

-- ================================================================== D. H2: a filed invoice
select is(pg_temp.code_('admin', $q$update public.invoices set number = 'T112-3X' where id = @32$q$), 'E:P0001:invoice_filed', 'H2: a PSID is recorded: the number is fixed');
select is(pg_temp.code_('admin', $q$update public.invoices set invoice_date = public.today_pkt() - 1 where id = @32$q$), 'E:P0001:invoice_filed', 'the date is fixed');
select is(pg_temp.code_('admin', $q$update public.invoices set net_amount = 900, gst_amount = 162 where id = @32$q$), 'E:P0001:invoice_filed', 'the net and GST are fixed');
select alike(pg_temp.try_('admin', $q$update public.invoices set net_amount = 900, gst_amount = 162 where id = @32$q$), '%Issue a credit note to correct it.', 'and the message points to a credit note');
select is(pg_temp.code_('admin', $q$update public.invoices set notes = 'x', tcs_sent_on = public.today_pkt() where id = @32 returning 1$q$), 'ok:1', 'anything else about it can still be recorded');
update public.invoices set psid = null, tax_deposited_on = public.today_pkt() where id = pg_temp.u('33');
select is(pg_temp.code_('admin', $q$update public.invoices set net_amount = 900, gst_amount = 162 where id = @33$q$), 'E:P0001:invoice_filed', 'H2: a tax deposit alone fixes it too');

-- ================================================================== E. H3: numbers
select is(pg_temp.code_('admin', $q$insert into public.invoices (order_id, number, net_amount, gst_amount) values (@15, 't112-3', 100, 18) returning 1$q$), 'E:23505:',
  'H3: the same number in other capitals is a duplicate');
select is(pg_temp.code_('admin', $q$insert into public.invoices (order_id, number, net_amount, gst_amount) values (@15, ' T112-3 ', 100, 18) returning 1$q$), 'E:23505:',
  'H3: and with spaces around it');
select is(pg_temp.code_('admin', $q$insert into public.invoices (order_id, number, net_amount, gst_amount) values (@15, 'T112-3A', 100, 18) returning 1$q$), 'ok:1',
  'H3 control: a different number goes in');
insert into public.invoices (id, order_id, number, net_amount, gst_amount, legacy_flags) values (pg_temp.u('51'), pg_temp.u('11'), '  T112-SP  ', 0, 0, array['undated']);
select is((select number from public.invoices where id = pg_temp.u('51')), 'T112-SP', 'H3: the number is stored trimmed');

-- ================================================================== F. M4: duplicate payments
select is(pg_temp.code_('admin', $q$select public.record_payment(@60, @13, public.today_pkt() - 3, 500, 'OTHER', 'bank', false)::text$q$), 'E:P0001:duplicate_payment',
  'M4: same customer, amount and date as a payment already recorded');
select alike(pg_temp.try_('admin', $q$select public.record_payment(@60, @13, public.today_pkt() - 3, 500, 'OTHER', 'bank', false)::text$q$), '%Looks like a payment already recorded on %',
  'M4: the message names the earlier payment');
select is(pg_temp.code_('admin', $q$select public.record_payment(@60, @13, public.today_pkt(), 123, ' ref-a ', 'bank', false)::text$q$), 'E:P0001:duplicate_payment',
  'M4: the same non-empty reference (capitals and spaces ignored)');
select is(pg_temp.code_('admin', $q$select public.record_payment(@60, @13, public.today_pkt(), 123, null, 'bank', false)::text$q$, true), 'ok:', 'M4: a different payment goes in');
select is(pg_temp.code_('admin', $q$select public.record_payment(@61, @13, public.today_pkt(), 123, null, 'bank', false)::text$q$), 'E:P0001:duplicate_payment', 'M4: the same again is a duplicate');
select is(pg_temp.code_('admin', $q$select public.record_payment(@61, @13, public.today_pkt(), 123, null, 'bank', true)::text$q$, true), 'ok:', 'M4: confirmed, it goes in');
select is(pg_temp.code_('sales', $q$select public.record_payment(@62, @13, public.today_pkt(), 7, null, 'bank', false)::text$q$), 'E:42501:admin_only', 'M4: admin only');

-- ================================================================== G. M7: FX typos
insert into public.fx_rates (currency, rate_pkr, as_of, source) values ('XTS', 280, public.today_pkt() - 1, 'auto');
select is(pg_temp.code_('admin', $q$select public.set_fx_rate('XTS', 28.0)::text$q$), 'E:P0001:fx_rate_far', 'M7: a rate 90% below the latest needs a confirm');
select is(pg_temp.code_('admin', $q$select public.set_fx_rate('XTS', 360)::text$q$), 'E:P0001:fx_rate_far', 'M7: and 28% above');
select is(pg_temp.code_('admin', $q$select public.set_fx_rate('XTS', 300)::text$q$, true) like 'ok:%', true, 'M7: 7% away goes in');
select is(pg_temp.code_('admin', $q$select public.set_fx_rate('XTS', 28.0, null, true)::text$q$, true) like 'ok:%', true, 'M7: confirmed, a far rate goes in');
select is(pg_temp.code_('admin', $q$select public.set_fx_rate('NWC', 5)::text$q$, true) like 'ok:%', true, 'M7: a currency with no rate yet is not checked');

-- ================================================================== H. M2: the month lock on the other money tables, and the close lock
select ok((select pg_get_functiondef('public.close_month(date)'::regprocedure) like '%share row exclusive%'), 'M2: close_month locks the money tables');
select ok((select pg_get_functiondef('public.close_months_through(date)'::regprocedure) like '%share row exclusive%'), 'M2: close_months_through locks them too');
select is((select provolatile from pg_proc where oid = 'public.month_is_closed(date)'::regprocedure), 'v', 'M2: month_is_closed reads a fresh snapshot (volatile)');
select ok((select count(*) = 4 from pg_trigger t where not t.tgisinternal and t.tgname in
   ('cash_topups_month_lock', 'cash_counts_month_lock', 'order_costs_month_lock', 'credit_notes_month_lock')), 'M2: the lock is on cash top-ups, cash counts, order costs and credit notes');
insert into public.cash_topups (id, drawn_on, amount_pkr) values (pg_temp.u('70'), '2019-03-05', 100);
insert into public.cash_counts (id, counted_on, counted_pkr, expected_pkr, is_opening) values (pg_temp.u('71'), '2019-03-06', 10, 10, false);
insert into public.order_costs (order_id, expected_cost_pkr, costs_complete_at) values (pg_temp.u('12'), 100, '2019-03-07 10:00+05');
select lives_ok($$select public.close_months_through('2019-03-01')$$, 'close_months_through closes through March 2019');
select ok(public.month_is_closed('2019-03-15'), 'March 2019 is closed');
select is(pg_temp.code_('admin', $q$update public.cash_topups set amount_pkr = 200 where id = @70$q$), 'E:P0001:', 'M2: a cash top-up of a closed month is frozen');
select is(pg_temp.code_('admin', $q$insert into public.cash_topups (drawn_on, amount_pkr) values ('2019-03-09', 5)$q$), 'E:P0001:', 'M2: and none can be added to it');
select is(pg_temp.code_('admin', $q$insert into public.cash_counts (counted_on, counted_pkr, expected_pkr) values ('2019-03-09', 5, 5)$q$), 'E:P0001:', 'M2: a cash count cannot be added to a closed month');
select is(pg_temp.code_('admin', $q$update public.order_costs set expected_cost_pkr = 5 where order_id = @12$q$), 'E:P0001:', 'M2: order costs completed in a closed month are frozen');
select is(pg_temp.code_('admin', $q$select count(*)::text from public.create_credit_note(@32, 100, 'Back dated', null, '2019-03-10')$q$), 'E:P0001:', 'M2: a credit note cannot be issued into a closed month');
select alike(pg_temp.try_('admin', $q$select count(*)::text from public.create_credit_note(@32, 100, 'Back dated', null, '2019-03-10')$q$), '%March 2019 is closed. An admin can reopen it.', 'with the usual sentence');
select is(pg_temp.code_('admin', $q$select count(*)::text from public.create_credit_note(@32, 100, 'This month')$q$, true), 'ok:1',
  'a credit note against a filed invoice is issued today (the way to correct it)');

select * from finish();
rollback;
