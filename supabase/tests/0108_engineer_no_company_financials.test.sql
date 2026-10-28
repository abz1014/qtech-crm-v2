-- 0108_engineer_no_company_financials: an engineer cannot read the company's bank details, IBAN, NTN or STRN; admin and sales can.
begin;
select * from no_plan();

create function pg_temp.as_(persona text, stmt text) returns text language plpgsql as $f$
declare
  v text;
  d text;
  n bigint;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', case persona
      when 'admin' then 'a0000000-0000-4000-8000-000000000001'
      when 'sales' then 'a0000000-0000-4000-8000-000000000002'
      when 'engineer' then 'a0000000-0000-4000-8000-000000000003' end, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform qtech_private.pre_request();
    execute stmt into v;
    get diagnostics n = row_count;
    raise exception 'done' using errcode = 'P0999', detail = case when n = 0 then '<none>' when v is null then '<null>' else v end;
  exception
    when sqlstate 'P0999' then
      get stacked diagnostics d = pg_exception_detail;
      return d;
    when others then
      return 'E:' || sqlstate;
  end;
end
$f$;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
update public.company_profile set legal_name = 'Q-Tech Pvt Ltd', ntn = '1234567-8', strn = '1700000000001',
  bank_name = 'HBL', bank_account_title = 'Q-Tech', bank_iban = 'PK00HABB0000000000000000';

-- structure, by column
create temp table fin (col text);
insert into fin values ('ntn'), ('strn'), ('bank_name'), ('bank_account_title'), ('bank_iban');
select is((select coalesce(array_agg(col order by col), '{}') from fin
           where has_column_privilege('qtech_engineer', 'public.company_profile', col, 'select')
              or has_column_privilege('qtech_engineer', 'public.company_profile', col, 'update')),
          '{}'::text[], 'qtech_engineer holds neither SELECT nor UPDATE on the five financial and tax columns');
select is((select coalesce(array_agg(col order by col), '{}') from fin
           where not has_column_privilege('authenticated', 'public.company_profile', col, 'select')),
          '{}'::text[], 'authenticated (admin and sales) still reads all five');
select ok(not has_table_privilege('qtech_engineer', 'public.company_profile', 'select'), 'no table-level SELECT for the engineer role');
select is((select coalesce(array_agg(a.attname::text order by a.attname), '{}') from pg_attribute a
           where a.attrelid = 'public.company_profile'::regclass and a.attnum > 0 and not a.attisdropped
             and a.attname not in (select col from fin)
             and not has_column_privilege('qtech_engineer', a.attrelid, a.attnum, 'select')),
          '{}'::text[], 'qtech_engineer still reads every other column');

-- behaviour
select is(pg_temp.as_('engineer', 'select ntn from public.company_profile where id = 1'), 'E:42501', 'engineer cannot read the NTN');
select is(pg_temp.as_('engineer', 'select strn from public.company_profile where id = 1'), 'E:42501', 'nor the STRN');
select is(pg_temp.as_('engineer', 'select bank_name from public.company_profile where id = 1'), 'E:42501', 'nor the bank');
select is(pg_temp.as_('engineer', 'select bank_account_title from public.company_profile where id = 1'), 'E:42501', 'nor the account title');
select is(pg_temp.as_('engineer', 'select bank_iban from public.company_profile where id = 1'), 'E:42501', 'nor the IBAN');
select is(pg_temp.as_('engineer', 'select count(*)::text from (select * from public.company_profile) x'), 'E:42501', 'select * is refused');
select is(pg_temp.as_('engineer', 'select legal_name || ''|'' || default_payment_terms_days::text from public.company_profile where id = 1'),
  'Q-Tech Pvt Ltd|30', 'engineer still reads the name and the default payment terms');
select is(pg_temp.as_('admin', 'select ntn || bank_iban from public.company_profile where id = 1'), '1234567-8PK00HABB0000000000000000', 'admin reads them');
select is(pg_temp.as_('sales', 'select strn || bank_name from public.company_profile where id = 1'), '1700000000001HBL', 'sales reads them');

select * from finish();
rollback;
