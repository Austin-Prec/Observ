/**
 * Hand-written to match supabase/migrations/*.sql exactly.
 *
 * IMPORTANT: once you have a live Supabase project, regenerate this file
 * with `supabase gen types typescript --project-id <id> > lib/supabase/database.types.ts`
 * and diff it against this version. Hand-written types can drift from the
 * real schema; the CLI-generated version is the source of truth going
 * forward. I could not run that command here because this sandbox has no
 * network path to a live Supabase project -- see the honesty note in the
 * chat response.
 */

export type MembershipStatus = "active" | "suspended" | "invited";
export type OrgRole = "administrator" | "manager" | "analyst" | "data_collector" | "viewer";
export type AuditAction = "login" | "logout" | "view" | "create" | "update" | "delete" | "export" | "import";
export type IndicatorType = "quantitative" | "qualitative";
export type ResultLevel = "goal" | "purpose" | "output" | "activity";
export type FormStatus = "draft" | "published" | "archived";
export type ResponseStatus = "submitted" | "verified" | "flagged" | "rejected";
export type FieldType =
  | "text" | "number" | "date" | "dropdown" | "radio" | "checkbox"
  | "likert_scale" | "photo_upload" | "file_upload" | "signature"
  | "gps_coordinates" | "barcode_qr";

