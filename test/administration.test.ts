import test from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { StaffAdministration } from "../src/server/administration.ts";
import type { SupabaseStaffAuth } from "../src/server/supabase-auth.ts";
import { PayloadCipher } from "../src/server/encryption.ts";
import type { Actor } from "../src/domain/access.ts";
const ceo:Actor={id:"11111111-1111-4111-8111-111111111111",roles:["SUPERUSER"],active:true,capabilities:[],staffId:"UCHE0001"};
function fixture(){
  const events:unknown[][]=[];const created:unknown[]=[];const sent:unknown[]=[];const users:Record<string,unknown>[]=[];
  const pool={async query(_sql:string,values:unknown[]){events.push(values);return {rows:[]};}} as unknown as pg.Pool;
  const provider={async directory(){return users;},async prepareStaff(email:string,metadata:unknown){created.push({email,metadata});return "22222222-2222-4222-8222-222222222222";},async sendInvitation(email:string,url:string){sent.push({email,url});}} as unknown as SupabaseStaffAuth;
  const env={STAFF_INVITATIONS_ENABLED:"true",STAFF_APP_ORIGIN:"https://staff.example.test",ADMIN_APP_ORIGIN:"https://checker.portal.mynoblescooperative.com"};
  return {pool,provider,env,events,created,sent,users,service:new StaffAdministration(pool,provider,new PayloadCipher("12".repeat(32)),env)};
}
test("CEO can invite approved staff with immutable audit and no public or superuser role escalation",async()=>{
  const setup=fixture();await setup.service.invite(ceo,{email:"officer@example.test",staffId:"OFF0001",role:"CREDIT_OFFICER"});
  assert.equal(setup.created.length,1);assert.equal(setup.sent.length,1);assert.equal(setup.events.length,2);
  assert.ok(!JSON.stringify(setup.events).includes("officer@example.test"));
  await assert.rejects(setup.service.invite(ceo,{email:"another@example.test",staffId:"OFF0002",role:"SUPERUSER"}),/FORBIDDEN/);
  await assert.rejects(setup.service.invite({...ceo,roles:["OPERATIONS_CHECKER"]},{email:"another@example.test",staffId:"OFF0002",role:"CREDIT_OFFICER"}),/FORBIDDEN/);
});
test("bootstrap binds only the nominated CEO with daily authority pending policy publication",async()=>{
  const setup=fixture();await setup.service.bootstrapCeo();
  assert.deepEqual(setup.created,[{email:"chinelo.nnazor@gmail.com",metadata:{active:true,staff:true,staffId:"UCHE0001",roles:["SUPERUSER","CREDIT_APPROVER"],invitationPending:true,approvalAuthority:{dailyLimitKobo:"100000000",timeZone:"Africa/Lagos",productCodes:[],status:"PENDING_POLICY_PUBLICATION"}}}]);
  assert.deepEqual(setup.sent,[{email:"chinelo.nnazor@gmail.com",url:"https://checker.portal.mynoblescooperative.com/credit/auth"}]);
  assert.equal(setup.events[0][2],"AUTHORIZED_LOCAL_BOOTSTRAP");
});
test("invitation configuration and existing-account conflicts fail before any provider write",async()=>{
  const setup=fixture();setup.env.STAFF_INVITATIONS_ENABLED="false";
  await assert.rejects(setup.service.bootstrapCeo(),/INVITATIONS_NOT_CONFIGURED/);
  setup.env.STAFF_INVITATIONS_ENABLED="true";setup.users.push({email:"chinelo.nnazor@gmail.com"});
  await assert.rejects(setup.service.bootstrapCeo(),/STAFF_ALREADY_EXISTS/);
  assert.equal(setup.created.length,0);assert.equal(setup.sent.length,0);
});
