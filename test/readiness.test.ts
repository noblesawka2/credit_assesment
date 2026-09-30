import test from "node:test";
import assert from "node:assert/strict";
import { readinessAssessment, type ReadinessPolicy } from "../src/domain/readiness.ts";
import { FACTORS, type Factor, type ScoreModel } from "../src/domain/score.ts";
import { product } from "./fixtures.ts";
import { authorize } from "../src/domain/access.ts";
import { ReadinessRepository } from "../src/server/readiness.ts";
import { PayloadCipher } from "../src/server/encryption.ts";
import type pg from "pg";

function fixture() {
  const model: ScoreModel = { version:"TEST_ONLY",status:"PUBLISHED",neutralNewToCreditPoints:3,
    rules:Object.fromEntries(Object.entries(FACTORS).map(([name,points])=>[name,[{minimum:0,points}]])) as ScoreModel["rules"] };
  const policy: ReadinessPolicy = {product,model,minimumTotalDscrMilli:1250,salesStressBps:1000,otherIncomeStressBps:2000,memberOrCycleLimitKobo:100000000n,maximumExposureKobo:100000000n};
  const body={newToCredit:false,facts:{monthlySalesKobo:"100000000",monthlyCostOfGoodsKobo:"20000000",monthlyOperatingExpensesKobo:"5000000",otherStableIncomeKobo:"0",householdOutflowKobo:"5000000",mandatoryCommitmentsKobo:"0",existingMonthlyDebtServiceKobo:"0",netFundingNeedKobo:"20000000",outstandingExposureKobo:"0"},
    scoreInputs:Object.fromEntries(Object.keys(FACTORS).map(name=>[name,1])) as Record<Factor,number>};
  return {body,policy};
}
test("readiness reuses published score and affordability calculations without claiming approval",()=>{
  const {body,policy}=fixture();const result=readinessAssessment(body,"30000000",policy,"2026-09-25T10:00:00Z");
  assert.equal(result.readinessPercentage,100);assert.equal(result.status,"READY_FOR_REVIEW");
  assert.equal(result.inputBasis,"OFFICER_REPORTED_UNVERIFIED");assert.match(result.percentageMeaning,/not a probability/);
  assert.ok(BigInt(result.estimatedEligibleAmountKobo)>0n&&BigInt(result.estimatedEligibleAmountKobo)<=30000000n);
  assert.ok(result.reasons.some(reason=>reason.startsWith("AMOUNT_LIMITED_BY_")));
});
test("no affordability or failed readiness returns zero estimated eligibility with reasons",()=>{
  const {body,policy}=fixture();body.facts.monthlySalesKobo="0";
  const result=readinessAssessment(body,"30000000",policy,"2026-09-25T10:00:00Z");
  assert.equal(result.status,"NOT_READY");assert.equal(result.estimatedEligibleAmountKobo,"0");assert.ok(result.reasons.includes("NEGATIVE_REPAYMENT_CAPACITY"));
});
test("draft score models and missing or invalid financial facts never generate estimates",()=>{
  const {body,policy}=fixture();
  assert.throws(()=>readinessAssessment(body,"30000000",{...policy,model:{...policy.model,status:"DRAFT"}},"2026-09-25T10:00:00Z"),/NOT_PUBLISHED/);
  assert.throws(()=>readinessAssessment({...body,facts:{}},"30000000",policy,"2026-09-25T10:00:00Z"),/INVALID_MONEY/);
  assert.throws(()=>readinessAssessment({...body,newToCredit:"yes"},"30000000",policy,"2026-09-25T10:00:00Z"),/CREDIT_HISTORY/);
});
test("CEO administration does not imply underwriting, approval, policy publication or audit mutation",()=>{
  const ceo={id:"ceo",roles:["SUPERUSER"] as const,active:true,capabilities:[]};
  const actor={...ceo,roles:[...ceo.roles]};
  authorize(actor,"STAFF_ADMIN");authorize(actor,"OVERVIEW");
  for(const action of ["DECIDE","VERIFY","POLICY_PUBLISH","CAPTURE","READINESS"] as const)assert.throws(()=>authorize(actor,action),/FORBIDDEN/);
});
test("readiness repository fails closed on missing published policies and audits before returning",async()=>{
  const calls:string[]=[];const actor={id:"11111111-1111-4111-8111-111111111111",roles:["CREDIT_OFFICER"] as Array<"CREDIT_OFFICER">,active:true,capabilities:[]};
  const client={release(){},async query(sql:string){calls.push(sql);
    if(sql.startsWith("SELECT id,revision"))return {rowCount:1,rows:[{id:"22222222-2222-4222-8222-222222222222",revision:1,status:"DRAFT",requested_amount_kobo:"100000"}]};
    return {rowCount:0,rows:[]};
  }};
  const repository=new ReadinessRepository({connect:async()=>client} as unknown as pg.Pool,new PayloadCipher("12".repeat(32)));
  const result=await repository.evaluate(actor,"22222222-2222-4222-8222-222222222222",{idempotencyKey:"33333333-3333-4333-8333-333333333333",expectedRevision:1,productCode:"UNPUBLISHED"}) as {status:string;readinessPercentage:null};
  assert.equal(result.status,"POLICY_CONFIGURATION_REQUIRED");assert.equal(result.readinessPercentage,null);
  assert.ok(calls.some(sql=>sql.includes("READINESS_EVALUATED")));assert.equal(calls.at(-1),"COMMIT");
  assert.ok(!calls.some(sql=>sql.startsWith("INSERT INTO public.credit_readiness_results")));
  await assert.rejects(repository.evaluate({...actor,roles:["SUPERUSER"] as unknown as Array<"CREDIT_OFFICER">},"22222222-2222-4222-8222-222222222222",{}),/FORBIDDEN/);
});
