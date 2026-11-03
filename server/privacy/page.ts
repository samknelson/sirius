import { maskModeHelp } from "../help/system/mask-mode";

/** No stored branding, names, query strings, scripts or settings enter this document. */
export const maskModePage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Strict Mask Mode</title>
<style>
:root{font:16px/1.6 system-ui,sans-serif;color:#162b3d;background:#f4f6f8}
body{margin:0}header{background:#162b3d;color:white;padding:20px 5%}
main{max-width:960px;margin:32px auto;padding:0 20px}
section,details{background:white;border:1px solid #c9d2da;border-radius:8px;padding:24px;margin:20px 0}
h1{font-size:1.5rem;margin:0}h2{font-size:1.2rem}button,a{font:inherit}
button{padding:10px 16px;border:1px solid #455f73;border-radius:5px;background:#183f59;color:white;cursor:pointer;margin:4px}
button:disabled{opacity:.5;cursor:not-allowed}a{color:#134e78}
.warning{border-left:5px solid #996600;padding:16px;background:#fff7df}
table{border-collapse:collapse;width:100%}th,td{text-align:left;border-bottom:1px solid #d3dae0;padding:10px}
label{display:block;margin:16px 0}#veil{position:fixed;inset:0;background:#f4f6f8;z-index:99999;display:grid;place-content:center}
[hidden]{display:none!important}summary{cursor:pointer;font-weight:bold}#status{font-weight:bold}
@media print{button,#acknowledgment{display:none}header{color:black;background:white;border:2px solid black}}
</style></head><body>
<div id="veil" role="status">Checking protection. Do not record yet.</div>
<header><h1>Strict Mask Mode</h1><div id="status" role="status" aria-live="polite">Checking session</div></header>
<main>
<p class="warning"><strong>Not a HIPAA certification or approval to publish.</strong>
The normal application is unavailable while protected. Your privacy lead must review
the output and the complete recording workflow. Never speak real identities during recording.</p>
<section><h2>Session protection</h2>
<p id="explanation">Waiting for authoritative session state.</p>
<label id="acknowledgment"><input type="checkbox" id="ack">
I have stopped recording, closed previous tabs and reviewed the recording guidance.</label>
<button id="enable" disabled>Enable strict Mask Mode</button>
<button id="disable" disabled>Turn Mask Mode OFF</button>
<button id="logout">Sign out</button>
<a id="signin" href="/api/login" hidden>Sign in outside the recording</a>
<p id="error" role="alert"></p></section>
<section><h2>Read-only training sample</h2>
<p>Names, source IDs and their fragments are withheld. Only reviewed year-level
birth information is available. Coverage months and all other original screens are blocked.</p>
<button id="load" disabled>Load protected sample</button>
<p id="empty">No live data loaded.</p>
<table id="records" hidden><thead><tr><th>Training label</th><th>Birth information</th>
<th>Identity and other details</th></tr></thead><tbody id="rows"></tbody></table></section>
<details id="help"><summary>Mask Mode guidance</summary><p>${maskModeHelp.summary}</p>${maskModeHelp.details}</details>
</main><script src="/mask-mode/client.js" defer></script></body></html>`;

/** A standalone, code-owned client: no normal app, third-party SDK or raw cache. */
export const maskModeScript = `"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("sirius-mask-mode") : null;
  let state = null, busy = false, generation = 0;
  const cover = () => {
    generation++;
    $("veil").hidden = false;
    $("rows").replaceChildren();
    $("records").hidden = true;
    $("empty").hidden = false;
    $("empty").textContent = "No live data loaded.";
    document.title = "Strict Mask Mode";
  };
  const controls = () => {
    $("enable").disabled = busy || !state?.canToggle || state?.mode === "on";
    $("disable").disabled = busy || !state?.canToggle || state?.mode === "off";
    $("load").disabled = busy || state?.mode !== "on" || !state?.canRead;
  };
  const request = async (path, options = {}) => {
    const response = await fetch(path, {credentials:"same-origin", cache:"no-store",
      ...options, headers:{"Content-Type":"application/json", "X-Mask-Revision":String(state?.revision ?? 0), ...options.headers}});
    const result = await response.json();
    if (!response.ok) throw new Error("Request refused. Protection remains in place. Recheck the session before continuing.");
    return result;
  };
  const bootstrap = async () => {
    const token = ++generation;
    busy = true; controls();
    try {
      const next = await request("/api/mask-mode/state");
      if (token !== generation) return;
      state = next;
      $("status").textContent = state.mode === "on" ? "MASK MODE ON — restricted read-only view"
        : state.mode === "off" ? "MASK MODE OFF — do not record live data"
        : state.mode === "anonymous" ? "Signed out" : "Protection state unknown — normal content blocked";
      $("explanation").textContent = state.canToggle
        ? "Only this login session is affected. No stored records are changed. Entering or leaving discards unsaved browser work."
        : "An active original presenter with admin permission is required to toggle. Unknown state does not allow normal content.";
      $("signin").hidden = state.mode !== "anonymous";
      $("veil").hidden = true;
      $("error").textContent = "";
    } catch {
      state = null;
      $("veil").textContent = "Protection could not be confirmed. Do not record. Reload to retry or close this tab.";
    } finally { busy = false; controls(); }
  };
  const transition = async mode => {
    if (!$("ack").checked) { $("error").textContent = "Confirm the fresh-tab and recording guidance first."; return; }
    if (!confirm(mode === "off" ? "Stop recording. Turn protection OFF and open normal live data?"
      : "Enable strict protection? Unsaved work will not be saved. Close all previous tabs.")) return;
    cover(); busy = true; controls();
    try {
      await request("/api/mask-mode/state", {method:"POST", body:JSON.stringify({mode, revision:state?.revision, acknowledged:true})});
      channel?.postMessage({type:"changed"});
      location.replace(mode === "off" ? "/" : "/mask-mode");
    } catch {
      await bootstrap();
      $("error").textContent = "Transition was not acknowledged. The server state above is authoritative; do not record until it is checked.";
    }
  };
  $("enable").onclick = () => transition("on");
  $("disable").onclick = () => transition("off");
  $("logout").onclick = async () => {
    if (!confirm("Sign out of this login session?")) return;
    cover();
    try {
      await request("/api/mask-mode/logout", {method:"POST", body:"{}"});
      channel?.postMessage({type:"changed"});
      location.replace("/mask-mode");
    } catch { await bootstrap(); }
  };
  $("load").onclick = async () => {
    const token = ++generation;
    busy = true; controls();
    try {
      const result = await request("/api/mask-mode/people");
      if (token !== generation || result.revision !== state?.revision) return;
      $("rows").replaceChildren();
      for (const [index, person] of result.people.entries()) {
        const tr = document.createElement("tr");
        for (const text of ["Training person " + (index + 1),
          person.ageGroup || person.birthYear || "Withheld", "Withheld"]) {
          const td = document.createElement("td"); td.textContent = text; tr.append(td);
        }
        $("rows").append(tr);
      }
      $("records").hidden = !result.people.length;
      $("empty").hidden = !!result.people.length;
      $("empty").textContent = "No records available in this sample.";
    } catch { $("error").textContent = "Sample unavailable or refused. No normal record data is available here."; }
    finally { busy = false; controls(); }
  };
  channel?.addEventListener("message", () => { cover(); bootstrap(); });
  window.addEventListener("pageshow", event => { if (event.persisted) { cover(); bootstrap(); } });
  document.addEventListener("visibilitychange", () => {
    cover();
    if (document.visibilityState === "visible") bootstrap();
  });
  window.addEventListener("focus", () => { if (!busy) { cover(); bootstrap(); } });
  // Broadcasts are a convenience, never authority; poll even if another
  // process/browser changes this SID without emitting one.
  setInterval(async () => {
    if (busy || document.visibilityState !== "visible") return;
    try {
      const next = await request("/api/mask-mode/state");
      if (!state || next.revision !== state.revision || next.mode !== state.mode ||
          next.canRead !== state.canRead || next.canToggle !== state.canToggle) {
        cover(); await bootstrap();
      }
    } catch { cover(); await bootstrap(); }
  }, 5000);
  bootstrap();
})();`;
