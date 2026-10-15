-- 0038_order_cancel_reason (O03): why an order was cancelled is a structured record, not text in the notes.
--
-- Same rule as the "can't quote" reasons (0032): reports read the reason, and notes belong to people, so the reason is a column with a
-- fixed list of keys and the words the screen shows are built from the key in the app. Notes stay free text and are never written by a
-- cancel.
--
--   orders.cancel_reason   Why the customer's order was cancelled. Only together with cancelled_on (a reason for a cancel that never
--                          happened would be a record of nothing). NULL when no reason was given, which includes every order that
--                          was cancelled before this column existed: no data is moved, nothing wrote these reasons before.
--
-- Keys: customer_cancelled, lost_to_competitor, supplier_cannot_supply, price_or_terms, duplicate_or_mistake, other.
-- v_order_state is unchanged (lifecycle still comes from cancelled_on). Row security is unchanged: the column follows the table's rules.

alter table public.orders
  add column cancel_reason text
    constraint orders_cancel_reason_check
    check (cancel_reason in ('customer_cancelled', 'lost_to_competitor', 'supplier_cannot_supply', 'price_or_terms', 'duplicate_or_mistake', 'other')),
  add constraint orders_cancel_reason_needs_cancelled_on
    check (cancel_reason is null or cancelled_on is not null);

comment on column public.orders.cancel_reason is
  'Why the order was cancelled (a fixed key). Set together with cancelled_on; NULL when no reason was given or the order is active.';
