const checks = ["MEMBERSHIP", "KYC", "SAVINGS", "EXPOSURE", "DUPLICATES"];
const status = document.querySelector("#verification-status");
const list = document.querySelector("#case-list");
const detail = document.querySelector("#case-detail");
const load = document.querySelector("#load-cases");
let allowed = false;
let pending = null;
let saving = false;
let selected = null;
let epoch = 0;
let sessionUser = null;
let opening = false;
function node(tag, text) { const element = document.createElement(tag); if (text) element.textContent = text; return element; }
function clear() {
  epoch++; sessionUser = null;
  allowed = false; pending = null; selected = null; load.disabled = true;
  list.replaceChildren(); detail.replaceChildren();
}
async function request(path, options = {}) {
  const startedEpoch = epoch;
  const response = await fetch(path, { cache: "no-store", signal: AbortSignal.timeout(15000), ...options });
  if (startedEpoch !== epoch) throw new Error("Session changed. Reload after signing in.");
  if (!response.ok) {
    if ([401, 403].includes(response.status)) clear();
    const failure = new Error(response.status === 409 ? "The case changed. Reload it and review the latest revision." : "Request rejected or service unavailable. Check access and try again.");
    failure.status = response.status; throw failure;
  }
  const result = await response.json();
  if (startedEpoch !== epoch) throw new Error("Session changed. Reload after signing in.");
  return result;
}
async function session() {
  try {
    const current = await request("/api/session");
    if (!current.canVerify) { clear(); status.textContent = "An active authorized credit-officer session is required."; return; }
    if (sessionUser !== current.userId) { clear(); sessionUser = current.userId; }
    allowed = true; load.disabled = !navigator.onLine;
    if (!selected) status.textContent = "Online verification only. Only assigned cases are accessible.";
  } catch { clear(); status.textContent = "Session unavailable. Sign in again. Sensitive content has been cleared."; }
}
function field(parent, name, label, type = "text", maximum = 2000) {
  const wrapper = node("div"); wrapper.className = "field";
  const caption = node("label", label); caption.htmlFor = name;
  const input = node(type === "textarea" ? "textarea" : type === "select" ? "select" : "input");
  input.name = name; input.id = name; input.required = true;
  if (type === "select") for (const value of ["UNRESOLVED", "CONCERN", "CONFIRMED"]) { const option = node("option", value); option.value = value; input.append(option); }
  else if (type !== "textarea") input.type = type;
  input.maxLength = maximum; input.autocomplete = "off";
  wrapper.append(caption, input); parent.append(wrapper); return input;
}
async function openCase(id) {
  if (!allowed || opening || !navigator.onLine) return;
  if (saving || pending) { status.textContent = "Resolve the pending save before opening another case."; return; }
  if (selected && !confirm("Open another case and discard unsaved form entries?")) return;
  opening = true;
  try {
    const record = await request("/api/verifications/" + encodeURIComponent(id));
    selected = record; detail.replaceChildren();
    const card = node("div"); card.className = "card";
    card.append(node("h2", "Case " + id + " · revision " + record.revision), node("h3", "Original answers (read-only)"), node("pre", JSON.stringify(record.answers, null, 2)));
    for (const revision of record.verifications) {
      const history = node("details"); history.append(node("summary", "Verification " + revision.caseRevision + (revision.current ? " · current revision/unexpired" : " · superseded or expired")), node("pre", JSON.stringify(revision.evidence, null, 2))); card.append(history);
    }
    if (!["DRAFT", "DESK_REVIEW", "FIELD_VERIFICATION_PENDING", "RETURNED_TO_CREDIT_OFFICER"].includes(record.status)) { card.append(node("p", "New verification is prohibited at this stage.")); detail.append(card); return; }
    const form = node("form"); const fields = node("fieldset"); const grid = node("div"); grid.className = "grid";
    fields.append(node("legend", "New immutable verification revision"), grid); form.append(fields);
    for (const check of checks) {
      const group = node("fieldset"); group.className = "card"; group.append(node("legend", check)); grid.append(group);
      field(group, check + "-outcome", "Finding", "select");
      field(group, check + "-source", "Approved source / register", "text", 200);
      field(group, check + "-evidenceReference", "Evidence record reference (not credentials)", "text", 300);
      field(group, check + "-observedAt", "Observed at (device local time)", "datetime-local");
      field(group, check + "-expiresAt", "Evidence valid until (device local time)", "datetime-local");
      field(group, check + "-note", "Finding and evidence notes", "textarea").minLength = 8;
    }
    field(fields, "reason", "Reason for this verification revision", "textarea").minLength = 8;
    const actions = node("div"); actions.className = "actions"; const save = node("button", "Record findings online"); save.type = "submit"; actions.append(save); fields.append(actions);
    form.addEventListener("submit", async event => {
      event.preventDefault(); if (!allowed || saving || !navigator.onLine) return;
      try {
      if (!pending) {
        const values = new FormData(form);
        pending = JSON.stringify({ expectedRevision: record.revision, idempotencyKey: crypto.randomUUID(), reason: values.get("reason"), findings: checks.map(check => ({ check,
          outcome: values.get(check + "-outcome"), source: values.get(check + "-source"), evidenceReference: values.get(check + "-evidenceReference"), note: values.get(check + "-note"),
          observedAt: new Date(values.get(check + "-observedAt")).toISOString(), expiresAt: new Date(values.get(check + "-expiresAt")).toISOString() })) });
      }
      } catch { status.textContent = "Enter valid observation and expiry dates for every finding."; return; }
      saving = true; fields.disabled = true;
      try {
        const receipt = await request("/api/verifications/" + encodeURIComponent(id), { method: "POST", headers: { "Content-Type": "application/json" }, body: pending });
        pending = null; selected = null; detail.replaceChildren();
        status.textContent = "Findings recorded at revision " + receipt.revision + ". This is not loan approval. Reload the case before further changes.";
      } catch (error) {
        if ([400, 401, 403, 404, 409, 413].includes(error.status)) pending = null;
        status.textContent = error.message + (pending ? " Save not confirmed: retry sends the same pending revision." : " No success confirmed.");
      } finally { saving = false; fields.disabled = !allowed || !navigator.onLine; }
    });
    card.append(form); detail.append(card);
    status.textContent = "Record all five checks. Unresolved or adverse findings must not be marked confirmed.";
  } catch (error) { status.textContent = error.message; }
  finally { opening = false; }
}
load.addEventListener("click", async () => {
  load.disabled = true;
  try {
    const records = await request("/api/verifications"); list.replaceChildren();
    for (const record of records) { const action = node("button", record.id + " · " + record.status); action.addEventListener("click", () => { void openCase(record.id); }); const row = node("div"); row.className = "actions"; row.append(action); list.append(row); }
    if (!records.length) list.append(node("p", "No assigned cases. Assignment authority must be provisioned; no self-assignment is available."));
  } catch (error) { status.textContent = error.message; }
  finally { load.disabled = !allowed || !navigator.onLine; }
});
addEventListener("offline", () => { clear(); status.textContent = "Offline verification is prohibited. Unsaved entries have been cleared."; });
addEventListener("online", () => { void session(); });
setInterval(() => { void session(); }, 60000);
await session();
