import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { authorize, type Actor } from "../domain/access.ts";
import { FACTORS, type ScoreModel } from "../domain/score.ts";
import { readinessAssessment, READINESS_MONEY_FIELDS, type ReadinessPolicy } from "../domain/readiness.ts";
import { money, requireControl, integer } from "../domain/validation.ts";
import { validateProduct } from "../domain/diagnostic.ts";
import type { ProductMathConfig } from "../domain/money.ts";
import type { PayloadCipher } from "./encryption.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const productMoney = ["minimumPrincipalKobo","maximumPrincipalKobo","principalIncrementKobo","spreadFixedChargesKobo","fixedPeriodicObligationKobo","deductedFromProceedsFixedKobo"] as const;
export class ReadinessRepository {
  private readonly pool: Pool;
  private readonly cipher: PayloadCipher;
  constructor(pool: Pool, cipher: PayloadCipher) { this.pool = pool; this.cipher = cipher; }
  private async begin(client: PoolClient, actor: Actor) {
    await client.query("BEGIN");
    await client.query("SELECT set_config('nobles.actor_id',$1,true),set_config('nobles.can_readiness','true',true)",[actor.id]);
  }
  private async policies(client: PoolClient, code: string) {
    return (await client.query("SELECT id,kind,code,version,payload FROM public.credit_policy_versions WHERE code=$1 AND status='PUBLISHED' AND unresolved='[]'::jsonb AND effective_at<=now() AND kind IN ('PRODUCT','SCORE','ELIGIBILITY') ORDER BY effective_at DESC,version DESC", [code])).rows;
  }
  async configuration(actor: Actor, code: string) {
    authorize(actor, "READINESS");
    requireControl(code === "" || /^[A-Z0-9_-]{1,50}$/.test(code), "INVALID_PRODUCT_CODE");
    const client = await this.pool.connect();
    try {
      await this.begin(client, actor);
      const products = (await client.query("SELECT DISTINCT code FROM public.credit_policy_versions WHERE kind='PRODUCT' AND status='PUBLISHED' AND unresolved='[]'::jsonb AND effective_at<=now() ORDER BY code")).rows.map(row => row.code);
      const policies = code ? await this.policies(client, code) : [];
      const missing = ["PRODUCT","SCORE","ELIGIBILITY"].filter(kind => !policies.some(row => row.kind === kind));
      const model = policies.find(row => row.kind === "SCORE")?.payload;
      await client.query("COMMIT");
      return { products, missing, moneyFields: READINESS_MONEY_FIELDS, factors: Object.keys(FACTORS).map(name => ({ name, textChoices: (model?.rules?.[name] ?? []).filter((rule: { equals?: string }) => typeof rule.equals === "string").map((rule: { equals: string }) => rule.equals) })) };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async evaluate(actor: Actor, id: string, body: Record<string, unknown>) {
    authorize(actor, "READINESS");
    requireControl(uuid.test(id) && typeof body.idempotencyKey === "string" && uuid.test(body.idempotencyKey), "INVALID_IDEMPOTENCY_KEY");
    requireControl(typeof body.productCode === "string" && /^[A-Z0-9_-]{1,50}$/.test(body.productCode), "INVALID_PRODUCT_CODE");
    integer(body.expectedRevision,1,2147483646);
    const hash = createHash("sha256").update(JSON.stringify({ id, ...body })).digest("hex");
    const client = await this.pool.connect();
    try {
      await this.begin(client, actor);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,2))", [actor.id + body.idempotencyKey]);
      const application = await client.query("SELECT id,revision,requested_amount_kobo,status FROM public.credit_applications WHERE id=$1 AND $2=ANY(assigned_user_ids) FOR SHARE", [id,actor.id]);
      requireControl(application.rowCount === 1,"CASE_NOT_FOUND");
      const row = application.rows[0];
      const previous = await client.query("SELECT id,request_hash,ciphertext FROM public.credit_readiness_results WHERE created_by=$1 AND idempotency_key=$2", [actor.id,body.idempotencyKey]);
      let response: unknown;
      if (previous.rowCount) {
        requireControl(previous.rows[0].request_hash === hash,"IDEMPOTENCY_PAYLOAD_CONFLICT");
        response = this.cipher.open(previous.rows[0].ciphertext,"readiness:" + previous.rows[0].id);
      } else {
        requireControl(row.revision === body.expectedRevision,"REVISION_CONFLICT");
        requireControl(["DRAFT","DESK_REVIEW","FIELD_VERIFICATION_PENDING","RETURNED_TO_CREDIT_OFFICER"].includes(row.status),"READINESS_STAGE_FORBIDDEN");
        const policies = await this.policies(client,body.productCode);
        const missing = ["PRODUCT","SCORE","ELIGIBILITY"].filter(kind => !policies.some(policy => policy.kind === kind));
        if (missing.length) response = { status: "POLICY_CONFIGURATION_REQUIRED", missing, readinessPercentage: null, estimatedEligibleAmountKobo: null };
        else {
          const productRow = policies.find(policy => policy.kind === "PRODUCT")!;
          const scoreRow = policies.find(policy => policy.kind === "SCORE")!;
          const eligibilityRow = policies.find(policy => policy.kind === "ELIGIBILITY")!;
          requireControl(eligibilityRow.payload.contract === "READINESS_V1","READINESS_POLICY_CONTRACT_REQUIRED");
          const product = { ...productRow.payload, code: productRow.code };
          for (const field of productMoney) product[field] = money(product[field]);
          validateProduct(product as ProductMathConfig);
          const policy: ReadinessPolicy = { product, model: { ...scoreRow.payload, status: "PUBLISHED", version: scoreRow.id } as ScoreModel,
            minimumTotalDscrMilli: eligibilityRow.payload.minimumTotalDscrMilli, salesStressBps: eligibilityRow.payload.salesStressBps, otherIncomeStressBps: eligibilityRow.payload.otherIncomeStressBps,
            maximumTotalDebtServiceRatioBps: eligibilityRow.payload.maximumTotalDebtServiceRatioBps,
            memberOrCycleLimitKobo: money(eligibilityRow.payload.memberOrCycleLimitKobo), maximumExposureKobo: money(eligibilityRow.payload.maximumExposureKobo) };
          const timestamp = (await client.query("SELECT clock_timestamp() AS now")).rows[0].now;
          const result = readinessAssessment(body,String(row.requested_amount_kobo),policy,new Date(timestamp).toISOString());
          const resultId = randomUUID();
          response = JSON.parse(JSON.stringify({ id: resultId, applicationId: id, caseRevision: row.revision, policyIds: [productRow.id,scoreRow.id,eligibilityRow.id], ...result }, (_key,value) => typeof value === "bigint" ? value.toString() : value));
          await client.query("INSERT INTO public.credit_readiness_results(id,application_id,case_revision,created_by,idempotency_key,request_hash,ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [resultId,id,row.revision,actor.id,body.idempotencyKey,hash,this.cipher.seal(response,"readiness:" + resultId)]);
        }
      }
      await client.query("INSERT INTO public.credit_audit_logs(id,entity_id,actor_id,action,old_revision,new_revision,reason,correlation_id) VALUES($1,$2,$3,'READINESS_EVALUATED',$4,$4,'Authorized preliminary policy-based readiness evaluation',$5)",[randomUUID(),id,actor.id,row.revision,body.idempotencyKey]);
      await client.query("COMMIT");
      return response;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
}
