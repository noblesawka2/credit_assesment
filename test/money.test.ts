import test from "node:test";
import assert from "node:assert/strict";
import * as math from "../src/domain/money.ts";
import { diagnostic, demonstratedNeed, repaymentSchedule, validateCashFlow, validateProduct } from "../src/domain/diagnostic.ts";
import { money } from "../src/domain/validation.ts";
import { normalizeExpenseGroups } from "../src/domain/verification.ts";
import { cashFlow, product } from "./fixtures.ts";

for (const [frequency, expected] of Object.entries({ DAILY: 259800n, WEEKLY: 43300n, FORTNIGHTLY: 21650n, MONTHLY: 10000n, QUARTERLY: 3333n, TERMLY: 2500n, ANNUAL: 833n })) {
  test("normalisation " + frequency, () => assert.equal(math.normalizeToMonthly(10000n, frequency as math.Frequency, 6), expected));
}
test("rejects negative cash and unsupported frequency", () => {
  assert.throws(() => math.normalizeToMonthly(-1n, "MONTHLY"));
  assert.throws(() => math.normalizeToMonthly(100n, "OTHER" as math.Frequency));
  assert.throws(() => math.normalizeToMonthly(100n, "DAILY", 8));
});
test("money boundary rejects binary floats, negatives and oversized values", () => {
  for (const value of [1.1, 100, "-1", "1.0", "01", "1e3", "9".repeat(25)]) assert.throws(() => money(value));
  assert.equal(money("900719925474099300"), 900719925474099300n);
});
test("profit, household outflow, base and stressed capacity", () => {
  const result = math.calculateCashFlow(cashFlow);
  assert.equal(result.grossProfitKobo, 40000000n);
  assert.equal(result.grossMarginBps, 4000);
  assert.equal(result.netBusinessIncomeKobo, 35000000n);
  assert.equal(result.cashAvailableForAllDebtKobo, 33000000n);
  assert.equal(result.capacityByDscrKobo, 21400000n);
  assert.equal(result.stressedSalesKobo, 90000000n);
  assert.equal(result.stressedCashAvailableKobo, 27000000n);
  assert.equal(result.finalMonthlyNewLoanCapacityKobo, 16600000n);
});
test("salary 40 percent control includes existing debt", () => {
  const salary = { ...cashFlow, verifiedMonthlySalesKobo: 0n, verifiedMonthlyCogsKobo: 0n, verifiedMonthlyOperatingExpensesKobo: 0n, verifiedOtherStableIncomeKobo: 10000000n, verifiedHouseholdOutflowKobo: 1000000n, mandatoryNonDebtCommitmentsKobo: 0n, existingMonthlyDebtServiceKobo: 1000000n, maximumTotalDebtServiceRatioBps: 4000, otherIncomeStressBps: 0 };
  assert.equal(math.calculateCashFlow(salary).capacityByIncomeRatioKobo, 3000000n);
  assert.equal(math.calculateCashFlow(salary).finalMonthlyNewLoanCapacityKobo, 3000000n);
});
test("debt and drawings are not double-counted as operating or household costs", () => {
  const groups = normalizeExpenseGroups([
    { id: "rent", group: "OPERATING", amountKobo: 120000n, frequency: "ANNUAL" },
    { id: "food", group: "HOUSEHOLD", amountKobo: 20000n, frequency: "MONTHLY" },
    { id: "loan", group: "DEBT", amountKobo: 10000n, frequency: "WEEKLY" },
    { id: "drawings", group: "OWNER_DRAWINGS", amountKobo: 20000n, frequency: "MONTHLY" }
  ]);
  assert.deepEqual(groups, { operatingKobo: 10000n, householdKobo: 20000n, debtKobo: 43300n, ownerDrawingsReconciliationKobo: 20000n });
  assert.throws(() => normalizeExpenseGroups([{ id: "same", group: "DEBT", amountKobo: 1n, frequency: "MONTHLY" }, { id: "same", group: "HOUSEHOLD", amountKobo: 1n, frequency: "MONTHLY" }]));
});
test("zero income and debt do not produce infinity", () => {
  assert.equal(math.calculateDscrMilli(0n, 0n, 0n), null);
  assert.equal(math.calculateDscrMilli(100000n, 20000n, 30000n), 2000);
});
for (const [name, config, principal, expected] of [
  ["MarketLift", { ...product, numberOfRepaymentPeriods: 25, spreadCycleInterestBps: 0, compulsorySavingsCycleBps: 2500 }, 10000000n, 500000n],
  ["MarketPower", product, 30000000n, 2812500n],
  ["EasyPay", { ...product, numberOfRepaymentPeriods: 6, spreadCycleInterestBps: 3600, compulsorySavingsCycleBps: 0 }, 60000000n, 13600000n],
  ["Unity", { ...product, spreadCycleInterestBps: 2400, spreadPercentageChargesBps: 350, spreadFixedChargesKobo: 200000n, compulsorySavingsCycleBps: 0 }, 16000000n, 1287500n]
] as const) test(name + " illustrative repayment math, not activated policy", () => assert.equal(math.scheduledCollectionPerPeriod(principal, config), expected));
test("schedule distributes remainder kobo exactly", () => {
  const schedule = repaymentSchedule(10001n, product);
  assert.equal(schedule.reduce((total, item) => total + item.collectionKobo, 0n), 15001n);
  assert.equal(schedule[0].collectionKobo - schedule.at(-1)!.collectionKobo, 1n);
});
test("net proceeds and demonstrated need gross-up", () => {
  assert.equal(math.netUsableProceeds(30000000n, product), 29050000n);
  const gross = math.grossPrincipalRequiredForNeed(22000000n, product);
  assert.ok(math.netUsableProceeds(gross, product) >= 22000000n);
  assert.equal(gross % product.principalIncrementKobo, 0n);
});
test("inverse formula never generates an unaffordable peak collection", () => {
  for (let capacity = 10000n; capacity < 150000n; capacity += 713n) {
    const supported = math.repaymentSupportedPrincipal(capacity, product);
    for (const period of repaymentSchedule(supported, product)) assert.ok(period.collectionKobo <= capacity);
  }
});
test("300k requested, 220k need, 180k supported returns 180k", () => assert.equal(math.systemRecommendedCeiling({ requestedAmountKobo: 30000000n, grossPrincipalRequiredForNeedKobo: 22000000n, repaymentSupportedAmountKobo: 18000000n, productLimitKobo: 30000000n, memberOrCycleLimitKobo: 30000000n, remainingExposureLimitKobo: 30000000n }), 18000000n));
test("need uses verified eligible lines and subtracts contributions", () => {
  assert.equal(demonstratedNeed([{ eligible: true, verifiedTotalKobo: 22000000n }, { eligible: false, verifiedTotalKobo: 5000000n }], 2000000n, 1000000n).demonstratedNetNeedKobo, 19000000n);
  assert.throws(() => demonstratedNeed([{ eligible: true, verifiedTotalKobo: null }], 0n, 0n));
});
test("invalid policy inputs cannot calculate", () => {
  assert.throws(() => validateProduct({ ...product, deductedFromProceedsBps: 10000 }));
  assert.throws(() => validateProduct({ ...product, principalIncrementKobo: 0n }));
  assert.throws(() => validateCashFlow({ ...cashFlow, salesStressBps: 10001 }));
  assert.throws(() => math.calculateCashFlow({ ...cashFlow, salesStressBps: 10001 }));
  assert.throws(() => math.mulBpsDown(100n, 1.5));
  assert.throws(() => math.normalizeToMonthly(100n, "DAILY", 2.5));
  assert.throws(() => math.repaymentSupportedPrincipal(100n, { ...product, spreadFixedChargesKobo: -1n }));
  assert.equal(math.grossPrincipalRequiredForNeed(0n, product), 0n);
});
test("diagnostic includes all four stage simulations and zero need gives zero ceiling", () => {
  const result = diagnostic({ cashFlow, product, requestedAmountKobo: 30000000n, demonstratedNetNeedKobo: 0n, memberOrCycleLimitKobo: 30000000n, remainingExposureLimitKobo: 30000000n, officerRecommendedAmountKobo: 10000000n, approvedAmountKobo: 10000000n });
  assert.equal(result.simulations.length, 4);
  assert.equal(result.systemRecommendedCeilingKobo, 0n);
  assert.ok(result.hardStops.includes("SUPPORTED_AMOUNT_BELOW_PRODUCT_MINIMUM"));
});
