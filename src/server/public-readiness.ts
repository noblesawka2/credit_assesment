import type { Pool, PoolClient } from 'pg';
import { validateProduct } from '../domain/diagnostic.ts';
import type { ProductMathConfig } from '../domain/money.ts';
import { assertPublicReadinessShape, parsePublicReadinessInput, publicReadinessAssessment, publicReadinessPolicy } from '../domain/public-readiness.ts';
import { DomainError, money } from '../domain/validation.ts';

const productMoney = ['minimumPrincipalKobo', 'maximumPrincipalKobo', 'principalIncrementKobo', 'spreadFixedChargesKobo', 'fixedPeriodicObligationKobo', 'deductedFromProceedsFixedKobo'] as const;

interface PolicyRow {
  kind: 'PRODUCT' | 'SCORE' | 'ELIGIBILITY';
  code: string;
  payload: Record<string, unknown>;
}

function validatedProduct(row: PolicyRow) {
  const product = { ...row.payload, code: row.code } as Record<string, unknown>;
  for (const field of productMoney) product[field] = money(product[field]);
  validateProduct(product as unknown as ProductMathConfig);
  return product;
}

function selectedPolicies(rows: PolicyRow[]) {
  return {
    product: rows.find(row => row.kind === 'PRODUCT'),
    score: rows.find(row => row.kind === 'SCORE'),
    eligibility: rows.find(row => row.kind === 'ELIGIBILITY')
  };
}

export class PublicReadinessRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  private async begin(client: PoolClient) {
    await client.query('BEGIN READ ONLY');
    await client.query(`SELECT set_config('nobles.can_readiness','true',true)`);
  }

  private async current(client: PoolClient, code?: string): Promise<PolicyRow[]> {
    const suffix = code ? ' AND code=$1' : '';
    const values = code ? [code] : [];
    return (await client.query(
      `SELECT DISTINCT ON (kind,code) kind,code,payload FROM public.credit_policy_versions WHERE status='PUBLISHED' AND unresolved='[]'::jsonb AND effective_at<=now() AND kind IN ('PRODUCT','SCORE','ELIGIBILITY')` + suffix + ' ORDER BY kind,code,effective_at DESC,version DESC',
      values
    )).rows as PolicyRow[];
  }

  async configuration() {
    const client = await this.pool.connect();
    try {
      await this.begin(client);
      const rows = await this.current(client);
      const codes = [...new Set(rows.filter(row => row.kind === 'PRODUCT').map(row => row.code))].sort();
      const products = [];
      for (const code of codes) {
        const selected = selectedPolicies(rows.filter(row => row.code === code));
        if (!selected.product || !selected.score || !selected.eligibility) continue;
        try {
          validatedProduct(selected.product);
          const policy = publicReadinessPolicy(selected.score.payload, selected.eligibility.payload);
          const publicName = selected.product.payload.publicName;
          products.push({
            code,
            name: typeof publicName === 'string' && publicName.trim().length > 0 && publicName.length <= 100 ? publicName.trim() : code,
            purposeCodes: policy.purposeCodes
          });
        } catch (error) {
          if (!(error instanceof DomainError)) throw error;
        }
      }
      await client.query('COMMIT');
      return products.length > 0
        ? { status: 'AVAILABLE', products }
        : { status: 'POLICY_CONFIGURATION_REQUIRED', products: [] };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async evaluate(body: Record<string, unknown>) {
    assertPublicReadinessShape(body);
    const client = await this.pool.connect();
    try {
      await this.begin(client);
      const rows = await this.current(client, body.productCode as string);
      const selected = selectedPolicies(rows);
      if (!selected.product || !selected.score || !selected.eligibility) {
        await client.query('COMMIT');
        return { status: 'POLICY_CONFIGURATION_REQUIRED', readinessPercentage: null, reasons: [], estimatedEligibleAmountKobo: null };
      }
      validatedProduct(selected.product);
      const policy = publicReadinessPolicy(selected.score.payload, selected.eligibility.payload);
      const input = parsePublicReadinessInput(body, policy);
      const result = publicReadinessAssessment(input, policy);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof DomainError && error.code === 'PUBLIC_READINESS_POLICY_REQUIRED') {
        return { status: 'POLICY_CONFIGURATION_REQUIRED', readinessPercentage: null, reasons: [], estimatedEligibleAmountKobo: null };
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
