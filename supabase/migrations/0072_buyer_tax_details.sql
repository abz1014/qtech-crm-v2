-- 0072_buyer_tax_details (owner decision 2026-10-20, item 2: the CRM prints the sales-tax invoice PDF): the buyer's tax details.
--
-- Section 23(1)(b) of the Sales Tax Act, 1990 puts the recipient's name, address and registration number (if any) on every tax
-- invoice. The CRM had the buyer's name only: companies.address was cut (addresses live on sites, which are delivery sites) and
-- there was no NTN or STRN. Four optional columns, all NULL by default, so nothing is required of anyone until an invoice is
-- printed (the PDF names what is missing and offers the fields right there):
--
--   companies.ntn                    the buyer's NTN, or the 13-digit CNIC of a person (FBR's "NTN/CNIC" buyer field)
--   companies.strn                   the buyer's sales-tax registration number, when registered
--   companies.sales_tax_registered   true = registered for sales tax, false = not registered, NULL = not known yet
--   companies.invoice_address        the address printed for the buyer on a tax invoice; when empty the PDF uses the order's
--                                    delivery site address
--
-- Additive only: no existing row, view, function or policy changes. The columns are on companies, so the companies row
-- policies (0006: every active role selects, inserts and updates; delete is admin only) and the audit trigger (0013) cover
-- them as they cover the name. A number is kept as typed (digits, spaces and dashes, as on the FBR certificate); the CHECKs
-- refuse empty text (absent means NULL, DATA_MODEL shared conventions) and anything that is not a number.

alter table public.companies
  add column ntn text,
  add column strn text,
  add column sales_tax_registered boolean,
  add column invoice_address text,
  add constraint companies_ntn_format check (
    ntn is null or (char_length(ntn) <= 40 and ntn ~ '^[0-9][0-9 -]*[0-9]$')
  ),
  add constraint companies_strn_format check (
    strn is null or (char_length(strn) <= 40 and strn ~ '^[0-9][0-9 -]*[0-9]$')
  ),
  add constraint companies_invoice_address_not_blank check (
    invoice_address is null or (btrim(invoice_address) <> '' and char_length(invoice_address) <= 500)
  );

comment on column public.companies.ntn is
  'Buyer NTN, or the 13-digit CNIC of a person. Printed on sales-tax invoices (STA 1990 s.23(1)(b)). Optional (0072).';
comment on column public.companies.strn is
  'Buyer sales-tax registration number. A registered buyer''s invoice cannot be printed without it (0072).';
comment on column public.companies.sales_tax_registered is
  'Registered for sales tax: true, false, or NULL when not known yet. With NULL and no STRN the invoice PDF asks first (0072).';
comment on column public.companies.invoice_address is
  'The buyer address printed on a sales-tax invoice. Empty: the order''s delivery site address is used (0072).';
