const status = document.querySelector("#admin-status");
const workspace = document.querySelector("#admin-workspace");
const directory = document.querySelector("#staff-directory");
const overview = document.querySelector("#overview");
const form = document.querySelector("#staff-invite");
let userId = null;
let generation = 0;
function clear() { generation++; userId = null; workspace.hidden = true; directory.replaceChildren(); overview.replaceChildren(); form.reset(); }
function node(tag,text) { const element=document.createElement(tag); element.textContent=text; return element; }
async function request(path, options={}) {
  const started=generation;
  const response=await fetch(path,{cache:"no-store",signal:AbortSignal.timeout(15000),...options});
  const result=await response.json();
  if(started!==generation) throw new Error("Session changed. Reload after signing in.");
  if(!response.ok) {
    if([401,403].includes(response.status)) clear();
    throw new Error(result.error==="INVITATIONS_NOT_CONFIGURED" ? "Invitations are disabled until hosting, HTTPS, SMTP and the Supabase invitation template are verified." : "Request failed. Check access or contact the system custodian. Do not retry an uncertain invitation automatically.");
  }
  return result;
}
async function refresh() {
  try {
    const session=await request("/api/session");
    if(!session.canAdminister) { clear(); status.textContent="An active CEO administrator session on the administration portal is required."; return; }
    if(userId!==session.userId) { clear(); userId=session.userId; }
    const summary=await request("/api/admin/overview");
    const staff=await request("/api/admin/staff");
    overview.replaceChildren();
    const total=node("div",""); total.className="card"; total.append(node("h2","Assessments"),node("p",String(summary.total))); overview.append(total);
    for(const bucket of summary.statuses) { const card=node("div",""); card.className="card"; card.append(node("h2",bucket.status.replaceAll("_"," ")),node("p",String(bucket.count))); overview.append(card); }
    const role=document.querySelector("#staff-role"); role.replaceChildren();
    for(const value of staff.roles) { const option=node("option",value.replaceAll("_"," ")); option.value=value; role.append(option); }
    const table=node("table",""); const header=node("tr","");
    for(const label of ["Staff ID","Email","Roles","Account"]) header.append(node("th",label)); table.append(header);
    for(const member of staff.staff) { const row=node("tr",""); for(const value of [member.staffId??"Not assigned",member.email,(member.roles??[]).join(", "),!member.active?"Disabled":member.invitationPending?"Invitation pending":member.emailConfirmed?"Active":"Email not confirmed"]) row.append(node("td",String(value))); table.append(row); }
    directory.replaceChildren(table); workspace.hidden=false; status.textContent="CEO overview. All staff-administration actions are audited.";
  } catch(error) { clear(); status.textContent=error.message; }
}
form.addEventListener("submit",async event=>{
  event.preventDefault(); const button=form.querySelector("button"); button.disabled=true;
  try { const result=await request("/api/admin/staff",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.fromEntries(new FormData(form)))}); form.reset(); await refresh(); status.textContent=result.message; }
  catch(error) { status.textContent=error.message; }
  finally { button.disabled=false; }
});
addEventListener("offline",()=>{clear();status.textContent="Administration requires an online connection. Sensitive content cleared.";});
addEventListener("online",()=>{void refresh();});
setInterval(async()=>{try{const session=await request("/api/session");if(!session.canAdminister||session.userId!==userId)clear();}catch{clear();}},60000);
await refresh();
