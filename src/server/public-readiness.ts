import type { Pool, PoolClient } from 'pg';
import { assertPublicReadinessShape, parsePublicGuidanceInput, publicFinancialGuidanceAssessment } from '../domain/public-readiness.ts';
import { publicProductCatalog, publicProductGuidance, publicPurposeCatalog, publicPurposeGuidance } from '../domain/product-guidance.ts';
import { requireControl } from '../domain/validation.ts';

function guidanceOptions() {
  const purposes = publicPurposeCatalog();
  return publicProductCatalog().map(product => ({
    code: product.code,
    name: product.name,
    purposeCodes: purposes.filter(purpose => purpose.suggestedProductCodes.includes(product.code)).map(purpose => purpose.code),
    guidance: product
  }));
}

export class PublicReadinessRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  private async begin(client: PoolClient) {
    await client.query('BEGIN READ ONLY');
    await client.query(`SELECT set_config('nobles.can_readiness','true',true)`);
  }

  async configuration() {
    const client = await this.pool.connect();
    try {
      await this.begin(client);
      const products = guidanceOptions();
      await client.query('COMMIT');
      const purposeCatalog = publicPurposeCatalog();
      const guidanceProducts = publicProductCatalog();
      return { status: 'AVAILABLE', calculationMode: 'FINANCIAL_GUIDANCE', products, purposeCatalog, guidanceProducts };
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
      const input = parsePublicGuidanceInput(body);
      const guidance = publicProductGuidance(input.productCode);
      const purpose = publicPurposeGuidance(input.purposeCode);
      requireControl(Boolean(guidance) && Boolean(purpose) && purpose!.suggestedProductCodes.includes(input.productCode), 'INVALID_PRODUCT_FOR_PURPOSE');
      const result = publicFinancialGuidanceAssessment(input);
      const suggestedPlan = {
        productCode: input.productCode,
        productName: guidance!.name,
        purpose: purpose!.label,
        summary: guidance!.summary,
        repaymentPattern: guidance!.repaymentPattern,
        amountGuide: guidance!.amountGuide,
        nextStep: 'Discuss this product and the figures entered with a Nobles officer for verification and a formal assessment.'
      };
      await client.query('COMMIT');
      return { ...result, suggestedPlan };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
