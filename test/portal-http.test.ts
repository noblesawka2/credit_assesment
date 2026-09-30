import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.ts";
import type { Actor } from "../src/domain/access.ts";
import type { StaffAdministration } from "../src/server/administration.ts";
import type { ReadinessRepository } from "../src/server/readiness.ts";

test("CEO and readiness HTTP APIs enforce server roles, portal surface and origin",async()=>{
  const actor:Actor={id:"11111111-1111-4111-8111-111111111111",roles:["CREDIT_OFFICER"],active:true,capabilities:[]};
  let signedIn=false,invites=0,evaluations=0;
  const options={origin:"http://localhost:3100",surface:"local" as "local"|"staff"|"administration",
    identity:{async authenticate(){return signedIn?actor:null;}},
    administration:{async overview(){return {total:0};},async directory(){return [];},async invite(){invites++;return {message:"synthetic invitation"};}} as unknown as StaffAdministration,
    readiness:{async configuration(){return {products:[],missing:["PRODUCT"]};},async evaluate(){evaluations++;return {status:"POLICY_CONFIGURATION_REQUIRED",readinessPercentage:null};}} as unknown as ReadinessRepository};
  const server=createApp(options);await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const origin="http://127.0.0.1:"+(server.address() as AddressInfo).port;
  const post=(route:string,requestOrigin=options.origin)=>fetch(origin+route,{method:"POST",headers:{Origin:requestOrigin,"Content-Type":"application/json"},body:"{}"});
  try{
    assert.equal((await fetch(origin+"/api/admin/overview")).status,401);
    assert.equal((await fetch(origin+"/api/readiness/config")).status,401);
    signedIn=true;
    assert.equal((await fetch(origin+"/api/admin/overview")).status,403);
    assert.equal((await fetch(origin+"/api/readiness/config")).status,200);
    const route="/api/readiness/22222222-2222-4222-8222-222222222222";
    assert.equal((await post(route,"https://attacker.invalid")).status,403);
    assert.equal((await post(route)).status,200);assert.equal(evaluations,1);
    actor.roles=["SUPERUSER"];
    assert.equal((await fetch(origin+"/api/readiness/config")).status,403);
    assert.equal((await fetch(origin+"/api/admin/overview")).status,200);
    assert.equal((await post("/api/admin/staff","https://attacker.invalid")).status,403);
    assert.equal((await post("/api/admin/staff")).status,200);assert.equal(invites,1);
    options.surface="staff";
    assert.equal((await fetch(origin+"/api/admin/overview")).status,403);
    assert.equal((await fetch(origin+"/credit/admin")).status,404);
    actor.active=false;
    assert.equal((await post(route)).status,403);
    assert.equal((await fetch(origin+"/.env.migrate")).status,404);
    assert.equal((await fetch(origin+"/config/supabase-invite.html")).status,404);
    const logo=await fetch(origin+"/nobles-logo.png");assert.equal(logo.status,200);assert.match(logo.headers.get("content-type")!,/^image\/png/);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
