
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "attachments": {
                  Row: {
                    "bucket": string,"clarification_id": string | null,"created_at": string,"created_by": string | null,"expense_id": string | null,"file_name": string,"id": string,"invoice_id": string | null,"mime_type": string,"order_id": string | null,"path": string,"rfq_id": string | null,"size_bytes": number
                  }
                  ComputedFields: never
                  Insert: {
                    "bucket": string,"clarification_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"expense_id"?: string | null,"file_name": string,"id"?: string,"invoice_id"?: string | null,"mime_type": string,"order_id"?: string | null,"path": string,"rfq_id"?: string | null,"size_bytes": number
                  }
                  Update: {
                    "bucket"?: string,"clarification_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"expense_id"?: string | null,"file_name"?: string,"id"?: string,"invoice_id"?: string | null,"mime_type"?: string,"order_id"?: string | null,"path"?: string,"rfq_id"?: string | null,"size_bytes"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "attachments_clarification_id_fkey"
      columns: ["clarification_id"]
isOneToOne: false
      referencedRelation: "clarifications"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attachments_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attachments_expense_id_fkey"
      columns: ["expense_id"]
isOneToOne: false
      referencedRelation: "expenses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attachments_invoice_id_fkey"
      columns: ["invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attachments_invoice_id_fkey"
      columns: ["invoice_id"]
isOneToOne: false
      referencedRelation: "v_gst_register"
      referencedColumns: ["invoice_id"]
    },{
      foreignKeyName: "attachments_invoice_id_fkey"
      columns: ["invoice_id"]
isOneToOne: false
      referencedRelation: "v_invoice_state"
      referencedColumns: ["invoice_id"]
    },{
      foreignKeyName: "attachments_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attachments_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_basis"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "attachments_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_items_total"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "attachments_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_money"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "attachments_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_state"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "attachments_rfq_id_fkey"
      columns: ["rfq_id"]
isOneToOne: false
      referencedRelation: "rfqs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attachments_rfq_id_fkey"
      columns: ["rfq_id"]
isOneToOne: false
      referencedRelation: "v_rfq_state"
      referencedColumns: ["rfq_id"]
    }
                  ]
                },"audit_log": {
                  Row: {
                    "action": string,"changed_at": string,"changed_by": string | null,"id": string,"new_value": Json | null,"old_value": Json | null,"record_id": string,"table_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"changed_at"?: string,"changed_by"?: string | null,"id"?: string,"new_value"?: Json | null,"old_value"?: Json | null,"record_id": string,"table_name": string
                  }
                  Update: {
                    "action"?: string,"changed_at"?: string,"changed_by"?: string | null,"id"?: string,"new_value"?: Json | null,"old_value"?: Json | null,"record_id"?: string,"table_name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"brands": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"kind": string,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"kind"?: string,"name": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"kind"?: string,"name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "brands_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"clarifications": {
                  Row: {
                    "answer": string | null,"answered_at": string | null,"ask_count": number,"created_at": string,"created_by": string | null,"first_asked_at": string | null,"id": string,"last_asked_at": string | null,"last_asked_by": string | null,"question": string,"raised_by_inquiry_id": string | null,"rfq_id": string,"rfq_item_id": string | null,"withdrawn_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "answer"?: string | null,"answered_at"?: string | null,"ask_count"?: number,"created_at"?: string,"created_by"?: string | null,"first_asked_at"?: string | null,"id"?: string,"last_asked_at"?: string | null,"last_asked_by"?: string | null,"question": string,"raised_by_inquiry_id"?: string | null,"rfq_id": string,"rfq_item_id"?: string | null,"withdrawn_at"?: string | null
                  }
                  Update: {
                    "answer"?: string | null,"answered_at"?: string | null,"ask_count"?: number,"created_at"?: string,"created_by"?: string | null,"first_asked_at"?: string | null,"id"?: string,"last_asked_at"?: string | null,"last_asked_by"?: string | null,"question"?: string,"raised_by_inquiry_id"?: string | null,"rfq_id"?: string,"rfq_item_id"?: string | null,"withdrawn_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "clarifications_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "clarifications_raised_by_inquiry_id_fkey"
      columns: ["raised_by_inquiry_id"]
isOneToOne: false
      referencedRelation: "supplier_inquiries"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "clarifications_raised_by_inquiry_id_fkey"
      columns: ["raised_by_inquiry_id"]
isOneToOne: false
      referencedRelation: "v_inquiry_state"
      referencedColumns: ["inquiry_id"]
    },{
      foreignKeyName: "clarifications_raised_by_inquiry_id_fkey"
      columns: ["raised_by_inquiry_id"]
isOneToOne: false
      referencedRelation: "v_supplier_activity"
      referencedColumns: ["inquiry_id"]
    },{
      foreignKeyName: "clarifications_rfq_id_fkey"
      columns: ["rfq_id"]
isOneToOne: false
      referencedRelation: "rfqs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "clarifications_rfq_id_fkey"
      columns: ["rfq_id"]
isOneToOne: false
      referencedRelation: "v_rfq_state"
      referencedColumns: ["rfq_id"]
    },{
      foreignKeyName: "clarifications_rfq_item_id_fkey"
      columns: ["rfq_item_id"]
isOneToOne: false
      referencedRelation: "rfq_items"
      referencedColumns: ["id"]
    }
                  ]
                },"closed_months": {
                  Row: {
                    "closed_at": string,"closed_by": string,"month": string,"note": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "closed_at"?: string,"closed_by"?: string,"month": string,"note"?: string | null
                  }
                  Update: {
                    "closed_at"?: string,"closed_by"?: string,"month"?: string,"note"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "closed_months_closed_by_fkey"
      columns: ["closed_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"companies": {
                  Row: {
                    "city": string | null,"country": string | null,"created_at": string,"created_by": string | null,"id": string,"legacy_flags": (string)[],"legacy_source": Json | null,"name": string,"notes": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "city"?: string | null,"country"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"name": string,"notes"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "city"?: string | null,"country"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"name"?: string,"notes"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "companies_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"company_brands": {
                  Row: {
                    "brand_id": string,"company_id": string,"created_at": string,"created_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "brand_id": string,"company_id": string,"created_at"?: string,"created_by"?: string | null
                  }
                  Update: {
                    "brand_id"?: string,"company_id"?: string,"created_at"?: string,"created_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "company_brands_brand_id_fkey"
      columns: ["brand_id"]
isOneToOne: false
      referencedRelation: "brands"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "company_brands_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "company_brands_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "v_company_roles"
      referencedColumns: ["company_id"]
    },{
      foreignKeyName: "company_brands_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "v_supplier_stats"
      referencedColumns: ["supplier_id"]
    },{
      foreignKeyName: "company_brands_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"company_profile": {
                  Row: {
                    "address": string | null,"bank_account_title": string | null,"bank_iban": string | null,"bank_name": string | null,"email": string | null,"id": number,"legal_name": string | null,"ntn": string | null,"phone": string | null,"po_terms": string | null,"quotation_terms": string | null,"quotation_validity_days": number,"strn": string | null,"updated_at": string,"updated_by": string | null,"website": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"bank_account_title"?: string | null,"bank_iban"?: string | null,"bank_name"?: string | null,"email"?: string | null,"id"?: number,"legal_name"?: string | null,"ntn"?: string | null,"phone"?: string | null,"po_terms"?: string | null,"quotation_terms"?: string | null,"quotation_validity_days"?: number,"strn"?: string | null,"updated_at"?: string,"updated_by"?: string | null,"website"?: string | null
                  }
                  Update: {
                    "address"?: string | null,"bank_account_title"?: string | null,"bank_iban"?: string | null,"bank_name"?: string | null,"email"?: string | null,"id"?: number,"legal_name"?: string | null,"ntn"?: string | null,"phone"?: string | null,"po_terms"?: string | null,"quotation_terms"?: string | null,"quotation_validity_days"?: number,"strn"?: string | null,"updated_at"?: string,"updated_by"?: string | null,"website"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "company_profile_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"company_sites": {
                  Row: {
                    "address": string | null,"company_id": string,"created_at": string,"created_by": string | null,"id": string,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"company_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"name": string
                  }
                  Update: {
                    "address"?: string | null,"company_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "company_sites_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "company_sites_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "v_company_roles"
      referencedColumns: ["company_id"]
    },{
      foreignKeyName: "company_sites_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "v_supplier_stats"
      referencedColumns: ["supplier_id"]
    },{
      foreignKeyName: "company_sites_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"contacts": {
                  Row: {
                    "company_id": string,"created_at": string,"created_by": string | null,"email": string | null,"id": string,"job_title": string | null,"name": string,"notes": string | null,"phone": string | null,"site_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "company_id": string,"created_at"?: string,"created_by"?: string | null,"email"?: string | null,"id"?: string,"job_title"?: string | null,"name": string,"notes"?: string | null,"phone"?: string | null,"site_id"?: string | null
                  }
                  Update: {
                    "company_id"?: string,"created_at"?: string,"created_by"?: string | null,"email"?: string | null,"id"?: string,"job_title"?: string | null,"name"?: string,"notes"?: string | null,"phone"?: string | null,"site_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "contacts_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contacts_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "v_company_roles"
      referencedColumns: ["company_id"]
    },{
      foreignKeyName: "contacts_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "v_supplier_stats"
      referencedColumns: ["supplier_id"]
    },{
      foreignKeyName: "contacts_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contacts_site_id_fkey"
      columns: ["site_id"]
isOneToOne: false
      referencedRelation: "company_sites"
      referencedColumns: ["id"]
    }
                  ]
                },"expense_categories": {
                  Row: {
                    "active": boolean,"created_at": string,"created_by": string | null,"default_paid_via": string,"grp": string,"id": string,"name": string,"sort": number
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"created_by"?: string | null,"default_paid_via"?: string,"grp": string,"id"?: string,"name": string,"sort"?: number
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"created_by"?: string | null,"default_paid_via"?: string,"grp"?: string,"id"?: string,"name"?: string,"sort"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "expense_categories_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"expenses": {
                  Row: {
                    "amount_pkr": number,"bank_month": string | null,"category_id": string,"created_at": string,"created_by": string | null,"description": string | null,"id": string,"input_tax_pkr": number,"legacy_flags": (string)[],"legacy_source": Json | null,"order_id": string | null,"paid_on": string,"paid_via": string,"payee_id": string | null,"period": string | null,"recurring_id": string | null,"reference": string | null,"supplier_order_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_pkr": number,"bank_month"?: string | null,"category_id": string,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"input_tax_pkr"?: number,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"order_id"?: string | null,"paid_on"?: string,"paid_via": string,"payee_id"?: string | null,"period"?: string | null,"recurring_id"?: string | null,"reference"?: string | null,"supplier_order_id"?: string | null
                  }
                  Update: {
                    "amount_pkr"?: number,"bank_month"?: string | null,"category_id"?: string,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"input_tax_pkr"?: number,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"order_id"?: string | null,"paid_on"?: string,"paid_via"?: string,"payee_id"?: string | null,"period"?: string | null,"recurring_id"?: string | null,"reference"?: string | null,"supplier_order_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "expenses_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "expense_categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "v_month_expense_category"
      referencedColumns: ["category_id"]
    },{
      foreignKeyName: "expenses_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_basis"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "expenses_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_items_total"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "expenses_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_money"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "expenses_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_state"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "expenses_payee_id_fkey"
      columns: ["payee_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_payee_id_fkey"
      columns: ["payee_id"]
isOneToOne: false
      referencedRelation: "v_company_roles"
      referencedColumns: ["company_id"]
    },{
      foreignKeyName: "expenses_payee_id_fkey"
      columns: ["payee_id"]
isOneToOne: false
      referencedRelation: "v_supplier_stats"
      referencedColumns: ["supplier_id"]
    },{
      foreignKeyName: "expenses_recurring_id_fkey"
      columns: ["recurring_id"]
isOneToOne: false
      referencedRelation: "recurring_expenses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_supplier_order_id_fkey"
      columns: ["supplier_order_id"]
isOneToOne: false
      referencedRelation: "supplier_orders"
      referencedColumns: ["id"]
    }
                  ]
                },"fx_fetch_log": {
                  Row: {
                    "batch_id": string | null,"created_at": string,"currency": string | null,"detail": string | null,"id": string,"kind": string,"priority": number | null,"processed_at": string | null,"request_id": number | null,"response_at": string | null,"response_body": string | null,"response_status": number | null,"source": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "batch_id"?: string | null,"created_at"?: string,"currency"?: string | null,"detail"?: string | null,"id"?: string,"kind": string,"priority"?: number | null,"processed_at"?: string | null,"request_id"?: number | null,"response_at"?: string | null,"response_body"?: string | null,"response_status"?: number | null,"source"?: string | null
                  }
                  Update: {
                    "batch_id"?: string | null,"created_at"?: string,"currency"?: string | null,"detail"?: string | null,"id"?: string,"kind"?: string,"priority"?: number | null,"processed_at"?: string | null,"request_id"?: number | null,"response_at"?: string | null,"response_body"?: string | null,"response_status"?: number | null,"source"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"fx_rates": {
                  Row: {
                    "as_of": string,"created_at": string,"created_by": string | null,"currency": string,"id": string,"provider": string | null,"rate_pkr": number,"source": string
                  }
                  ComputedFields: never
                  Insert: {
                    "as_of"?: string,"created_at"?: string,"created_by"?: string | null,"currency": string,"id"?: string,"provider"?: string | null,"rate_pkr": number,"source"?: string
                  }
                  Update: {
                    "as_of"?: string,"created_at"?: string,"created_by"?: string | null,"currency"?: string,"id"?: string,"provider"?: string | null,"rate_pkr"?: number,"source"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "fx_rates_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"inquiry_item_declines": {
                  Row: {
                    "created_at": string,"created_by": string | null,"inquiry_id": string,"reason": string,"rfq_item_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"inquiry_id": string,"reason": string,"rfq_item_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"inquiry_id"?: string,"reason"?: string,"rfq_item_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "inquiry_item_declines_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inquiry_item_declines_inquiry_id_fkey"
      columns: ["inquiry_id"]
isOneToOne: false
      referencedRelation: "supplier_inquiries"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inquiry_item_declines_inquiry_id_fkey"
      columns: ["inquiry_id"]
isOneToOne: false
      referencedRelation: "v_inquiry_state"
      referencedColumns: ["inquiry_id"]
    },{
      foreignKeyName: "inquiry_item_declines_inquiry_id_fkey"
      columns: ["inquiry_id"]
isOneToOne: false
      referencedRelation: "v_supplier_activity"
      referencedColumns: ["inquiry_id"]
    },{
      foreignKeyName: "inquiry_item_declines_rfq_item_id_fkey"
      columns: ["rfq_item_id"]
isOneToOne: false
      referencedRelation: "rfq_items"
      referencedColumns: ["id"]
    }
                  ]
                },"invoices": {
                  Row: {
                    "client_received_on": string | null,"company_id": string | null,"copy_received_on": string | null,"created_at": string,"created_by": string | null,"gst_amount": number,"id": string,"invoice_date": string | null,"last_reminded_on": string | null,"legacy_flags": (string)[],"legacy_source": Json | null,"net_amount": number,"notes": string | null,"number": string | null,"order_id": string | null,"psid": string | null,"reminder_count": number,"tax_bank_month": string | null,"tax_deposit_amount": number | null,"tax_deposited_on": string | null,"tcs_number": string | null,"tcs_sent_on": string | null,"updated_at": string,"wasif_receipt_on": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "client_received_on"?: string | null,"company_id"?: string | null,"copy_received_on"?: string | null,"created_at"?: string,"created_by"?: string | null,"gst_amount": number,"id"?: string,"invoice_date"?: string | null,"last_reminded_on"?: string | null,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"net_amount": number,"notes"?: string | null,"number"?: string | null,"order_id"?: string | null,"psid"?: string | null,"reminder_count"?: number,"tax_bank_month"?: string | null,"tax_deposit_amount"?: number | null,"tax_deposited_on"?: string | null,"tcs_number"?: string | null,"tcs_sent_on"?: string | null,"updated_at"?: string,"wasif_receipt_on"?: string | null
                  }
                  Update: {
                    "client_received_on"?: string | null,"company_id"?: string | null,"copy_received_on"?: string | null,"created_at"?: string,"created_by"?: string | null,"gst_amount"?: number,"id"?: string,"invoice_date"?: string | null,"last_reminded_on"?: string | null,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"net_amount"?: number,"notes"?: string | null,"number"?: string | null,"order_id"?: string | null,"psid"?: string | null,"reminder_count"?: number,"tax_bank_month"?: string | null,"tax_deposit_amount"?: number | null,"tax_deposited_on"?: string | null,"tcs_number"?: string | null,"tcs_sent_on"?: string | null,"updated_at"?: string,"wasif_receipt_on"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoices_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoices_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "v_company_roles"
      referencedColumns: ["company_id"]
    },{
      foreignKeyName: "invoices_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "v_supplier_stats"
      referencedColumns: ["supplier_id"]
    },{
      foreignKeyName: "invoices_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoices_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoices_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_basis"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "invoices_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_items_total"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "invoices_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_money"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "invoices_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_state"
      referencedColumns: ["order_id"]
    }
                  ]
                },"order_costs": {
                  Row: {
                    "costs_complete_at": string | null,"costs_complete_by": string | null,"created_at": string,"created_by": string | null,"expected_cost_pkr": number | null,"order_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "costs_complete_at"?: string | null,"costs_complete_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"expected_cost_pkr"?: number | null,"order_id": string,"updated_at"?: string
                  }
                  Update: {
                    "costs_complete_at"?: string | null,"costs_complete_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"expected_cost_pkr"?: number | null,"order_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_costs_costs_complete_by_fkey"
      columns: ["costs_complete_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_costs_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_costs_order_id_fkey"
      columns: ["order_id"]
isOneToOne: true
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_costs_order_id_fkey"
      columns: ["order_id"]
isOneToOne: true
      referencedRelation: "v_order_basis"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "order_costs_order_id_fkey"
      columns: ["order_id"]
isOneToOne: true
      referencedRelation: "v_order_items_total"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "order_costs_order_id_fkey"
      columns: ["order_id"]
isOneToOne: true
      referencedRelation: "v_order_money"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "order_costs_order_id_fkey"
      columns: ["order_id"]
isOneToOne: true
      referencedRelation: "v_order_state"
      referencedColumns: ["order_id"]
    }
                  ]
                },"order_engineers": {
                  Row: {
                    "order_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "order_id": string,"user_id": string
                  }
                  Update: {
                    "order_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_engineers_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_engineers_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_basis"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "order_engineers_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_items_total"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "order_engineers_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_money"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "order_engineers_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_state"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "order_engineers_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"order_items": {
                  Row: {
                    "brand_id": string | null,"created_at": string,"created_by": string | null,"description": string,"family_id": string | null,"gst_rate": number,"id": string,"is_service": boolean,"legacy_flags": (string)[],"legacy_source": Json | null,"model_tokens": (string)[],"order_id": string,"position": number,"qty": number,"rfq_item_id": string | null,"supplier_order_id": string | null,"supplier_unit_price": number | null,"unit": string | null,"unit_price_net": number
                  }
                  ComputedFields: never
                  Insert: {
                    "brand_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"description": string,"family_id"?: string | null,"gst_rate"?: number,"id"?: string,"is_service"?: boolean,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"model_tokens"?: never,"order_id": string,"position"?: number,"qty"?: number,"rfq_item_id"?: string | null,"supplier_order_id"?: string | null,"supplier_unit_price"?: number | null,"unit"?: string | null,"unit_price_net": number
                  }
                  Update: {
                    "brand_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string,"family_id"?: string | null,"gst_rate"?: number,"id"?: string,"is_service"?: boolean,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"model_tokens"?: never,"order_id"?: string,"position"?: number,"qty"?: number,"rfq_item_id"?: string | null,"supplier_order_id"?: string | null,"supplier_unit_price"?: number | null,"unit"?: string | null,"unit_price_net"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_items_brand_id_fkey"
      columns: ["brand_id"]
isOneToOne: false
      referencedRelation: "brands"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_items_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_items_family_id_fkey"
      columns: ["family_id"]
isOneToOne: false
      referencedRelation: "brands"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_items_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_items_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_basis"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "order_items_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_items_total"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "order_items_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_money"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "order_items_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_state"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "order_items_rfq_item_id_fkey"
      columns: ["rfq_item_id"]
isOneToOne: false
      referencedRelation: "rfq_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_items_supplier_order_id_fkey"
      columns: ["supplier_order_id"]
isOneToOne: false
      referencedRelation: "supplier_orders"
      referencedColumns: ["id"]
    }
                  ]
                },"orders": {
                  Row: {
                    "cancel_reason": string | null,"cancelled_on": string | null,"commissioning_done_on": string | null,"commissioning_planned_on": string | null,"company_id": string,"contact_id": string | null,"created_at": string,"created_by": string | null,"customer_po_number": string | null,"id": string,"legacy_flags": (string)[],"legacy_source": Json | null,"needs_commissioning": boolean,"notes": string | null,"number": number,"ordered_on": string | null,"owner_id": string | null,"payment_terms_days": number | null,"rfq_id": string | null,"site_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cancel_reason"?: string | null,"cancelled_on"?: string | null,"commissioning_done_on"?: string | null,"commissioning_planned_on"?: string | null,"company_id": string,"contact_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"customer_po_number"?: string | null,"id"?: string,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"needs_commissioning"?: boolean,"notes"?: string | null,"number"?: never,"ordered_on"?: string | null,"owner_id"?: string | null,"payment_terms_days"?: number | null,"rfq_id"?: string | null,"site_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "cancel_reason"?: string | null,"cancelled_on"?: string | null,"commissioning_done_on"?: string | null,"commissioning_planned_on"?: string | null,"company_id"?: string,"contact_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"customer_po_number"?: string | null,"id"?: string,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"needs_commissioning"?: boolean,"notes"?: string | null,"number"?: never,"ordered_on"?: string | null,"owner_id"?: string | null,"payment_terms_days"?: number | null,"rfq_id"?: string | null,"site_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "orders_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "v_company_roles"
      referencedColumns: ["company_id"]
    },{
      foreignKeyName: "orders_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "v_supplier_stats"
      referencedColumns: ["supplier_id"]
    },{
      foreignKeyName: "orders_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_rfq_id_fkey"
      columns: ["rfq_id"]
isOneToOne: false
      referencedRelation: "rfqs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_rfq_id_fkey"
      columns: ["rfq_id"]
isOneToOne: false
      referencedRelation: "v_rfq_state"
      referencedColumns: ["rfq_id"]
    },{
      foreignKeyName: "orders_site_id_fkey"
      columns: ["site_id"]
isOneToOne: false
      referencedRelation: "company_sites"
      referencedColumns: ["id"]
    }
                  ]
                },"payments_in": {
                  Row: {
                    "amount": number,"bank_month": string | null,"created_at": string,"created_by": string | null,"credited_user_id": string | null,"id": string,"legacy_flags": (string)[],"legacy_source": Json | null,"order_id": string,"paid_via": string,"received_on": string,"reference": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"bank_month"?: string | null,"created_at"?: string,"created_by"?: string | null,"credited_user_id"?: string | null,"id"?: string,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"order_id": string,"paid_via"?: string,"received_on"?: string,"reference"?: string | null
                  }
                  Update: {
                    "amount"?: number,"bank_month"?: string | null,"created_at"?: string,"created_by"?: string | null,"credited_user_id"?: string | null,"id"?: string,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"order_id"?: string,"paid_via"?: string,"received_on"?: string,"reference"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_in_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_in_credited_user_id_fkey"
      columns: ["credited_user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_in_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_in_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_basis"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "payments_in_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_items_total"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "payments_in_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_money"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "payments_in_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_state"
      referencedColumns: ["order_id"]
    }
                  ]
                },"purchase_orders": {
                  Row: {
                    "created_at": string,"created_by": string | null,"currency": string,"delivery_terms": string | null,"id": string,"incoterm": string | null,"issued_on": string,"lines": NonNullable<Json>,"notes": string | null,"number": number,"payment_terms": string | null,"pdf_path": string | null,"revision": number,"ship_to": string | null,"signatory_id": string,"supplier_order_id": string,"total": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"currency": string,"delivery_terms"?: string | null,"id"?: string,"incoterm"?: string | null,"issued_on"?: string,"lines": NonNullable<Json>,"notes"?: string | null,"number": number,"payment_terms"?: string | null,"pdf_path"?: string | null,"revision"?: number,"ship_to"?: string | null,"signatory_id"?: string,"supplier_order_id": string,"total": number
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"currency"?: string,"delivery_terms"?: string | null,"id"?: string,"incoterm"?: string | null,"issued_on"?: string,"lines"?: NonNullable<Json>,"notes"?: string | null,"number"?: number,"payment_terms"?: string | null,"pdf_path"?: string | null,"revision"?: number,"ship_to"?: string | null,"signatory_id"?: string,"supplier_order_id"?: string,"total"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "purchase_orders_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "purchase_orders_signatory_id_fkey"
      columns: ["signatory_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "purchase_orders_supplier_order_id_fkey"
      columns: ["supplier_order_id"]
isOneToOne: false
      referencedRelation: "supplier_orders"
      referencedColumns: ["id"]
    }
                  ]
                },"quotations": {
                  Row: {
                    "contact_id": string | null,"created_at": string,"created_by": string | null,"delivery_text": string | null,"gst_total": number,"id": string,"issued_on": string,"lines": NonNullable<Json>,"net_total": number,"notes": string | null,"number": number,"payment_terms": string | null,"pdf_path": string | null,"revision": number,"rfq_id": string,"signatory_id": string,"valid_until": string
                  }
                  ComputedFields: never
                  Insert: {
                    "contact_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"delivery_text"?: string | null,"gst_total": number,"id"?: string,"issued_on"?: string,"lines": NonNullable<Json>,"net_total": number,"notes"?: string | null,"number": number,"payment_terms"?: string | null,"pdf_path"?: string | null,"revision"?: number,"rfq_id": string,"signatory_id"?: string,"valid_until": string
                  }
                  Update: {
                    "contact_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"delivery_text"?: string | null,"gst_total"?: number,"id"?: string,"issued_on"?: string,"lines"?: NonNullable<Json>,"net_total"?: number,"notes"?: string | null,"number"?: number,"payment_terms"?: string | null,"pdf_path"?: string | null,"revision"?: number,"rfq_id"?: string,"signatory_id"?: string,"valid_until"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "quotations_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quotations_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quotations_rfq_id_fkey"
      columns: ["rfq_id"]
isOneToOne: false
      referencedRelation: "rfqs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quotations_rfq_id_fkey"
      columns: ["rfq_id"]
isOneToOne: false
      referencedRelation: "v_rfq_state"
      referencedColumns: ["rfq_id"]
    },{
      foreignKeyName: "quotations_signatory_id_fkey"
      columns: ["signatory_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"recurring_expenses": {
                  Row: {
                    "active": boolean,"amount": number,"category_id": string,"created_at": string,"created_by": string | null,"day_of_month": number | null,"id": string,"label": string,"notes": string | null,"start_month": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"amount": number,"category_id": string,"created_at"?: string,"created_by"?: string | null,"day_of_month"?: number | null,"id"?: string,"label": string,"notes"?: string | null,"start_month"?: string | null
                  }
                  Update: {
                    "active"?: boolean,"amount"?: number,"category_id"?: string,"created_at"?: string,"created_by"?: string | null,"day_of_month"?: number | null,"id"?: string,"label"?: string,"notes"?: string | null,"start_month"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "recurring_expenses_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "expense_categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "recurring_expenses_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "v_month_expense_category"
      referencedColumns: ["category_id"]
    },{
      foreignKeyName: "recurring_expenses_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"rfq_items": {
                  Row: {
                    "brand_id": string | null,"created_at": string,"created_by": string | null,"description": string,"family_id": string | null,"gst_rate": number,"id": string,"legacy_flags": (string)[],"legacy_source": Json | null,"model_tokens": (string)[],"position": number,"qty": number,"quoted_lead_time": string | null,"quoted_unit_price_net": number | null,"rfq_id": string,"unit": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "brand_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"description": string,"family_id"?: string | null,"gst_rate"?: number,"id"?: string,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"model_tokens"?: never,"position"?: number,"qty"?: number,"quoted_lead_time"?: string | null,"quoted_unit_price_net"?: number | null,"rfq_id": string,"unit"?: string | null
                  }
                  Update: {
                    "brand_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string,"family_id"?: string | null,"gst_rate"?: number,"id"?: string,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"model_tokens"?: never,"position"?: number,"qty"?: number,"quoted_lead_time"?: string | null,"quoted_unit_price_net"?: number | null,"rfq_id"?: string,"unit"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "rfq_items_brand_id_fkey"
      columns: ["brand_id"]
isOneToOne: false
      referencedRelation: "brands"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rfq_items_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rfq_items_family_id_fkey"
      columns: ["family_id"]
isOneToOne: false
      referencedRelation: "brands"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rfq_items_rfq_id_fkey"
      columns: ["rfq_id"]
isOneToOne: false
      referencedRelation: "rfqs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rfq_items_rfq_id_fkey"
      columns: ["rfq_id"]
isOneToOne: false
      referencedRelation: "v_rfq_state"
      referencedColumns: ["rfq_id"]
    }
                  ]
                },"rfqs": {
                  Row: {
                    "close_note": string | null,"close_reason": string | null,"closed_on": string | null,"company_id": string,"contact_id": string | null,"created_at": string,"created_by": string | null,"customer_ref": string | null,"due_on": string | null,"due_time": string | null,"id": string,"is_priority": boolean,"legacy_flags": (string)[],"legacy_source": Json | null,"notes": string | null,"number": number,"owner_id": string | null,"quoted_on": string | null,"received_on": string,"site_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "close_note"?: string | null,"close_reason"?: string | null,"closed_on"?: string | null,"company_id": string,"contact_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"customer_ref"?: string | null,"due_on"?: string | null,"due_time"?: string | null,"id"?: string,"is_priority"?: boolean,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"notes"?: string | null,"number"?: never,"owner_id"?: string | null,"quoted_on"?: string | null,"received_on"?: string,"site_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "close_note"?: string | null,"close_reason"?: string | null,"closed_on"?: string | null,"company_id"?: string,"contact_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"customer_ref"?: string | null,"due_on"?: string | null,"due_time"?: string | null,"id"?: string,"is_priority"?: boolean,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"notes"?: string | null,"number"?: never,"owner_id"?: string | null,"quoted_on"?: string | null,"received_on"?: string,"site_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "rfqs_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rfqs_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "v_company_roles"
      referencedColumns: ["company_id"]
    },{
      foreignKeyName: "rfqs_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "v_supplier_stats"
      referencedColumns: ["supplier_id"]
    },{
      foreignKeyName: "rfqs_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rfqs_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rfqs_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rfqs_site_id_fkey"
      columns: ["site_id"]
isOneToOne: false
      referencedRelation: "company_sites"
      referencedColumns: ["id"]
    }
                  ]
                },"snoozes": {
                  Row: {
                    "created_at": string,"id": string,"rule": string,"subject_id": string,"until_on": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"rule": string,"subject_id": string,"until_on": string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"rule"?: string,"subject_id"?: string,"until_on"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "snoozes_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"supplier_inquiries": {
                  Row: {
                    "chase_count": number,"created_at": string,"created_by": string | null,"id": string,"last_chased_by": string | null,"last_chased_on": string | null,"last_relayed_at": string | null,"legacy_flags": (string)[],"legacy_source": Json | null,"no_offer_on": string | null,"no_offer_reason": string | null,"notes": string | null,"rfq_id": string,"sent_on": string | null,"supplier_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "chase_count"?: number,"created_at"?: string,"created_by"?: string | null,"id"?: string,"last_chased_by"?: string | null,"last_chased_on"?: string | null,"last_relayed_at"?: string | null,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"no_offer_on"?: string | null,"no_offer_reason"?: string | null,"notes"?: string | null,"rfq_id": string,"sent_on"?: string | null,"supplier_id": string
                  }
                  Update: {
                    "chase_count"?: number,"created_at"?: string,"created_by"?: string | null,"id"?: string,"last_chased_by"?: string | null,"last_chased_on"?: string | null,"last_relayed_at"?: string | null,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"no_offer_on"?: string | null,"no_offer_reason"?: string | null,"notes"?: string | null,"rfq_id"?: string,"sent_on"?: string | null,"supplier_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "supplier_inquiries_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supplier_inquiries_rfq_id_fkey"
      columns: ["rfq_id"]
isOneToOne: false
      referencedRelation: "rfqs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supplier_inquiries_rfq_id_fkey"
      columns: ["rfq_id"]
isOneToOne: false
      referencedRelation: "v_rfq_state"
      referencedColumns: ["rfq_id"]
    },{
      foreignKeyName: "supplier_inquiries_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supplier_inquiries_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "v_company_roles"
      referencedColumns: ["company_id"]
    },{
      foreignKeyName: "supplier_inquiries_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "v_supplier_stats"
      referencedColumns: ["supplier_id"]
    }
                  ]
                },"supplier_orders": {
                  Row: {
                    "chase_count": number,"created_at": string,"created_by": string | null,"currency": string | null,"delivered_on": string | null,"expected_on": string | null,"id": string,"inquiry_id": string | null,"last_chased_by": string | null,"last_chased_on": string | null,"legacy_flags": (string)[],"legacy_source": Json | null,"order_id": string,"placed_on": string | null,"received_on": string | null,"reference": string | null,"supplier_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "chase_count"?: number,"created_at"?: string,"created_by"?: string | null,"currency"?: string | null,"delivered_on"?: string | null,"expected_on"?: string | null,"id"?: string,"inquiry_id"?: string | null,"last_chased_by"?: string | null,"last_chased_on"?: string | null,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"order_id": string,"placed_on"?: string | null,"received_on"?: string | null,"reference"?: string | null,"supplier_id": string
                  }
                  Update: {
                    "chase_count"?: number,"created_at"?: string,"created_by"?: string | null,"currency"?: string | null,"delivered_on"?: string | null,"expected_on"?: string | null,"id"?: string,"inquiry_id"?: string | null,"last_chased_by"?: string | null,"last_chased_on"?: string | null,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"order_id"?: string,"placed_on"?: string | null,"received_on"?: string | null,"reference"?: string | null,"supplier_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "supplier_orders_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supplier_orders_inquiry_id_fkey"
      columns: ["inquiry_id"]
isOneToOne: false
      referencedRelation: "supplier_inquiries"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supplier_orders_inquiry_id_fkey"
      columns: ["inquiry_id"]
isOneToOne: false
      referencedRelation: "v_inquiry_state"
      referencedColumns: ["inquiry_id"]
    },{
      foreignKeyName: "supplier_orders_inquiry_id_fkey"
      columns: ["inquiry_id"]
isOneToOne: false
      referencedRelation: "v_supplier_activity"
      referencedColumns: ["inquiry_id"]
    },{
      foreignKeyName: "supplier_orders_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supplier_orders_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_basis"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "supplier_orders_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_items_total"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "supplier_orders_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_money"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "supplier_orders_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_state"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "supplier_orders_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supplier_orders_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "v_company_roles"
      referencedColumns: ["company_id"]
    },{
      foreignKeyName: "supplier_orders_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "v_supplier_stats"
      referencedColumns: ["supplier_id"]
    }
                  ]
                },"supplier_quote_lines": {
                  Row: {
                    "created_at": string,"created_by": string | null,"currency": string,"fx_rate_on": string | null,"fx_rate_pkr": number | null,"id": string,"in_stock": boolean | null,"inquiry_id": string,"lead_time": string | null,"legacy_flags": (string)[],"legacy_source": Json | null,"notes": string | null,"origin": string | null,"rfq_item_id": string,"unit_price": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"currency": string,"fx_rate_on"?: string | null,"fx_rate_pkr"?: number | null,"id"?: string,"in_stock"?: boolean | null,"inquiry_id": string,"lead_time"?: string | null,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"notes"?: string | null,"origin"?: string | null,"rfq_item_id": string,"unit_price": number
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"currency"?: string,"fx_rate_on"?: string | null,"fx_rate_pkr"?: number | null,"id"?: string,"in_stock"?: boolean | null,"inquiry_id"?: string,"lead_time"?: string | null,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"notes"?: string | null,"origin"?: string | null,"rfq_item_id"?: string,"unit_price"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "supplier_quote_lines_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supplier_quote_lines_inquiry_id_fkey"
      columns: ["inquiry_id"]
isOneToOne: false
      referencedRelation: "supplier_inquiries"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supplier_quote_lines_inquiry_id_fkey"
      columns: ["inquiry_id"]
isOneToOne: false
      referencedRelation: "v_inquiry_state"
      referencedColumns: ["inquiry_id"]
    },{
      foreignKeyName: "supplier_quote_lines_inquiry_id_fkey"
      columns: ["inquiry_id"]
isOneToOne: false
      referencedRelation: "v_supplier_activity"
      referencedColumns: ["inquiry_id"]
    },{
      foreignKeyName: "supplier_quote_lines_rfq_item_id_fkey"
      columns: ["rfq_item_id"]
isOneToOne: false
      referencedRelation: "rfq_items"
      referencedColumns: ["id"]
    }
                  ]
                },"targets": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"note": string | null,"quarter": number,"target_net_pkr": number,"updated_at": string,"user_id": string,"year": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"note"?: string | null,"quarter": number,"target_net_pkr": number,"updated_at"?: string,"user_id": string,"year": number
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"note"?: string | null,"quarter"?: number,"target_net_pkr"?: number,"updated_at"?: string,"user_id"?: string,"year"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "targets_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "targets_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"users": {
                  Row: {
                    "created_at": string,"deactivated_at": string | null,"id": string,"job_title": string | null,"name": string,"phone": string | null,"role": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"deactivated_at"?: string | null,"id": string,"job_title"?: string | null,"name": string,"phone"?: string | null,"role": string
                  }
                  Update: {
                    "created_at"?: string,"deactivated_at"?: string | null,"id"?: string,"job_title"?: string | null,"name"?: string,"phone"?: string | null,"role"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            "v_cash_month": {
                  Row: {
                    "gross_received": number | null,"gst_received": number | null,"money_out": number | null,"month": string | null,"net_received": number | null,"unresolved_count": number | null,"unresolved_gross": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_company_roles": {
                  Row: {
                    "company_id": string | null,"is_customer": boolean | null,"is_prospect": boolean | null,"is_supplier": boolean | null,"name": string | null,"role": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_fx_latest": {
                  Row: {
                    "age_days": number | null,"as_of": string | null,"currency": string | null,"rate_pkr": number | null,"source": string | null,"staleness": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_gst_month": {
                  Row: {
                    "deposited_amount": number | null,"deposited_count": number | null,"gst": number | null,"gst_to_deposit": number | null,"input_tax": number | null,"invoice_count": number | null,"month": string | null,"net": number | null,"psid_set_count": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_gst_register": {
                  Row: {
                    "company_id": string | null,"company_name": string | null,"courier_state": string | null,"fbr_exception": boolean | null,"fbr_state": string | null,"gross_amount": number | null,"gst_amount": number | null,"invoice_date": string | null,"invoice_id": string | null,"invoice_month": string | null,"needs_fbr_attention": boolean | null,"net_amount": number | null,"number": string | null,"order_id": string | null,"order_number": number | null,"psid": string | null,"tax_deposit_amount": number | null,"tax_deposited_on": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "invoices_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoices_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_basis"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "invoices_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_items_total"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "invoices_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_money"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "invoices_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_state"
      referencedColumns: ["order_id"]
    }
                  ]
                },"v_inquiry_state": {
                  Row: {
                    "answers_to_relay": number | null,"blocked_state": string | null,"chase_count": number | null,"contact_state": string | null,"inquiry_id": string | null,"items_quoted": number | null,"items_total": number | null,"last_chased_on": string | null,"open_questions": number | null,"quote_received_on": string | null,"response_state": string | null,"rfq_id": string | null,"sent_on": string | null,"supplier_id": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "supplier_inquiries_rfq_id_fkey"
      columns: ["rfq_id"]
isOneToOne: false
      referencedRelation: "rfqs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supplier_inquiries_rfq_id_fkey"
      columns: ["rfq_id"]
isOneToOne: false
      referencedRelation: "v_rfq_state"
      referencedColumns: ["rfq_id"]
    },{
      foreignKeyName: "supplier_inquiries_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supplier_inquiries_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "v_company_roles"
      referencedColumns: ["company_id"]
    },{
      foreignKeyName: "supplier_inquiries_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "v_supplier_stats"
      referencedColumns: ["supplier_id"]
    }
                  ]
                },"v_invoice_state": {
                  Row: {
                    "company_id": string | null,"courier_state": string | null,"fbr_exception": boolean | null,"fbr_state": string | null,"gross_amount": number | null,"gst_amount": number | null,"invoice_date": string | null,"invoice_id": string | null,"last_reminded_on": string | null,"needs_fbr_attention": boolean | null,"net_amount": number | null,"number": string | null,"order_id": string | null,"reminder_count": number | null,"reminder_state": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "invoices_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoices_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "v_company_roles"
      referencedColumns: ["company_id"]
    },{
      foreignKeyName: "invoices_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "v_supplier_stats"
      referencedColumns: ["supplier_id"]
    },{
      foreignKeyName: "invoices_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoices_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_basis"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "invoices_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_items_total"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "invoices_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_money"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "invoices_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_state"
      referencedColumns: ["order_id"]
    }
                  ]
                },"v_month_expense_category": {
                  Row: {
                    "category": string | null,"category_id": string | null,"category_sort": number | null,"expense_count": number | null,"gross_paid": number | null,"grp": string | null,"month": string | null,"net_cost": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_month_pnl": {
                  Row: {
                    "after_drawings": number | null,"cash_out_total": number | null,"gst_in": number | null,"input_tax": number | null,"month": string | null,"net_in": number | null,"non_pnl_out": number | null,"order_costs": number | null,"overheads": number | null,"result": number | null,"unresolved_gross": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_month_team": {
                  Row: {
                    "month": string | null,"net_credited": number | null,"payment_count": number | null,"quarter_achieved_net": number | null,"quarter_gap": number | null,"quarter_target_net": number | null,"user_id": string | null,"user_name": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "payments_in_credited_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"v_order_basis": {
                  Row: {
                    "basis": string | null,"g": number | null,"invoice_count": number | null,"invoice_gross": number | null,"invoice_net": number | null,"items_gross": number | null,"items_net": number | null,"n": number | null,"order_id": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_order_items_total": {
                  Row: {
                    "gross": number | null,"gst": number | null,"net": number | null,"order_id": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_order_money": {
                  Row: {
                    "actual_cost": number | null,"basis": string | null,"company_id": string | null,"costs_state": string | null,"data_trust": string | null,"due_on": string | null,"expected_cost": number | null,"gross_target": number | null,"margin": number | null,"margin_state": string | null,"net_sale": number | null,"order_id": string | null,"order_number": number | null,"overpaid_by": number | null,"owner_id": string | null,"payment_state": string | null,"receivable": number | null,"settled": number | null,"settled_ok": boolean | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "orders_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "v_company_roles"
      referencedColumns: ["company_id"]
    },{
      foreignKeyName: "orders_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "v_supplier_stats"
      referencedColumns: ["supplier_id"]
    },{
      foreignKeyName: "orders_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"v_order_state": {
                  Row: {
                    "commissioning_state": string | null,"company_id": string | null,"data_trust": string | null,"goods_state": string | null,"gross": number | null,"gst": number | null,"invoiced": number | null,"invoicing_state": string | null,"is_done": boolean | null,"lifecycle": string | null,"net": number | null,"number": number | null,"order_id": string | null,"owner_id": string | null,"rfq_id": string | null,"site_id": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "orders_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "v_company_roles"
      referencedColumns: ["company_id"]
    },{
      foreignKeyName: "orders_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "v_supplier_stats"
      referencedColumns: ["supplier_id"]
    },{
      foreignKeyName: "orders_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_rfq_id_fkey"
      columns: ["rfq_id"]
isOneToOne: false
      referencedRelation: "rfqs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_rfq_id_fkey"
      columns: ["rfq_id"]
isOneToOne: false
      referencedRelation: "v_rfq_state"
      referencedColumns: ["rfq_id"]
    },{
      foreignKeyName: "orders_site_id_fkey"
      columns: ["site_id"]
isOneToOne: false
      referencedRelation: "company_sites"
      referencedColumns: ["id"]
    }
                  ]
                },"v_payment_net": {
                  Row: {
                    "amount": number | null,"basis": string | null,"counts_in_cash_net": boolean | null,"counts_in_target": boolean | null,"credited_user_id": string | null,"excluded_reason": string | null,"g": number | null,"gst_portion": number | null,"n": number | null,"net_portion": number | null,"order_id": string | null,"payment_id": string | null,"received_on": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "payments_in_credited_user_id_fkey"
      columns: ["credited_user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_in_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_in_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_basis"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "payments_in_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_items_total"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "payments_in_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_money"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "payments_in_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "v_order_state"
      referencedColumns: ["order_id"]
    }
                  ]
                },"v_rfq_state": {
                  Row: {
                    "bid_state": string | null,"clarification_state": string | null,"close_reason": string | null,"closed_on": string | null,"company_id": string | null,"days_to_due": number | null,"due_on": string | null,"floated": number | null,"is_overdue": boolean | null,"is_priority": boolean | null,"items_quoted": number | null,"items_total": number | null,"items_uncovered": number | null,"number": number | null,"outcome": string | null,"outcome_clash": boolean | null,"owner_id": string | null,"quotation_valid_until": string | null,"quoted_on": string | null,"received_on": string | null,"responders": number | null,"rfq_id": string | null,"sourcing_state": string | null,"to_ask": number | null,"to_relay": number | null,"waiting": number | null,"waiting_days": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "rfqs_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rfqs_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "v_company_roles"
      referencedColumns: ["company_id"]
    },{
      foreignKeyName: "rfqs_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "v_supplier_stats"
      referencedColumns: ["supplier_id"]
    },{
      foreignKeyName: "rfqs_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"v_supplier_activity": {
                  Row: {
                    "first_reply_on": string | null,"inquiry_id": string | null,"is_legacy": boolean | null,"no_offer": boolean | null,"quoted": boolean | null,"replied": boolean | null,"reply_days": number | null,"rfq_id": string | null,"sent_on": string | null,"supplier_id": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "supplier_inquiries_rfq_id_fkey"
      columns: ["rfq_id"]
isOneToOne: false
      referencedRelation: "rfqs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supplier_inquiries_rfq_id_fkey"
      columns: ["rfq_id"]
isOneToOne: false
      referencedRelation: "v_rfq_state"
      referencedColumns: ["rfq_id"]
    },{
      foreignKeyName: "supplier_inquiries_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supplier_inquiries_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "v_company_roles"
      referencedColumns: ["company_id"]
    },{
      foreignKeyName: "supplier_inquiries_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "v_supplier_stats"
      referencedColumns: ["supplier_id"]
    }
                  ]
                },"v_supplier_stats": {
                  Row: {
                    "asked": number | null,"brand_ids": (string)[] | null,"brand_names": (string)[] | null,"chosen": number | null,"chosen_of": number | null,"deliveries": number | null,"last_contact": string | null,"late": number | null,"legacy_asked": number | null,"median_days_late": number | null,"median_reply_days": number | null,"no_offer": number | null,"prices_hidden": number | null,"quoted": number | null,"replied": number | null,"reply_days_n": number | null,"supplier_id": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_target_progress": {
                  Row: {
                    "achieved_net": number | null,"behind_pace": number | null,"excluded_count": number | null,"gap": number | null,"on_pace_net": number | null,"quarter": number | null,"quarter_end": string | null,"quarter_start": string | null,"target_net": number | null,"user_id": string | null,"year": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "aging_as_of":
{ Args: { "p_date": string }; Returns: {
              "advance_held": number,"age_days": number,"applied": number,"bucket": string,"company_id": string,"gross": number,"invoice_date": string,"invoice_id": string,"invoice_number": string,"kind": string,"order_id": string,"order_number": number,"remaining": number
            }[]
                           },
"apply_fx_payload":
{ Args: { "p_batch"?: string,"p_payload": Json,"p_source": string }; Returns: Json
                           },
"brand_tokens":
{ Args: Record<PropertyKey, never>; Returns: (string)[]
                           },
"brand_words":
{ Args: Record<PropertyKey, never>; Returns: (string)[]
                           },
"can_access_bucket":
{ Args: { "bucket": string }; Returns: boolean
                           },
"close_month":
{ Args: { "p_month": string }; Returns: undefined
                           },
"close_months_through":
{ Args: { "p_month": string }; Returns: number
                           },
"convert_rfq_to_order":
{ Args: { "p_customer_po_number"?: string,"p_items"?: Json,"p_needs_commissioning"?: boolean,"p_order_id": string,"p_ordered_on"?: string,"p_payment_terms_days"?: number,"p_rfq_id": string }; Returns: string
                           },
"create_repeat_order":
{ Args: { "p_customer_po_number"?: string,"p_from_order_id": string,"p_order_id": string,"p_ordered_on"?: string }; Returns: string
                           },
"current_user_role":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"customer_price_memory":
{ Args: { "p_rfq_id": string }; Returns: {
              "quoted_number": number,"quoted_on": string,"quoted_price": number,"quoted_revision": number,"quoted_tier": number,"rfq_item_id": string,"sold_on": string,"sold_order_number": number,"sold_price": number,"sold_tier": number
            }[]
                           },
"fetch_fx_rates":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"float_rfq":
{ Args: { "p_company_id": string,"p_contact_id"?: string,"p_customer_ref"?: string,"p_due_on"?: string,"p_is_priority"?: boolean,"p_items": Json,"p_mark_sent"?: boolean,"p_rfq_id": string,"p_site_id"?: string,"p_supplier_ids"?: (string)[] }; Returns: string
                           },
"fx_wanted_currencies":
{ Args: Record<PropertyKey, never>; Returns: (string)[]
                           },
"ingest_fx_response":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"issue_purchase_order":
{ Args: { "p_delivery_terms"?: string,"p_incoterm"?: string,"p_lines"?: Json,"p_notes"?: string,"p_payment_terms"?: string,"p_po_id": string,"p_ship_to"?: string,"p_supplier_order_id": string }; Returns: string
                           },
"issue_quotation":
{ Args: { "p_contact_id"?: string,"p_delivery_text"?: string,"p_item_ids"?: (string)[],"p_notes"?: string,"p_payment_terms"?: string,"p_quotation_id": string,"p_rfq_id": string,"p_valid_until"?: string }; Returns: string
                           },
"item_match_tier":
{ Args: { "c_brand": string,"c_family": string,"c_guessed"?: boolean,"c_norm": string,"c_tokens": (string)[],"t_brand": string,"t_family": string,"t_norm": string,"t_tokens": (string)[] }; Returns: number
                           },
"item_text_norm":
{ Args: { "t": string }; Returns: string
                           },
"merge_brands":
{ Args: { "p_drop": string,"p_keep": string }; Returns: undefined
                           },
"merge_companies":
{ Args: { "p_drop": string,"p_keep": string }; Returns: undefined
                           },
"model_tokens":
{ Args: { "t": string }; Returns: (string)[]
                           },
"month_end_status":
{ Args: { "p_month": string }; Returns: {
              "check_key": string,"n": number
            }[]
                           },
"month_is_closed":
{ Args: { "d": string }; Returns: boolean
                           },
"my_target_progress":
{ Args: Record<PropertyKey, never>; Returns: {
              "achieved_net": number,"behind_pace": number,"excluded_count": number,"gap": number,"on_pace_net": number,"quarter": number,"quarter_end": string,"target_net": number,"year": number
            }[]
                           },
"my_target_progress_at":
{ Args: { "p_at": string }; Returns: {
              "achieved_net": number,"behind_pace": number,"excluded_count": number,"gap": number,"on_pace_net": number,"quarter": number,"quarter_end": string,"target_net": number,"year": number
            }[]
                           },
"order_receivables":
{ Args: { "p_order_id"?: string }; Returns: {
              "balance": number,"company_id": string,"data_trust": string,"due_on": string,"gross_target": number,"is_overdue": boolean,"last_reminded_on": string,"order_id": string,"order_number": number,"overpaid_by": number,"owner_id": string,"payment_state": string,"reminder_count": number,"settled": number
            }[]
                           },
"payables_as_of":
{ Args: { "p_date": string }; Returns: {
              "committed": number,"committed_pkr": number,"currency": string,"flag": string,"fx_rate": number,"order_id": string,"order_number": number,"owed_pkr": number,"paid_pkr": number,"state": string,"supplier_id": string,"supplier_name": string,"supplier_order_id": string
            }[]
                           },
"po_line_prefill":
{ Args: { "p_supplier_order_id": string }; Returns: {
              "description": string,"order_item_id": string,"position": number,"price_source": string,"qty": number,"source_number": number,"source_on": string,"source_revision": number,"unit": string,"unit_price": number
            }[]
                           },
"reopen_month":
{ Args: { "p_month": string,"p_note"?: string }; Returns: undefined
                           },
"resolve_value_basis":
{ Args: { "p_basis": string,"p_order_id": string }; Returns: undefined
                           },
"revoke_user_sessions":
{ Args: { "p_user_id": string }; Returns: undefined
                           },
"schedule_fx_cron":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"search_all":
{ Args: { "lim"?: number,"q": string }; Returns: {
              "company_id": string,"id": string,"kind": string,"label": string,"meta": string,"role": string,"score": number
            }[]
                           },
"set_fx_rate":
{ Args: { "p_as_of"?: string,"p_currency": string,"p_rate_pkr": number }; Returns: string
                           },
"set_rfq_floated":
{ Args: { "p_floated": boolean,"p_rfq_id": string }; Returns: number
                           },
"similar_enough":
{ Args: { "p_a": string,"p_b": string,"p_threshold": number }; Returns: boolean
                           },
"stamp_clarification_ask":
{ Args: { "p_clarification_ids": (string)[] }; Returns: number
                           },
"stamp_fbr_psid":
{ Args: { "p_invoice_ids": (string)[],"p_psid": string }; Returns: number
                           },
"stamp_goods_chase":
{ Args: { "p_leg_id": string }; Returns: number
                           },
"stamp_payment_reminder":
{ Args: { "p_invoice_ids": (string)[] }; Returns: number
                           },
"stamp_supplier_chase":
{ Args: { "p_inquiry_id": string }; Returns: number
                           },
"stamp_tax_deposited":
{ Args: { "p_invoice_ids": (string)[],"p_on"?: string }; Returns: number
                           },
"stamp_tcs_sent":
{ Args: { "p_invoice_ids": (string)[],"p_on"?: string,"p_tcs_number"?: string }; Returns: number
                           },
"strip_words":
{ Args: { "p_drop": (string)[],"p_norm": string }; Returns: string
                           },
"supplier_item_memory":
{ Args: { "p_brand_id": string,"p_description": string,"p_exclude_rfq_id"?: string,"p_family_id": string,"p_supplier_ids": (string)[] }; Returns: {
              "best_tier": number,"best_tier_label": string,"last_ordered_currency": string,"last_ordered_fx_rate_on": string,"last_ordered_fx_rate_pkr": number,"last_ordered_on": string,"last_ordered_price": number,"last_ordered_price_pkr": number,"last_ordered_qty": number,"last_ordered_source": string,"last_ordered_tier": number,"last_ordered_unit": string,"last_po_currency": string,"last_po_fx_rate_on": string,"last_po_fx_rate_pkr": number,"last_po_on": string,"last_po_price": number,"last_po_price_pkr": number,"last_po_qty": number,"last_po_tier": number,"last_po_unit": string,"last_quote_currency": string,"last_quote_fx_rate_on": string,"last_quote_fx_rate_pkr": number,"last_quote_is_legacy": boolean,"last_quote_lead_time": string,"last_quote_on": string,"last_quote_price": number,"last_quote_price_hidden": boolean,"last_quote_price_pkr": number,"last_quote_qty": number,"last_quote_tier": number,"last_quote_unit": string,"recent_lead_times": (string)[],"supplied_before": boolean,"supplier_id": string
            }[]
                           },
"today_pkt":
{ Args: { "ts"?: string }; Returns: string
                           },
"tokens_without":
{ Args: { "p_drop": (string)[],"p_tokens": (string)[] }; Returns: (string)[]
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
