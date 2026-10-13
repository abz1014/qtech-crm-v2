
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
            "audit_log": {
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
                    "answer": string | null,"answered_at": string | null,"ask_count": number,"created_at": string,"created_by": string | null,"first_asked_at": string | null,"id": string,"last_asked_at": string | null,"question": string,"raised_by_inquiry_id": string | null,"rfq_id": string,"withdrawn_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "answer"?: string | null,"answered_at"?: string | null,"ask_count"?: number,"created_at"?: string,"created_by"?: string | null,"first_asked_at"?: string | null,"id"?: string,"last_asked_at"?: string | null,"question": string,"raised_by_inquiry_id"?: string | null,"rfq_id": string,"withdrawn_at"?: string | null
                  }
                  Update: {
                    "answer"?: string | null,"answered_at"?: string | null,"ask_count"?: number,"created_at"?: string,"created_by"?: string | null,"first_asked_at"?: string | null,"id"?: string,"last_asked_at"?: string | null,"question"?: string,"raised_by_inquiry_id"?: string | null,"rfq_id"?: string,"withdrawn_at"?: string | null
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
      foreignKeyName: "clarifications_rfq_id_fkey"
      columns: ["rfq_id"]
isOneToOne: false
      referencedRelation: "rfqs"
      referencedColumns: ["id"]
    }
                  ]
                },"companies": {
                  Row: {
                    "country": string | null,"created_at": string,"created_by": string | null,"id": string,"legacy_flags": (string)[],"legacy_source": Json | null,"name": string,"notes": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "country"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"name": string,"notes"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "country"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"name"?: string,"notes"?: string | null,"updated_at"?: string
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
      foreignKeyName: "company_brands_created_by_fkey"
      columns: ["created_by"]
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
      foreignKeyName: "company_sites_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"contacts": {
                  Row: {
                    "company_id": string,"created_at": string,"created_by": string | null,"email": string | null,"id": string,"name": string,"notes": string | null,"phone": string | null,"site_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "company_id": string,"created_at"?: string,"created_by"?: string | null,"email"?: string | null,"id"?: string,"name": string,"notes"?: string | null,"phone"?: string | null,"site_id"?: string | null
                  }
                  Update: {
                    "company_id"?: string,"created_at"?: string,"created_by"?: string | null,"email"?: string | null,"id"?: string,"name"?: string,"notes"?: string | null,"phone"?: string | null,"site_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "contacts_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
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
                },"expenses": {
                  Row: {
                    "amount_pkr": number,"category": string,"created_at": string,"created_by": string | null,"description": string | null,"id": string,"legacy_flags": (string)[],"legacy_source": Json | null,"order_id": string | null,"paid_on": string,"payee_id": string | null,"period": string | null,"recurring_id": string | null,"reference": string | null,"supplier_order_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_pkr": number,"category": string,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"order_id"?: string | null,"paid_on"?: string,"payee_id"?: string | null,"period"?: string | null,"recurring_id"?: string | null,"reference"?: string | null,"supplier_order_id"?: string | null
                  }
                  Update: {
                    "amount_pkr"?: number,"category"?: string,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"order_id"?: string | null,"paid_on"?: string,"payee_id"?: string | null,"period"?: string | null,"recurring_id"?: string | null,"reference"?: string | null,"supplier_order_id"?: string | null
                  }
                  Relationships: [
                    {
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
      foreignKeyName: "expenses_payee_id_fkey"
      columns: ["payee_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
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
                },"invoices": {
                  Row: {
                    "client_received_on": string | null,"company_id": string | null,"copy_received_on": string | null,"created_at": string,"created_by": string | null,"gst_amount": number,"id": string,"invoice_date": string | null,"last_reminded_on": string | null,"legacy_flags": (string)[],"legacy_source": Json | null,"net_amount": number,"notes": string | null,"number": string | null,"order_id": string | null,"psid": string | null,"reminder_count": number,"tax_deposit_amount": number | null,"tax_deposited_on": string | null,"tcs_number": string | null,"tcs_sent_on": string | null,"updated_at": string,"wasif_receipt_on": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "client_received_on"?: string | null,"company_id"?: string | null,"copy_received_on"?: string | null,"created_at"?: string,"created_by"?: string | null,"gst_amount": number,"id"?: string,"invoice_date"?: string | null,"last_reminded_on"?: string | null,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"net_amount": number,"notes"?: string | null,"number"?: string | null,"order_id"?: string | null,"psid"?: string | null,"reminder_count"?: number,"tax_deposit_amount"?: number | null,"tax_deposited_on"?: string | null,"tcs_number"?: string | null,"tcs_sent_on"?: string | null,"updated_at"?: string,"wasif_receipt_on"?: string | null
                  }
                  Update: {
                    "client_received_on"?: string | null,"company_id"?: string | null,"copy_received_on"?: string | null,"created_at"?: string,"created_by"?: string | null,"gst_amount"?: number,"id"?: string,"invoice_date"?: string | null,"last_reminded_on"?: string | null,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"net_amount"?: number,"notes"?: string | null,"number"?: string | null,"order_id"?: string | null,"psid"?: string | null,"reminder_count"?: number,"tax_deposit_amount"?: number | null,"tax_deposited_on"?: string | null,"tcs_number"?: string | null,"tcs_sent_on"?: string | null,"updated_at"?: string,"wasif_receipt_on"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoices_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
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
                    "cancelled_on": string | null,"commissioning_done_on": string | null,"commissioning_planned_on": string | null,"company_id": string,"contact_id": string | null,"created_at": string,"created_by": string | null,"customer_po_number": string | null,"id": string,"legacy_flags": (string)[],"legacy_source": Json | null,"needs_commissioning": boolean,"notes": string | null,"number": number,"ordered_on": string | null,"owner_id": string | null,"payment_terms_days": number | null,"rfq_id": string | null,"site_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cancelled_on"?: string | null,"commissioning_done_on"?: string | null,"commissioning_planned_on"?: string | null,"company_id": string,"contact_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"customer_po_number"?: string | null,"id"?: string,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"needs_commissioning"?: boolean,"notes"?: string | null,"number"?: never,"ordered_on"?: string | null,"owner_id"?: string | null,"payment_terms_days"?: number | null,"rfq_id"?: string | null,"site_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "cancelled_on"?: string | null,"commissioning_done_on"?: string | null,"commissioning_planned_on"?: string | null,"company_id"?: string,"contact_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"customer_po_number"?: string | null,"id"?: string,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"needs_commissioning"?: boolean,"notes"?: string | null,"number"?: never,"ordered_on"?: string | null,"owner_id"?: string | null,"payment_terms_days"?: number | null,"rfq_id"?: string | null,"site_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "orders_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
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
      foreignKeyName: "orders_site_id_fkey"
      columns: ["site_id"]
isOneToOne: false
      referencedRelation: "company_sites"
      referencedColumns: ["id"]
    }
                  ]
                },"payments_in": {
                  Row: {
                    "amount": number,"created_at": string,"created_by": string | null,"credited_user_id": string | null,"id": string,"legacy_flags": (string)[],"legacy_source": Json | null,"order_id": string,"received_on": string,"reference": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"created_at"?: string,"created_by"?: string | null,"credited_user_id"?: string | null,"id"?: string,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"order_id": string,"received_on"?: string,"reference"?: string | null
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string,"created_by"?: string | null,"credited_user_id"?: string | null,"id"?: string,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"order_id"?: string,"received_on"?: string,"reference"?: string | null
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
    }
                  ]
                },"recurring_expenses": {
                  Row: {
                    "active": boolean,"amount": number,"category": string,"created_at": string,"created_by": string | null,"day_of_month": number | null,"id": string,"label": string,"notes": string | null,"start_month": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"amount": number,"category": string,"created_at"?: string,"created_by"?: string | null,"day_of_month"?: number | null,"id"?: string,"label": string,"notes"?: string | null,"start_month"?: string | null
                  }
                  Update: {
                    "active"?: boolean,"amount"?: number,"category"?: string,"created_at"?: string,"created_by"?: string | null,"day_of_month"?: number | null,"id"?: string,"label"?: string,"notes"?: string | null,"start_month"?: string | null
                  }
                  Relationships: [
                    {
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
    }
                  ]
                },"rfqs": {
                  Row: {
                    "close_note": string | null,"close_reason": string | null,"closed_on": string | null,"company_id": string,"contact_id": string | null,"created_at": string,"created_by": string | null,"customer_ref": string | null,"due_on": string | null,"id": string,"is_priority": boolean,"legacy_flags": (string)[],"legacy_source": Json | null,"notes": string | null,"number": number,"owner_id": string | null,"quoted_on": string | null,"received_on": string,"site_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "close_note"?: string | null,"close_reason"?: string | null,"closed_on"?: string | null,"company_id": string,"contact_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"customer_ref"?: string | null,"due_on"?: string | null,"id"?: string,"is_priority"?: boolean,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"notes"?: string | null,"number"?: never,"owner_id"?: string | null,"quoted_on"?: string | null,"received_on"?: string,"site_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "close_note"?: string | null,"close_reason"?: string | null,"closed_on"?: string | null,"company_id"?: string,"contact_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"customer_ref"?: string | null,"due_on"?: string | null,"id"?: string,"is_priority"?: boolean,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"notes"?: string | null,"number"?: never,"owner_id"?: string | null,"quoted_on"?: string | null,"received_on"?: string,"site_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "rfqs_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
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
                },"supplier_inquiries": {
                  Row: {
                    "chase_count": number,"created_at": string,"created_by": string | null,"id": string,"last_chased_on": string | null,"last_relayed_at": string | null,"legacy_flags": (string)[],"legacy_source": Json | null,"no_offer_on": string | null,"notes": string | null,"rfq_id": string,"sent_on": string | null,"supplier_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "chase_count"?: number,"created_at"?: string,"created_by"?: string | null,"id"?: string,"last_chased_on"?: string | null,"last_relayed_at"?: string | null,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"no_offer_on"?: string | null,"notes"?: string | null,"rfq_id": string,"sent_on"?: string | null,"supplier_id": string
                  }
                  Update: {
                    "chase_count"?: number,"created_at"?: string,"created_by"?: string | null,"id"?: string,"last_chased_on"?: string | null,"last_relayed_at"?: string | null,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"no_offer_on"?: string | null,"notes"?: string | null,"rfq_id"?: string,"sent_on"?: string | null,"supplier_id"?: string
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
      foreignKeyName: "supplier_inquiries_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"supplier_orders": {
                  Row: {
                    "created_at": string,"created_by": string | null,"currency": string | null,"delivered_on": string | null,"expected_on": string | null,"id": string,"inquiry_id": string | null,"legacy_flags": (string)[],"legacy_source": Json | null,"order_id": string,"placed_on": string | null,"received_on": string | null,"reference": string | null,"supplier_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"currency"?: string | null,"delivered_on"?: string | null,"expected_on"?: string | null,"id"?: string,"inquiry_id"?: string | null,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"order_id": string,"placed_on"?: string | null,"received_on"?: string | null,"reference"?: string | null,"supplier_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"currency"?: string | null,"delivered_on"?: string | null,"expected_on"?: string | null,"id"?: string,"inquiry_id"?: string | null,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"order_id"?: string,"placed_on"?: string | null,"received_on"?: string | null,"reference"?: string | null,"supplier_id"?: string
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
      foreignKeyName: "supplier_orders_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supplier_orders_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"supplier_quote_lines": {
                  Row: {
                    "created_at": string,"created_by": string | null,"currency": string,"id": string,"in_stock": boolean | null,"inquiry_id": string,"lead_time": string | null,"legacy_flags": (string)[],"legacy_source": Json | null,"notes": string | null,"origin": string | null,"rfq_item_id": string,"unit_price": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"currency": string,"id"?: string,"in_stock"?: boolean | null,"inquiry_id": string,"lead_time"?: string | null,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"notes"?: string | null,"origin"?: string | null,"rfq_item_id": string,"unit_price": number
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"currency"?: string,"id"?: string,"in_stock"?: boolean | null,"inquiry_id"?: string,"lead_time"?: string | null,"legacy_flags"?: (string)[],"legacy_source"?: Json | null,"notes"?: string | null,"origin"?: string | null,"rfq_item_id"?: string,"unit_price"?: number
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
                    "created_at": string,"deactivated_at": string | null,"id": string,"job_title": string | null,"name": string,"role": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"deactivated_at"?: string | null,"id": string,"job_title"?: string | null,"name": string,"role": string
                  }
                  Update: {
                    "created_at"?: string,"deactivated_at"?: string | null,"id"?: string,"job_title"?: string | null,"name"?: string,"role"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "current_user_role":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"model_tokens":
{ Args: { "t": string }; Returns: (string)[]
                           },
"today_pkt":
{ Args: { "ts"?: string }; Returns: string
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
