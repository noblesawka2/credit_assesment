const status = document.querySelector("#auth-status");
const messages = {
  AUTHENTICATION_FAILED: "Sign-in failed. Check your credentials or contact your administrator.",
  RESET_INVALID_OR_EXPIRED: "The reset request is invalid or expired. Request a new code and use a password of at least 12 characters.",
  RATE_LIMITED: "Too many attempts. Please try again later.",
  AUTH_SERVICE_UNAVAILABLE: "Secure authentication is unavailable. Please try again later."
};
async function send(action, body) {
  if (!navigator.onLine) { status.textContent = "Authentication requires an online connection."; return; }
  try {
    const response = await fetch("/api/auth/" + action, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    const result = await response.json();
    status.textContent = response.ok ? result.message : messages[result.error] ?? "Request failed. Please try again later.";
  } catch { status.textContent = "Connection unavailable. Please try again when online."; }
}
for (const form of document.querySelectorAll("form")) form.addEventListener("submit", async event => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(form));
  for (const input of form.querySelectorAll('input[type="password"], input[name="token"]')) input.value = "";
  const button = form.querySelector("button"); button.disabled = true;
  try { await send(form.id, body); } finally { button.disabled = false; }
});
document.querySelector("#sign-out").addEventListener("click", () => send("sign-out", {}));
fetch("/api/session", { credentials: "same-origin", cache: "no-store" }).then(response => {
  if (response.status === 401) status.textContent = "Sign in to start a session. Expired sessions require a new sign-in.";
}).catch(() => { status.textContent = "Authentication requires an online connection."; });
