import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server/app.ts';
import type { Actor } from '../src/domain/access.ts';
import { parsePublicReadinessInput, publicReadinessAssessment, publicReadinessPolicy } from '../src/domain/public-readiness.ts';
import { PublicReadinessRepository } from '../src/server/public-readiness.ts';
import type { StaffAuthentication } from '../src/server/staff-auth.ts';
import type pg from 'pg';

const scorePayload = {
  publicSelfCheck: {
    contract: 'PUBLIC_SCORE_V1', maximumPoints: 100,
    rules: [
      { metric: 'DISPOSABLE_INCOME_RATIO_BPS', maximumExclusive: 2000, points: 0, outcome: 'BLOCKER' },
      { metric: 'DISPOSABLE_INCOME_RATIO_BPS', minimumInclusive: 2000, points: 40, outcome: 'STRONG' },
      { metric: 'EXISTING_DEBT_RATIO_BPS', maximumExclusive: 3000, points: 30, outcome: 'STRONG' },
      { metric: 'EXISTING_DEBT_RATIO_BPS', minimumInclusive: 3000, points: 0, outcome: 'BLOCKER' },
      { metric: 'REQUESTED_TO_ANNUAL_INCOME_BPS', maximumExclusive: 5000, points: 30, outcome: 'STRONG' },
      { metric: 'REQUESTED_TO_ANNUAL_INCOME_BPS', minimumInclusive: 5000, points: 0, outcome: 'BLOCKER' }
    ]
  }
};
const eligibilityPayload = {
  publicSelfCheck: {
    contract: 'PUBLIC_READINESS_V1',
    maximumMonthlyAmountKobo: '100000000000', maximumRequestedAmountKobo: '1000000000000',
    readyMinimumPercentage: 80, reviewMinimumPercentage: 50, purposeCodes: ['WORKING_CAPITAL']
  }
};
const body = {
  productCode: 'MARKET_LIFT', purposeCode: 'WORKING_CAPITAL', incomeType: 'BUSINESS',
  monthlyIncomeKobo: '50000000', monthlyBusinessCostsKobo: '10000000',
  monthlyHouseholdExpensesKobo: '10000000', monthlyOtherCommitmentsKobo: '5000000',
  monthlyExistingRepaymentsKobo: '5000000', requestedAmountKobo: '100000000'
};

test('public readiness uses only approved policy rules and returns no eligible amount', () => {
  const policy = publicReadinessPolicy(scorePayload, eligibilityPayload);
  const result = publicReadinessAssessment(parsePublicReadinessInput(body, policy), policy);
  assert.equal(result.status, 'READY_FOR_FORMAL_REVIEW');
  assert.equal(result.readinessPercentage, 100);
  assert.equal(result.estimatedEligibleAmountKobo, null);
  assert.equal(result.reasons.length, 3);
  assert.doesNotMatch(JSON.stringify(result), /threshold|minimumInclusive|maximumExclusive|policy/i);
});

test('public readiness rejects identity fields, incomplete ranges and unapproved contracts', () => {
  const policy = publicReadinessPolicy(scorePayload, eligibilityPayload);
  assert.throws(() => parsePublicReadinessInput({ ...body, bvn: 'should-never-be-accepted' }, policy), /INVALID_PUBLIC_READINESS_INPUT/);
  assert.throws(() => parsePublicReadinessInput({ ...body, monthlyIncomeKobo: '0' }, policy), /INVALID_PUBLIC_READINESS_INPUT/);
  assert.throws(() => parsePublicReadinessInput({ ...body, requestedAmountKobo: '1000000000001' }, policy), /PUBLIC_READINESS_INPUT_OUT_OF_RANGE/);
  assert.throws(() => publicReadinessPolicy({}, eligibilityPayload), /PUBLIC_READINESS_POLICY_REQUIRED/);
});

test('public repository calculates in a read-only transaction without storing answers', async () => {
  const queries: string[] = [];
  const rows = [
    { kind: 'PRODUCT', code: 'MARKET_LIFT', payload: {
      publicName: 'Market Lift', minimumPrincipalKobo: '10000', maximumPrincipalKobo: '1000000000', principalIncrementKobo: '100',
      numberOfRepaymentPeriods: 12, periodsPerMonthMilli: 1000, spreadCycleInterestBps: 1000,
      spreadPercentageChargesBps: 0, spreadFixedChargesKobo: '0', compulsorySavingsCycleBps: 0,
      fixedPeriodicObligationKobo: '0', deductedFromProceedsBps: 0, deductedFromProceedsFixedKobo: '0'
    } },
    { kind: 'SCORE', code: 'MARKET_LIFT', payload: scorePayload },
    { kind: 'ELIGIBILITY', code: 'MARKET_LIFT', payload: eligibilityPayload }
  ];
  const client = {
    async query(input: string) {
      queries.push(input);
      return { rows: input.startsWith('SELECT DISTINCT ON') ? rows : [] };
    },
    release() {}
  };
  const repository = new PublicReadinessRepository({ async connect() { return client; } } as unknown as pg.Pool);
  const result = await repository.evaluate(body);
  assert.equal(result.status, 'READY_FOR_FORMAL_REVIEW');
  assert.equal(result.estimatedEligibleAmountKobo, null);
  assert.equal(queries[0], 'BEGIN READ ONLY');
  assert.equal(queries.at(-1), 'COMMIT');
  assert.ok(queries.every(query => !/^\s*(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP)\b/i.test(query)));
});

test('public route is staff-only, rate-limited and protected shells require server authentication', async () => {
  const origin = 'http://localhost:3100';
  const actor: Actor = { id: '11111111-1111-4111-8111-111111111111', roles: ['CREDIT_OFFICER'], active: true, capabilities: [] };
  let signedIn = false;
  const categories: string[] = [];
  const staffAuth = {
    async authenticate() { return signedIn ? actor : null; },
    async rateLimit(_request: unknown, category: string) { categories.push(category); },
    async audit() {},
    clearCookie() {}
  } as unknown as StaffAuthentication;
  const publicReadiness = {
    async configuration() { return { status: 'POLICY_CONFIGURATION_REQUIRED', products: [] }; },
    async evaluate() { return { status: 'POLICY_CONFIGURATION_REQUIRED', readinessPercentage: null, reasons: [], estimatedEligibleAmountKobo: null }; }
  } as unknown as PublicReadinessRepository;
  const options = { origin, surface: 'staff' as 'staff' | 'administration', staffAuth, publicReadiness };
  const server = createApp(options);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const manual = { redirect: 'manual' as const };
  try {
    const page = await fetch(address + '/check');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /No identity details/);
    assert.equal((await fetch(address + '/credit/readiness', manual)).status, 302);
    assert.equal((await fetch(address + '/credit/staff', manual)).status, 302);
    assert.equal((await fetch(address + '/credit/admin', manual)).status, 404);
    assert.equal((await fetch(address + '/api/public/readiness/config')).status, 200);
    assert.deepEqual(categories, ['api', 'public-readiness']);
    assert.equal((await fetch(address + '/api/public/readiness/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await fetch(address + '/api/public/readiness/evaluate', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' })).status, 200);
    signedIn = true;
    assert.equal((await fetch(address + '/credit/readiness')).status, 200);
    assert.equal((await fetch(address + '/credit/staff')).status, 200);
    options.surface = 'administration';
    assert.equal((await fetch(address + '/check')).status, 404);
    assert.equal((await fetch(address + '/api/public/readiness/config')).status, 403);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
