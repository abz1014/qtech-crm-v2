-- smoke.sql: run after a restore, on the restored copy. Reads every view of the public schema (a view that no longer plans or
-- breaks on restored data fails here), checks the users table has rows, and calls a function the app calls first. Raises with
-- the object name only; no data is printed.
do $$
declare
  v record;
  n bigint;
  nviews integer := 0;
begin
  for v in select schemaname, viewname from pg_views where schemaname = 'public' order by viewname loop
    begin
      execute format('select count(*) from (select 1 from %I.%I limit 1) s', v.schemaname, v.viewname) into n;
      nviews := nviews + 1;
    exception when others then
      raise exception 'view %.% fails on the restored copy: %', v.schemaname, v.viewname, sqlerrm;
    end;
  end loop;
  select count(*) into n from public.users;
  if n = 0 then raise exception 'public.users is empty after restore'; end if;
  perform public.today_pkt();
  raise notice 'smoke ok: % views read, users present, today_pkt() answers', nviews;
end
$$;
