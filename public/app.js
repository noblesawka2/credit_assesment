const screens = [
  ["start", "Your membership", "Let us understand your need", [["memberNumber", "Registered member number"], ["fullNameClaim", "Your full name"], ["registeredPhone", "Registered phone number", "tel"], ["serviceLocation", "Branch or service location"], ["assessmentConsent", "I consent to this assessment", "checkbox"], ["verificationConsent", "I consent to verification of my information", "checkbox"], ["creditInformationConsent", "I consent to authorised credit-information checks", "checkbox"], ["dataProcessingConsent", "I consent to processing my information for this assessment", "checkbox"]]],
  ["request", "Your request", "What do you need the money for?", [["requestedAmount", "How much do you need? (NGN)", "money"], ["fundsNeededDate", "When do you need the funds?", "date"], ["purpose", "What will you use the money for?", "textarea"], ["frequency", "Preferred repayment frequency", "select", ["Daily", "Weekly", "Monthly"]]]],
  ["income-route", "Income source", "Where will the repayment money come from?", [["incomeRoute", "Main source of income", "select", ["Trading or shop", "Daily market business", "Service business", "Salary", "Group business loan", "Other approved income"]]]],
  ["business", "Your business", "Tell us about your business", [["businessName", "Business name"], ["businessType", "What do you sell or provide?"], ["businessLocation", "Market or business location"], ["landmark", "Closest landmark"], ["businessAgeMonths", "How many months have you operated?", "number"], ["locationMonths", "Months at this location", "number"], ["suppliers", "Main suppliers"], ["records", "How do you keep your records?"]]],
  ["sales", "Money coming in", "Money coming into the business", [["normalSales", "How much do you normally sell? (NGN)", "money"], ["salesCadence", "Is this per day, week or month?", "select", ["Daily", "Weekly", "Monthly"]], ["busySales", "How much do you sell in a very good period? (NGN)", "money"], ["slowSales", "How much do you sell in a slow period? (NGN)", "money"], ["operatingDays", "How many days do you open each week?", "number"]]],
  ["business-costs", "Business spending", "Money going back into the business", [["stockCost", "How much do you spend replacing goods sold? (NGN)", "money"], ["stockCadence", "How often?", "select", ["Daily", "Weekly", "Monthly"]], ["otherBusinessCosts", "Describe transport, rent, power, wages and other costs", "textarea"], ["ownerDrawings", "How much do you take home? (NGN)", "money"]]],
  ["household", "Home responsibilities", "Home and family responsibilities", [["householdCosts", "Describe food, housing, school fees, medical and other essential costs with amounts and frequency", "textarea"], ["dependants", "How many people depend on your income?", "number"], ["otherIncome", "Other stable income (NGN)", "money"], ["otherIncomeSource", "Where does that income come from?"]]],
  ["debts", "Current repayments", "Who else are you currently paying?", [["debts", "List each creditor, balance, repayment amount, frequency and any late payments", "textarea"]]],
  ["use-of-funds", "What the money covers", "What exactly will the money buy or pay for?", [["fundingItems", "List items, quantities, supplier prices and expected benefits", "textarea"], ["ownContribution", "Your own contribution (NGN)", "money"], ["otherFunding", "Other confirmed funding (NGN)", "money"]]],
  ["salary", "Salary details", "Tell us about your salary", [["employer", "Employer"], ["jobTitle", "Job title"], ["employmentStart", "Employment start date", "date"], ["netSalary", "Monthly take-home salary (NGN)", "money"], ["salaryDeductions", "Describe deductions and existing salary loans", "textarea"]]],
  ["unity-group", "Group details", "Tell us about your group", [["groupName", "Group ID or name"], ["groupLeader", "Group leader"], ["groupMonths", "Months in the group", "number"], ["groupHistory", "Describe savings participation and repayment history", "textarea"], ["groupGuarantee", "I understand the group guarantee obligation", "checkbox"], ["immediateCover", "I understand immediate missed-payment cover", "checkbox"]]],
  ["evidence", "Supporting documents", "Documents that support your answers", []],
  ["review", "Review", "Review before submitting", []]
];
const answers = Object.create(null);
let session = null;
let draft = null;
let ready = false;
let saving = false;
let saveAgain = false;
let pendingSave = null;
let timer;
const content = document.querySelector("#content");
const status = document.querySelector("#save-status");
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function changeRoute(path) { history.pushState({}, "", path); render(); document.querySelector("#main").focus(); }
function inputField(field) {
  const [key, label, type = "text", options] = field;
  const wrapper = element("div", null, type === "checkbox" ? "check wide" : type === "textarea" ? "field wide" : "field");
  const caption = element("label", label); caption.htmlFor = key;
  const input = document.createElement(type === "textarea" ? "textarea" : type === "select" ? "select" : "input");
  input.id = key; input.name = key; input.autocomplete = "off";
  if (type === "select") for (const choice of ["Choose an option", ...options]) { const option = element("option", choice); option.value = choice === "Choose an option" ? "" : choice; input.append(option); }
  else if (type !== "textarea") { input.type = type === "money" ? "text" : type; if (type === "money") input.inputMode = "decimal"; if (type === "number") { input.min = "0"; input.step = "1"; } }
  if (type === "checkbox") input.checked = answers[key] === true;
  else input.value = answers[key] ?? "";
  input.addEventListener("input", () => {
    answers[key] = type === "checkbox" ? input.checked : input.value;
    status.textContent = "Changes are in memory only until an online save is confirmed.";
    clearTimeout(timer); timer = setTimeout(() => { void save(); }, 1200);
  });
  if (type === "checkbox") wrapper.append(input, caption); else wrapper.append(caption, input);
  return wrapper;
}
async function save() {
  if (!ready || !navigator.onLine) { status.textContent = "Not saved. Secure offline capture is disabled; reconnect before continuing."; return; }
  if (saving) { saveAgain = true; return; }
  if (!answers.memberNumber || !answers.fullNameClaim || !/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(answers.requestedAmount ?? "")) { status.textContent = "Add membership details and a valid requested amount to save your draft."; return; }
  const [whole, fraction = ""] = answers.requestedAmount.split(".");
  const requestedAmountKobo = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))).toString();
  saving = true;
  try {
    if (!pendingSave) pendingSave = JSON.stringify({ id: draft?.id, revision: draft?.revision, answers, memberNumber: answers.memberNumber, fullNameClaim: answers.fullNameClaim, requestedAmountKobo, idempotencyKey: crypto.randomUUID() });
    const sentAnswers = JSON.stringify(JSON.parse(pendingSave).answers);
    const response = await fetch("/api/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: pendingSave });
    const result = await response.json();
    if (!response.ok) {
      if ([400, 401, 403, 409, 413].includes(response.status)) pendingSave = null;
      throw new Error(result.error);
    }
    draft = result; pendingSave = null;
    if (sentAnswers !== JSON.stringify(answers)) saveAgain = true;
    status.textContent = "Draft saved online. Revision " + result.revision + ". Membership, KYC and exposure still require verification; this is not an approval.";
  } catch { status.textContent = "Save not confirmed. Your entries remain in memory only. Reconnect and retry before leaving; membership claims are not verified."; }
  finally { saving = false; if (saveAgain) { saveAgain = false; void save(); } }
}
function render() {
  const navigation = document.querySelector("#steps"); navigation.replaceChildren(); content.replaceChildren();
  const staff = location.pathname === "/credit/staff";
  const current = Math.max(0, screens.findIndex(screen => location.pathname.endsWith("/" + screen[0])));
  for (const [index, screen] of screens.entries()) {
    const link = element("a"); link.href = "/credit/apply/" + screen[0];
    link.append(element("span", String(index + 1).padStart(2, "0"), "number"), document.createTextNode(screen[1]));
    if (index === current && !staff) link.setAttribute("aria-current", "step");
    link.addEventListener("click", event => { event.preventDefault(); changeRoute(link.getAttribute("href")); }); navigation.append(link);
  }
  if (staff) {
    document.querySelector("#title").textContent = "Staff workspace";
    const card = element("div", null, "card");
    card.append(element("h2", "Online draft capture"), element("p", "Minerva is not required for draft capture. Membership, KYC and exposure remain unverified. Appraisal, submission and approval are not enabled."));
    if (ready) {
      const refresh = element("button", "Load my authorized drafts", "secondary");
      const list = element("div");
      refresh.addEventListener("click", async () => {
        refresh.disabled = true; list.replaceChildren();
        try {
          const response = await fetch("/api/drafts", { cache: "no-store" });
          if (!response.ok) throw new Error("DRAFT_LIST_UNAVAILABLE");
          const drafts = await response.json();
          for (const record of drafts) {
            const button = element("button", "Resume " + record.id + " - revision " + record.revision + " - " + record.verification_status, "secondary");
            button.addEventListener("click", () => { void resumeDraft(record.id); });
            list.append(button);
          }
          if (!drafts.length) list.append(element("p", "No drafts in your authorized scope."));
        } catch { list.append(element("p", "Draft list unavailable. Sign in again or retry online.")); }
        finally { refresh.disabled = false; }
      });
      card.append(refresh, list);
    } else card.append(element("p", "Sign in with an approved intake role after the database and authentication configuration are complete."));
    content.append(card); return;
  }
  const screen = screens[current]; document.querySelector("#title").textContent = screen[2];
  const progress = document.createElement("progress"); progress.max = screens.length; progress.value = current + 1; progress.setAttribute("aria-label", "Assessment step " + (current + 1) + " of " + screens.length); content.append(progress);
  const card = element("div", null, "card");
  const fieldset = document.createElement("fieldset"); fieldset.disabled = !ready || !navigator.onLine;
  fieldset.append(element("legend", screen[1])); const grid = element("div", null, "grid");
  for (const field of screen[3]) grid.append(inputField(field)); fieldset.append(grid); card.append(fieldset);
  if (screen[0] === "evidence") card.append(element("p", "Private document storage, malware scanning and the approved document checklist are not connected. Do not upload or send identity documents through this preview.", "help"));
  if (screen[0] === "review") { card.append(element("p", "This is an incomplete intake foundation. Submission, appraisal and approval are deliberately unavailable.")); if (ready) card.append(element("pre", JSON.stringify(answers, null, 2))); }
  card.append(element("p", "Secure online access is required. This browser does not save your answers locally.", "help")); content.append(card);
  const actions = element("div", null, "actions");
  const saveButton = element("button", "Save draft online", "secondary"); saveButton.disabled = !ready || !navigator.onLine; saveButton.addEventListener("click", () => { void save(); }); actions.append(saveButton);
  if (current < screens.length - 1) { const next = element("button", "Continue"); next.addEventListener("click", () => changeRoute("/credit/apply/" + screens[current + 1][0])); actions.append(next); }
  else { const submit = element("button", "Submission not activated"); submit.disabled = true; actions.append(submit); }
  content.append(actions);
}
function connection() { document.querySelector("#connection").textContent = navigator.onLine ? "Online" : "Offline - capture disabled"; render(); }
async function resumeDraft(id) {
  clearTimeout(timer);
  if (saving || pendingSave) { status.textContent = "Confirm the pending save before opening another draft."; return; }
  if (Object.keys(answers).length && !confirm("Replace the current in-memory entries with the saved draft? Unsaved changes will be lost.")) return;
  try {
    const response = await fetch("/api/drafts/" + encodeURIComponent(id), { cache: "no-store" });
    if (!response.ok) throw new Error("DRAFT_UNAVAILABLE");
    const record = await response.json();
    for (const key of Object.keys(answers)) delete answers[key];
    Object.assign(answers, record.answers); draft = record;
    status.textContent = "Saved draft loaded. Verification is still required before formal progression.";
    changeRoute("/credit/apply/start");
  } catch { status.textContent = "Draft unavailable or access denied. Current entries have not changed."; }
}
addEventListener("popstate", render); addEventListener("online", connection); addEventListener("offline", connection);
connection();
try {
  const health = await fetch("/api/health", { cache: "no-store" }).then(response => response.json());
  const response = await fetch("/api/session", { cache: "no-store" });
  if (response.ok) session = await response.json();
  ready = Boolean(session?.canCapture && health.identityConfigured && health.databaseConfigured);
  document.querySelector("#setup").textContent = ready ? "Authenticated draft capture; Minerva is optional. All claims require verification. Final submission and loan decisions remain disabled." : "Implementation preview - authenticated intake permission and database setup are required. Inputs are disabled. Do not use for real applications.";
} catch { document.querySelector("#setup").textContent = "Offline shell only. Secure offline capture is not activated. No personal information is stored in the shell cache."; }
render();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
