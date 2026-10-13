begin;
select plan(1);

select is(
  obj_description('public'::regnamespace, 'pg_namespace'),
  'Q-Tech CRM v2',
  'public schema carries the bootstrap comment'
);

select * from finish();
rollback;
