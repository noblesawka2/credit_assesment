const status=document.querySelector("#readiness-status"),form=document.querySelector("#readiness-form"),result=document.querySelector("#readiness-result");
const caseSelect=document.querySelector("#readiness-case"),productSelect=document.querySelector("#readiness-product"),button=document.querySelector("#evaluate");
let cases=[],configuration=null,userId=null,generation=0,pending=null,saving=false;
let configurationRequest=0;
function node(tag,text){const element=document.createElement(tag);if(text)element.textContent=text;return element;}
function label(value){return value.replace(/Kobo$/,"").replace(/([a-z])([A-Z])/g,"$1 $2").replaceAll("_"," ");}
function updateHistoryInput(){const input=form.querySelector('[name="previous_nobles_repayment"]');if(input){const neutral=document.querySelector("#new-to-credit").checked;input.disabled=neutral||Boolean(pending);input.required=!neutral;}}
function clear(){generation++;userId=null;pending=null;form.hidden=true;result.replaceChildren();form.reset();cases=[];}
async function request(path,options={}){
  const started=generation;const response=await fetch(path,{cache:"no-store",signal:AbortSignal.timeout(15000),...options});const body=await response.json();
  if(started!==generation)throw new Error("Session changed. Reload after signing in.");
  if(!response.ok){if([401,403].includes(response.status))clear();const error=new Error(response.status===409?"The record changed. Reload and review the current case before trying again.":"Request rejected or service unavailable. Check your access and inputs.");error.status=response.status;throw error;}return body;
}
function kobo(value){if(!/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(value))throw new Error("Enter nonnegative naira amounts with at most two decimal places.");const [whole,fraction=""]=value.split(".");return(BigInt(whole)*100n+BigInt(fraction.padEnd(2,"0"))).toString();}
function naira(value){const amount=BigInt(value);return "₦"+(amount/100n).toLocaleString("en-NG")+"."+(amount%100n).toString().padStart(2,"0");}
async function configure(){
  result.replaceChildren();pending=null;button.disabled=true;
  const selectedProduct=productSelect.value,requestId=++configurationRequest;
  const nextConfiguration=await request("/api/readiness/config?product="+encodeURIComponent(selectedProduct));
  if(requestId!==configurationRequest||productSelect.value!==selectedProduct)return;
  configuration=nextConfiguration;
  const money=document.querySelector("#readiness-money"),factors=document.querySelector("#readiness-factors");money.replaceChildren();factors.replaceChildren();
  for(const name of configuration.moneyFields){const wrapper=node("label",label(name)+" (NGN)");wrapper.className="field";const input=node("input");input.name=name;input.required=true;input.inputMode="decimal";input.autocomplete="off";wrapper.append(input);money.append(wrapper);}
  for(const factor of configuration.factors){const wrapper=node("label",label(factor.name));wrapper.className="field";const input=node(factor.textChoices.length?"select":"input");input.name=factor.name;input.required=true;
    if(factor.textChoices.length){for(const choice of ["",...factor.textChoices]){const option=node("option",choice||"Choose a fact");option.value=choice;input.append(option);}}
    else{input.type="number";input.step="any";}wrapper.append(input);factors.append(wrapper);}
  button.disabled=configuration.missing.length>0||cases.length===0;
  updateHistoryInput();
  status.textContent=configuration.missing.length?"No estimate can be issued: publish approved "+configuration.missing.join(", ")+" policies for this product. No percentage or loan amount will be invented.":"Ready for a preliminary, audited server evaluation.";
}
form.addEventListener("submit",async event=>{
  event.preventDefault();if(saving)return;
  try {
    const selected=cases.find(item=>item.id===caseSelect.value);if(!selected)throw new Error("Select an assigned saved draft.");
    if(!pending){const fields=new FormData(form);pending={id:selected.id,body:JSON.stringify({idempotencyKey:crypto.randomUUID(),expectedRevision:selected.revision,productCode:productSelect.value,newToCredit:document.querySelector("#new-to-credit").checked,
      facts:Object.fromEntries(configuration.moneyFields.map(name=>[name,kobo(String(fields.get(name)))])),
      scoreInputs:Object.fromEntries(configuration.factors.map(factor=>[factor.name,factor.name==="previous_nobles_repayment"&&document.querySelector("#new-to-credit").checked?null:factor.textChoices.length?fields.get(factor.name):Number(fields.get(factor.name))]))})};}
    saving=true;document.querySelector("#readiness-fields").disabled=true;
    const assessment=await request("/api/readiness/"+pending.id,{method:"POST",headers:{"Content-Type":"application/json"},body:pending.body});pending=null;result.replaceChildren();
    const card=node("div");card.className="card";card.append(node("h2",label(assessment.status)));
    if(assessment.readinessPercentage===null){card.append(node("p","Published policy configuration is incomplete. No eligibility percentage or amount is available."));}
    else{const score=node("p",assessment.readinessPercentage+"%");score.className="metric";score.append(node("small","Policy-based readiness score"));card.append(score,node("h3","Estimated eligible amount: "+naira(assessment.estimatedEligibleAmountKobo)),node("p",assessment.notice));
      const reasons=node("ul");for(const reason of assessment.reasons)reasons.append(node("li",label(reason)));card.append(node("h3","Why this result"),reasons);
      const breakdown=node("details");breakdown.append(node("summary","Score breakdown"));for(const component of assessment.score.components)breakdown.append(node("p",label(component.factor)+": "+component.points+" points"));card.append(breakdown);}
    result.append(card);status.textContent="Evaluation recorded. This does not approve a loan.";
  }catch(error){if([400,401,403,404,409,413].includes(error.status))pending=null;status.textContent=error.message+(pending?" Result not confirmed: retry submits the same evaluation.":"");}
  finally{saving=false;document.querySelector("#readiness-fields").disabled=!userId;for(const input of form.querySelectorAll("input,select"))input.disabled=!userId||Boolean(pending);updateHistoryInput();}
});
document.querySelector("#new-to-credit").addEventListener("change",updateHistoryInput);
productSelect.addEventListener("change",()=>{if(pending||saving){status.textContent="Resolve the pending evaluation before changing product.";return;}void configure().catch(error=>{status.textContent=error.message;});});
addEventListener("offline",()=>{clear();status.textContent="Offline evaluations are prohibited. Sensitive content cleared.";});
setInterval(async()=>{try{const current=await request("/api/session");if(!current.canAssessReadiness||current.userId!==userId)clear();}catch{clear();}},60000);
try{const session=await request("/api/session");if(!session.canAssessReadiness)throw new Error("An authorized credit-officer session is required.");userId=session.userId;cases=await request("/api/drafts");
  for(const item of cases){const option=node("option",item.reference??item.id);option.value=item.id;caseSelect.append(option);}
  const initial=await request("/api/readiness/config");for(const code of initial.products){const option=node("option",code);option.value=code;productSelect.append(option);}form.hidden=false;await configure();
}catch(error){clear();status.textContent=error.message;}
