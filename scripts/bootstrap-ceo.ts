import pg from "pg";
import { applicationEnvironment } from "../src/server/environment.ts";
import { deploymentDatabaseConfig, databaseErrorCode } from "../src/server/database.ts";
import { assertRuntimeDatabase } from "../src/server/database-guards.ts";
import { PayloadCipher } from "../src/server/encryption.ts";
import { SupabaseStaffAuth } from "../src/server/supabase-auth.ts";
import { StaffAdministration } from "../src/server/administration.ts";
import { requireControl } from "../src/domain/validation.ts";

const args = process.argv.slice(2);
let pool: pg.Pool | undefined;
try {
  if (!args.length || args.length === 1 && args[0] === "--plan") {
    process.stdout.write(JSON.stringify({ mode: "PLAN_ONLY_NO_CONNECTION", email: "chinelo.nnazor@gmail.com", staffId: "UCHE0001",
      roles: ["SUPERUSER","CREDIT_APPROVER"], dailyApprovalLimitNaira: "1000000", loanApprovalsEnabled: false,
      invitationOrigin: "https://checker.portal.mynoblescooperative.com", requires: ["deployed HTTPS administration portal","Supabase redirect allowlist","custom invite template","verified SMTP","STAFF_INVITATIONS_ENABLED=true"] }) + "\n");
  } else {
    requireControl(args.length === 5 && args[0] === "--apply" && args[1] === "--expected-project" && args[2] === process.env.SUPABASE_PROJECT_REF
      && args[3] === "--expected-origin" && args[4] === "https://checker.portal.mynoblescooperative.com" && process.env.ADMIN_APP_ORIGIN === args[4], "BOOTSTRAP_TARGET_CONFIRMATION_REQUIRED");
    const environment = applicationEnvironment();
    requireControl(environment.production && environment.surface === "administration" && environment.origin === args[4], "BOOTSTRAP_PRODUCTION_ADMIN_PORTAL_REQUIRED");
    pool = new pg.Pool(await deploymentDatabaseConfig());
    pool.on("error", () => {});
    await assertRuntimeDatabase(pool);
    const administration = new StaffAdministration(pool,new SupabaseStaffAuth(process.env),new PayloadCipher(process.env.DATA_ENCRYPTION_KEY ?? ""),process.env);
    await administration.bootstrapCeo();
    process.stdout.write(JSON.stringify({ invitation: "SUBMITTED_TO_PROVIDER", deliveryConfirmed: false, passwordPrinted: false }) + "\n");
  }
} catch(error) { process.stderr.write(JSON.stringify({ bootstrap: "FAILED", code: databaseErrorCode(error), invitationOutcome: "NOT_CONFIRMED_DO_NOT_RETRY_BLINDLY" }) + "\n"); process.exitCode=1; }
finally { await pool?.end().catch(()=>{}); }
