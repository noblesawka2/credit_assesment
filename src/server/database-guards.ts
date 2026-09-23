import type { Pool } from "pg";
import { requireControl } from "../domain/validation.ts";

export async function assertRuntimeDatabase(pool: Pool) {
  const result = await pool.query(`SELECT
    EXISTS (SELECT 1 FROM pg_roles WHERE pg_has_role(current_user, oid, 'MEMBER')
      AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)) AS privileged_role,
    has_database_privilege(current_user, current_database(), 'CREATE') OR
    EXISTS (SELECT 1 FROM pg_namespace WHERE nspname IN ('public', 'nobles_security')
      AND (pg_has_role(current_user, nspowner, 'MEMBER') OR has_schema_privilege(current_user, oid, 'CREATE'))) AS schema_control,
    EXISTS (SELECT 1 FROM pg_class JOIN pg_namespace ON pg_namespace.oid=relnamespace
      WHERE relkind IN ('r','p') AND ((nspname='public' AND left(relname,7)='credit_') OR nspname='nobles_security')
      AND (pg_has_role(current_user, relowner, 'MEMBER') OR has_table_privilege(current_user, pg_class.oid, 'TRUNCATE')
        OR (nspname='public' AND has_table_privilege(current_user, pg_class.oid, 'DELETE'))
        OR (relname IN ('credit_audit_logs','events') AND (has_table_privilege(current_user, pg_class.oid, 'UPDATE') OR has_table_privilege(current_user, pg_class.oid, 'DELETE'))))) AS unsafe_table_privileges,
    EXISTS (SELECT 1 FROM pg_class JOIN pg_namespace ON pg_namespace.oid=relnamespace
      WHERE nspname='public' AND left(relname,7)='credit_' AND relkind IN ('r','p')
      AND (NOT relrowsecurity OR NOT relforcerowsecurity)) AS missing_rls`);
  const row = result.rows[0];
  requireControl(row?.privileged_role === false, "RLS_BYPASS_OR_PRIVILEGED_ROLE_FORBIDDEN");
  requireControl(row.schema_control === false && row.unsafe_table_privileges === false, "RUNTIME_DDL_OR_DESTRUCTIVE_PRIVILEGES_FORBIDDEN");
  requireControl(row.missing_rls === false, "CREDIT_FORCE_RLS_REQUIRED");
  const schema = await pool.query(`SELECT
    EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.credit_applications')
      AND attname='external_member_id' AND NOT attnotnull AND NOT attisdropped)
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.credit_applications')
      AND conname='credit_unlinked_draft_only' AND convalidated) AS ready`);
  requireControl(schema.rows[0]?.ready, "STANDALONE_INTAKE_SCHEMA_REQUIRED");
}
