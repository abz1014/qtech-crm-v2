-- fk-check.sql: run after a restore. The load ran with triggers off (session_replication_role = replica), and foreign keys are
-- enforced by triggers, so a bad dump could have loaded rows that point at nothing. This checks every foreign key of the backup
-- schemas by query, validates any constraint left NOT VALID, and proves no trigger was left disabled. Raises (naming
-- constraints and counts, never data) when anything is wrong.
do $$
declare
  c record;
  j text;
  nn text;
  n bigint;
  bad text[] := '{}';
  nfk integer := 0;
begin
  for c in
    select con.conname, con.conrelid, con.confrelid, con.conkey, con.confkey
    from pg_constraint con
    join pg_namespace ns on ns.oid = con.connamespace
    where con.contype = 'f' and ns.nspname in ('public', 'legacy_archive', 'audit_archive')
    order by con.conrelid::regclass::text, con.conname
  loop
    select string_agg(format('ch.%I = pa.%I', a.attname, b.attname), ' and ' order by k.i),
           string_agg(format('ch.%I is not null', a.attname), ' and ' order by k.i)
      into j, nn
    from unnest(c.conkey, c.confkey) with ordinality as k(ck, pk, i)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.ck
    join pg_attribute b on b.attrelid = c.confrelid and b.attnum = k.pk;
    execute format('select count(*) from %s ch where %s and not exists (select 1 from %s pa where %s)',
                   c.conrelid::regclass, nn, c.confrelid::regclass, j) into n;
    nfk := nfk + 1;
    if n > 0 then bad := bad || format('%s on %s (%s rows)', c.conname, c.conrelid::regclass, n); end if;
  end loop;
  if cardinality(bad) > 0 then
    raise exception 'foreign keys violated after restore: %', array_to_string(bad, '; ');
  end if;
  raise notice 'foreign keys ok: % checked, no orphan row', nfk;

  -- constraints that were added NOT VALID: validate them now (fails if any row breaks one)
  for c in
    select con.conname, con.conrelid::regclass as tbl
    from pg_constraint con
    join pg_namespace ns on ns.oid = con.connamespace
    where not con.convalidated and ns.nspname in ('public', 'legacy_archive', 'audit_archive')
  loop
    execute format('alter table %s validate constraint %I', c.tbl, c.conname);
    raise notice 'validated constraint % on %', c.conname, c.tbl;
  end loop;

  -- every trigger the app relies on is switched on
  select count(*) into n
  from pg_trigger t
  join pg_class cl on cl.oid = t.tgrelid
  join pg_namespace ns on ns.oid = cl.relnamespace
  where not t.tgisinternal and t.tgenabled = 'D' and ns.nspname in ('public', 'legacy_archive', 'audit_archive');
  if n > 0 then raise exception '% trigger(s) are disabled after restore', n; end if;
  if current_setting('session_replication_role') <> 'origin' then
    raise exception 'session_replication_role is % (expected origin) after restore', current_setting('session_replication_role');
  end if;
  raise notice 'triggers ok: none disabled, session_replication_role = origin';
end
$$;
