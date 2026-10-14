-- 0030_fk_restrict_sites_contacts: history is never silently unfiled.
-- RFQs, orders and quotations pointed at company_sites / contacts with ON DELETE SET NULL, so deleting a site or
-- contact quietly stripped it from historical records. They now RESTRICT (23503). contacts.site_id stays SET NULL:
-- a contact may outlive its site. merge_companies (0019) repoints rows before it deletes, so it is unaffected.

alter table public.rfqs
  drop constraint rfqs_site_id_fkey,
  add constraint rfqs_site_id_fkey foreign key (site_id) references public.company_sites (id) on delete restrict,
  drop constraint rfqs_contact_id_fkey,
  add constraint rfqs_contact_id_fkey foreign key (contact_id) references public.contacts (id) on delete restrict;

alter table public.orders
  drop constraint orders_site_id_fkey,
  add constraint orders_site_id_fkey foreign key (site_id) references public.company_sites (id) on delete restrict,
  drop constraint orders_contact_id_fkey,
  add constraint orders_contact_id_fkey foreign key (contact_id) references public.contacts (id) on delete restrict;

alter table public.quotations
  drop constraint quotations_contact_id_fkey,
  add constraint quotations_contact_id_fkey foreign key (contact_id) references public.contacts (id) on delete restrict;
