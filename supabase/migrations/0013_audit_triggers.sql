-- 0013_audit_triggers (S09): attach the audit trigger to every business table (DATA_MODEL section 2.22).
--
-- Three tables have no id column (order_costs, company_brands, order_engineers), so audit_row_change
-- now takes the primary-key column names as trigger arguments:
--   no argument      -> the row's id column (the default for every table with an id)
--   one column       -> that column's value, as text (order_costs.order_id)
--   several columns  -> a JSON object of those columns, e.g. {"brand_id":"...","company_id":"..."}
-- jsonb prints keys in a fixed order, so the text form is stable. audit_log is still empty at this
-- point, so changing record_id from uuid to text rewrites no data.

alter table public.audit_log alter column record_id type text using record_id::text;

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r   jsonb;
  rid text;
begin
  r := to_jsonb(case when tg_op = 'DELETE' then old else new end);

  if tg_nargs = 0 then
    rid := r ->> 'id';
  elsif tg_nargs = 1 then
    rid := r ->> tg_argv[0];
  else
    select jsonb_object_agg(k, r -> k)::text into rid from unnest(tg_argv) as k;
  end if;

  if tg_op = 'DELETE' then
    insert into public.audit_log (table_name, record_id, action, changed_by, old_value, new_value)
    values (tg_table_name, rid, 'delete', auth.uid(), to_jsonb(old), null);
    return old;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log (table_name, record_id, action, changed_by, old_value, new_value)
    values (tg_table_name, rid, 'update', auth.uid(), to_jsonb(old), to_jsonb(new));
    return new;
  else
    insert into public.audit_log (table_name, record_id, action, changed_by, old_value, new_value)
    values (tg_table_name, rid, 'insert', auth.uid(), null, to_jsonb(new));
    return new;
  end if;
end;
$$;

-- Tables keyed by id.
create trigger companies_audit            after insert or update or delete on public.companies
  for each row execute function public.audit_row_change();
create trigger company_sites_audit        after insert or update or delete on public.company_sites
  for each row execute function public.audit_row_change();
create trigger contacts_audit             after insert or update or delete on public.contacts
  for each row execute function public.audit_row_change();
create trigger brands_audit               after insert or update or delete on public.brands
  for each row execute function public.audit_row_change();
create trigger rfqs_audit                 after insert or update or delete on public.rfqs
  for each row execute function public.audit_row_change();
create trigger rfq_items_audit            after insert or update or delete on public.rfq_items
  for each row execute function public.audit_row_change();
create trigger supplier_inquiries_audit   after insert or update or delete on public.supplier_inquiries
  for each row execute function public.audit_row_change();
create trigger supplier_quote_lines_audit after insert or update or delete on public.supplier_quote_lines
  for each row execute function public.audit_row_change();
create trigger clarifications_audit       after insert or update or delete on public.clarifications
  for each row execute function public.audit_row_change();
create trigger orders_audit               after insert or update or delete on public.orders
  for each row execute function public.audit_row_change();
create trigger order_items_audit          after insert or update or delete on public.order_items
  for each row execute function public.audit_row_change();
create trigger supplier_orders_audit      after insert or update or delete on public.supplier_orders
  for each row execute function public.audit_row_change();
create trigger invoices_audit             after insert or update or delete on public.invoices
  for each row execute function public.audit_row_change();
create trigger payments_in_audit          after insert or update or delete on public.payments_in
  for each row execute function public.audit_row_change();
create trigger expenses_audit             after insert or update or delete on public.expenses
  for each row execute function public.audit_row_change();
create trigger recurring_expenses_audit   after insert or update or delete on public.recurring_expenses
  for each row execute function public.audit_row_change();
create trigger targets_audit              after insert or update or delete on public.targets
  for each row execute function public.audit_row_change();
create trigger attachments_audit          after insert or update or delete on public.attachments
  for each row execute function public.audit_row_change();

-- Tables without an id column.
create trigger order_costs_audit          after insert or update or delete on public.order_costs
  for each row execute function public.audit_row_change('order_id');
create trigger company_brands_audit       after insert or update or delete on public.company_brands
  for each row execute function public.audit_row_change('company_id', 'brand_id');
create trigger order_engineers_audit      after insert or update or delete on public.order_engineers
  for each row execute function public.audit_row_change('order_id', 'user_id');