// Every table below must satisfy postgrest-js's GenericTable constraint:
// { Row, Insert, Update, Relationships: GenericRelationship[] }. Omitting
// Relationships (my original mistake here) doesn't produce an error at
// the type definition site -- it silently makes the table fail its
// generic constraint, which collapses inferred Row types to `never` at
// every call site instead. That's a bad failure mode (error reported far
// from its cause), so it's called out explicitly rather than left
// implicit: every table below carries `Relationships: []` even where
// this schema has no embedded-resource joins configured, specifically to
// satisfy that constraint.
type NoRelationships = { foreignKeyName: string; columns: string[]; referencedRelation: string; referencedColumns: string[] }[];

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          status: "active" | "archived";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          status?: "active" | "archived";
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["organizations"]["Insert"]>;
        Relationships: NoRelationships;
      };
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          email: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          email: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: NoRelationships;
      };
      memberships: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          role: OrgRole;
          status: MembershipStatus;
          invited_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          user_id: string;
          role: OrgRole;
          status?: MembershipStatus;
          invited_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["memberships"]["Insert"]>;
        // memberships.user_id and .invited_by both reference profiles(id)
        // (migration 00001) -- neither was declared here originally,
        // same drift class caught by the audit_logs fix above. Adding
        // both now on the same sweep rather than waiting for a future
        // query to hit each one individually.
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "memberships_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "memberships_invited_by_fkey";
            columns: ["invited_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      audit_logs: {
        Row: {
          id: string;
          organization_id: string | null;
          actor_id: string | null;
          action: AuditAction;
          target_table: string | null;
          target_id: string | null;
          metadata: Record<string, unknown>;
          ip_address: string | null;
          user_agent: string | null;
          created_at: string;
        };
        // Insert intentionally typed as `never`-producing (an object type
        // no caller can satisfy without a `never` field) rather than
        // omitted: writes to this table must go through the
        // write_audit_log() RPC, not a direct table insert -- see
        // migration 00002, where `authenticated` has no INSERT grant on
        // audit_logs at the database level. Typing Insert as `never`
        // directly would fail the GenericTable constraint the same way
        // omitting Relationships did, so instead it's an impossible
        // object shape, which surfaces a clear type error at any call
        // site that attempts `.insert()` on this table.
        Insert: { __direct_insert_not_allowed: never };
        Update: Partial<Database["public"]["Tables"]["audit_logs"]["Row"]>;
        // Was NoRelationships (empty) until this dashboard build tried a
        // nested `profiles(full_name, email)` select and TypeScript
        // correctly rejected it: "could not find the relation between
        // audit_logs and profiles." The real migration (00002) always
        // had `actor_id references profiles(id)` -- this hand-written
        // type just hadn't caught up to it, the same class of drift the
        // README's regenerate-from-CLI note exists to guard against.
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey";
            columns: ["actor_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "audit_logs_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          }
        ];
      };
      projects: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          description: string | null;
          start_date: string | null;
          end_date: string | null;
          status: "planning" | "active" | "closed" | "archived";
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          description?: string | null;
          start_date?: string | null;
          end_date?: string | null;
          status?: "planning" | "active" | "closed" | "archived";
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["projects"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "projects_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "projects_created_by_fkey";
            columns: ["created_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      logframe_results: {
        Row: {
          id: string;
          organization_id: string;
          project_id: string;
          parent_id: string | null;
          level: ResultLevel;
          statement: string;
          assumptions: string | null;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          project_id: string;
          parent_id?: string | null;
          level: ResultLevel;
          statement: string;
          assumptions?: string | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["logframe_results"]["Insert"]>;
        // organization_id also references organizations(id) (migration
        // 00003) -- same drift class as the audit_logs/memberships/etc
        // fixes above, closing it here on the same sweep.
        Relationships: [
          {
            foreignKeyName: "logframe_results_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "logframe_results_project_id_fkey";
            columns: ["project_id"];
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "logframe_results_parent_id_fkey";
            columns: ["parent_id"];
            referencedRelation: "logframe_results";
            referencedColumns: ["id"];
          }
        ];
      };
      indicators: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          description: string | null;
          indicator_type: IndicatorType;
          unit_of_measure: string | null;
          baseline_value: number | null;
          baseline_date: string | null;
          target_value: number | null;
          target_date: string | null;
          data_source: string | null;
          frequency: "daily" | "weekly" | "monthly" | "quarterly" | "biannual" | "annual" | "custom";
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          description?: string | null;
          indicator_type: IndicatorType;
          unit_of_measure?: string | null;
          baseline_value?: number | null;
          baseline_date?: string | null;
          target_value?: number | null;
          target_date?: string | null;
          data_source?: string | null;
          frequency?: "daily" | "weekly" | "monthly" | "quarterly" | "biannual" | "annual" | "custom";
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["indicators"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "indicators_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "indicators_created_by_fkey";
            columns: ["created_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      disaggregation_categories: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          description: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          description?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["disaggregation_categories"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "disaggregation_categories_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          }
        ];
      };
      disaggregation_values: {
        Row: {
          id: string;
          category_id: string;
          value: string;
          sort_order: number;
        };
        Insert: {
          id?: string;
          category_id: string;
          value: string;
          sort_order?: number;
        };
        Update: Partial<Database["public"]["Tables"]["disaggregation_values"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "disaggregation_values_category_id_fkey";
            columns: ["category_id"];
            referencedRelation: "disaggregation_categories";
            referencedColumns: ["id"];
          }
        ];
      };
      indicator_disaggregations: {
        Row: { indicator_id: string; category_id: string };
        Insert: { indicator_id: string; category_id: string };
        Update: Partial<Database["public"]["Tables"]["indicator_disaggregations"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "indicator_disaggregations_indicator_id_fkey";
            columns: ["indicator_id"];
            referencedRelation: "indicators";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "indicator_disaggregations_category_id_fkey";
            columns: ["category_id"];
            referencedRelation: "disaggregation_categories";
            referencedColumns: ["id"];
          }
        ];
      };
      indicator_results: {
        Row: { indicator_id: string; result_id: string; created_at: string };
        Insert: { indicator_id: string; result_id: string; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["indicator_results"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "indicator_results_indicator_id_fkey";
            columns: ["indicator_id"];
            referencedRelation: "indicators";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "indicator_results_result_id_fkey";
            columns: ["result_id"];
            referencedRelation: "logframe_results";
            referencedColumns: ["id"];
          }
        ];
      };
      forms: {
        Row: {
          id: string;
          organization_id: string;
          project_id: string | null;
          name: string;
          description: string | null;
          status: "draft" | "published" | "archived";
          current_version: number;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          project_id?: string | null;
          name: string;
          description?: string | null;
          status?: "draft" | "published" | "archived";
          current_version?: number;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["forms"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "forms_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "forms_project_id_fkey";
            columns: ["project_id"];
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "forms_created_by_fkey";
            columns: ["created_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      form_versions: {
        Row: {
          id: string;
          form_id: string;
          version: number;
          published_by: string | null;
          published_at: string;
        };
        Insert: {
          id?: string;
          form_id: string;
          version: number;
          published_by?: string | null;
          published_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["form_versions"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "form_versions_form_id_fkey";
            columns: ["form_id"];
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "form_versions_published_by_fkey";
            columns: ["published_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      form_fields: {
        Row: {
          id: string;
          form_id: string;
          form_version_id: string | null;
          field_type: FieldType;
          label: string;
          help_text: string | null;
          sort_order: number;
          is_required: boolean;
          options: { value: string; label: string }[];
          validation: Record<string, unknown>;
          depends_on_field_id: string | null;
          depends_on_value: string | null;
          indicator_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          form_id: string;
          form_version_id?: string | null;
          field_type: FieldType;
          label: string;
          help_text?: string | null;
          sort_order?: number;
          is_required?: boolean;
          options?: { value: string; label: string }[];
          validation?: Record<string, unknown>;
          depends_on_field_id?: string | null;
          depends_on_value?: string | null;
          indicator_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        // Update is intentionally the same shape as Insert (not Partial<Row>)
        // -- the DB layer enforces the real immutability constraint
        // (trg_form_fields_immutable_once_published, migration 00004), not
        // this type. This type only needs to describe what shape a client
        // CAN send; whether a given update is accepted is a runtime concern.
        Update: Partial<Database["public"]["Tables"]["form_fields"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "form_fields_form_id_fkey";
            columns: ["form_id"];
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "form_fields_form_version_id_fkey";
            columns: ["form_version_id"];
            referencedRelation: "form_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "form_fields_indicator_id_fkey";
            columns: ["indicator_id"];
            referencedRelation: "indicators";
            referencedColumns: ["id"];
          },
          {
            // Self-reference for skip logic (depends_on_field_id) --
            // "show this field only if an earlier field had a given
            // value." Confirmed against migration 00004 source directly
            // (grep, not eyeballed) during the systematic sweep that
            // also caught the other gaps in this file.
            foreignKeyName: "form_fields_depends_on_field_id_fkey";
            columns: ["depends_on_field_id"];
            referencedRelation: "form_fields";
            referencedColumns: ["id"];
          }
        ];
      };
      form_responses: {
        Row: {
          id: string;
          organization_id: string;
          form_version_id: string;
          project_id: string | null;
          collected_by: string | null;
          status: ResponseStatus;
          submitted_at: string;
          synced_at: string;
          client_submission_id: string | null;
          latitude: number | null;
          longitude: number | null;
          verified_by: string | null;
          verified_at: string | null;
          verification_note: string | null;
          created_at: string;
          updated_at: string;
        };
        // No general Insert type: all writes go through the
        // submit_form_response() RPC (migration 00005), which validates
        // required fields and writes response + answers atomically.
        // authenticated has INSERT grant on this table directly (needed
        // for the RPC's own SECURITY DEFINER insert to work under some
        // Supabase configurations), but the app layer should never call
        // .insert() on this table directly -- see lib/actions/responses.ts.
        Insert: { __use_submit_form_response_rpc_instead: never };
        // No general Update type either: status transitions go through
        // verify_response()/flag_response(), both narrow RPCs with their
        // own permission checks and audit logging. A bare .update() call
        // would bypass both.
        Update: { __use_verify_or_flag_response_rpc_instead: never };
        Relationships: [
          {
            foreignKeyName: "form_responses_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "form_responses_form_version_id_fkey";
            columns: ["form_version_id"];
            referencedRelation: "form_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "form_responses_project_id_fkey";
            columns: ["project_id"];
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "form_responses_collected_by_fkey";
            columns: ["collected_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "form_responses_verified_by_fkey";
            columns: ["verified_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      response_answers: {
        Row: {
          id: string;
          response_id: string;
          field_id: string;
          answer_value: string | null;
          answer_numeric: number | null;
          created_at: string;
        };
        // Also RPC-only, via submit_form_response() -- see form_responses
        // above for the same rationale.
        Insert: { __use_submit_form_response_rpc_instead: never };
        Update: { __response_answers_are_append_only: never };
        Relationships: [
          {
            foreignKeyName: "response_answers_response_id_fkey";
            columns: ["response_id"];
            referencedRelation: "form_responses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "response_answers_field_id_fkey";
            columns: ["field_id"];
            referencedRelation: "form_fields";
            referencedColumns: ["id"];
          }
        ];
      };
      form_version_fields: {
        Row: {
          form_version_id: string;
          field_id: string;
          sort_order: number;
        };
        // System-maintained via publish_form() only (migration 00006) --
        // no client insert/update/delete grant on this table.
        Insert: { __maintained_by_publish_form_rpc: never };
        Update: { __maintained_by_publish_form_rpc: never };
        Relationships: [
          {
            foreignKeyName: "form_version_fields_form_version_id_fkey";
            columns: ["form_version_id"];
            referencedRelation: "form_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "form_version_fields_field_id_fkey";
            columns: ["field_id"];
            referencedRelation: "form_fields";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    // Required to satisfy postgrest-js's GenericSchema constraint
    // ({ Tables, Views, Functions }). This schema currently has no
    // database views, but the key must still be present -- its absence
    // (not a missing Relationships field, which was my first, incorrect
    // guess while debugging this) is what caused every table's inferred
    // Row type to collapse to `never` at every .from() call site. See
    // the chat explanation for the full trace through SupabaseClient's
    // generic resolution.
    Views: Record<string, never>;
    Functions: {
      auth_role_in_org: { Args: { target_org: string }; Returns: OrgRole | null };
      auth_is_member_of_org: { Args: { target_org: string }; Returns: boolean };
      auth_can_manage_org: { Args: { target_org: string }; Returns: boolean };
      auth_is_org_admin: { Args: { target_org: string }; Returns: boolean };
      write_audit_log: {
        Args: {
          p_organization_id: string;
          p_action: AuditAction;
          p_target_table?: string | null;
          p_target_id?: string | null;
          p_metadata?: Record<string, unknown>;
          p_ip_address?: string | null;
          p_user_agent?: string | null;
        };
        Returns: string;
      };
      publish_form: { Args: { p_form_id: string }; Returns: string };
      submit_form_response: {
        Args: {
          p_form_version_id: string;
          p_answers: { field_id: string; value: string | null }[];
          p_client_submission_id?: string | null;
          p_latitude?: number | null;
          p_longitude?: number | null;
          p_submitted_at?: string | null;
        };
        Returns: string;
      };
      // p_note has a real default (null) in Postgres -- verifying without
      // a note is a legitimate call.
      verify_response: {
        Args: { p_response_id: string; p_note?: string | null };
        Returns: void;
      };
      // p_note has NO default in Postgres, and the function body itself
      // rejects a null/empty note ("A note explaining the flag is
      // required") -- typed as required (not optional) here specifically
      // so a caller forgetting the note is caught by tsc, not by a
      // runtime RPC error the client then has to handle after the fact.
      flag_response: {
        Args: { p_response_id: string; p_note: string };
        Returns: void;
      };
      // Returns setof field_summary_row (migration 00009). For numeric
      // fields: one row, answer_value null, mean/min/max/sum populated.
      // For categorical fields: one row per distinct answer, response_count
      // populated, mean/min/max/sum null.
      field_summary_stats: {
        Args: { p_field_id: string };
        Returns: {
          answer_value: string | null;
          response_count: number;
          mean_value: number | null;
          min_value: number | null;
          max_value: number | null;
          sum_value: number | null;
        }[];
      };
      // Raises if p_field_id is not a numeric field type -- see migration
      // 00009, confirmed against live Postgres.
      field_summary_disaggregated: {
        Args: { p_field_id: string; p_group_by_field_id: string };
        Returns: {
          group_value: string | null;
          response_count: number;
          mean_value: number | null;
          min_value: number | null;
          max_value: number | null;
          sum_value: number | null;
        }[];
      };
      cross_tabulation: {
        Args: { p_row_field_id: string; p_column_field_id: string };
        Returns: {
          row_value: string | null;
          column_value: string | null;
          cell_count: number;
        }[];
      };
    };
  };
}
