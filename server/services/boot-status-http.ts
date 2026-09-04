/**
 * Boot-status HTTP surface (Task #1349).
 *
 * The ONE place that turns this process's boot state into an HTTP answer,
 * used identically by both entry points (`server/production-entry.ts` and
 * `server/index.ts`) so a boot problem cannot present differently in
 * development and in a deployment.
 *
 * WHY IT EXISTS.
 *
 * 1. A not-ready process used to answer every non-root request with
 *    `503 {"message":"Application is starting, please wait..."}` — the same
 *    body whether the boot was still running, had permanently failed, or had
 *    been stopped on purpose by BRINGUP_REPORT_ONLY=1. Two of those three are
 *    a lie: they tell an operator to wait for something that will never
 *    happen. Every not-ready answer now names its actual phase and carries
 *    the boot identity, the blocker, and the drift result.
 *
 * 2. In the deployed topology ONE image runs as TWO ECS services behind a
 *    single ALB: `/*` reaches the UI service and `/api/*` reaches the API
 *    service. A status endpoint registered only at a root path is therefore
 *    unreachable for the API service, and the ALB additionally shadows the
 *    root health path with its own fixed response — so the API service's
 *    phase, blocker and drift result could not be read from a browser at
 *    all. {@link BOOT_STATUS_PATHS} answers under BOTH prefixes and adds a
 *    `/boot-status` spelling that no load-balancer health rule occupies.
 *
 * PURE-ISH LEAF: imports only other leaf modules (boot status, boot
 * identity, bring-up report, the env registry, and the standalone HTML
 * escape helper — NOT the html barrel, which reaches jsdom). It is imported
 * and its routes are registered BEFORE app-init loads, because "before
 * bootstrap finishes" is the only moment this surface matters.
 *
 * EXPOSURE: error text, stack, and the bring-up report appear only when
 * EXPOSE_BOOT_ERRORS=1 — the same control that has always governed the
 * init-failure page. Without it every surface still names the phase and the
 * blocker, which is safe to show anywhere.
 */
import type { Express, Request, Response } from "express";
import { bootStatus, type BootPhase } from "./boot-status";
import { getBootIdentity } from "./boot-identity";
import { formatBringUpReport } from "./bringup-report";
import { getEnvironmentVariable } from "../config/env-registry";
// Leaf import on purpose: the shared HTML barrel reaches DOMPurify (jsdom
// under Node) and this module runs before the application exists.
import { escapeHtml } from "../../shared/utils/html/escape";

/**
 * Every address the boot status answers on.
 *
 * `/health` is the long-standing one (container HEALTHCHECK, the admin
 * Restart page's poll, load-balancer target checks). The other three exist
 * for the two-service-behind-one-ALB deployment:
 *
 *   - `/api/health` + `/api/boot-status` are the only prefix that routes to
 *     the API service, so they are the only way to read ITS boot state.
 *   - `/boot-status` + `/api/boot-status` are a spelling no load-balancer
 *     health rule occupies, so a fixed-response rule on `/health` cannot
 *     shadow them.
 *
 * All four are registered before app-init and answer in every phase.
 */
export const BOOT_STATUS_PATHS = [
  "/health",
  "/boot-status",
  "/api/health",
  "/api/boot-status",
] as const;

const PHASE_TITLE: Record<BootPhase, string> = {
  starting: "Application is starting",
  ready: "Application is ready",
  "init-failed": "Application initialization FAILED",
  "report-only": "Report-only boot — application not started",
};

/**
 * The sentence an operator reads. Each one says whether waiting is going to
 * change anything, because that is the question the old single message got
 * wrong.
 */
const PHASE_MESSAGE: Record<BootPhase, string> = {
  starting:
    "Initialization is still running. This state can change on its own — retry shortly.",
  ready: "Initialization finished; the application is serving requests.",
  "init-failed":
    "Initialization failed and this process will NOT recover. Waiting will not help; " +
    "the deployment needs a fix and a redeploy.",
  "report-only":
    "The boot stopped on purpose because BRINGUP_REPORT_ONLY=1 is set. Nothing was " +
    "written and the application was never started. Waiting will not help; remove the " +
    "variable and redeploy to boot normally.",
};

function exposeBootErrors(): boolean {
  return getEnvironmentVariable("EXPOSE_BOOT_ERRORS") === "1";
}

export interface BootStatusPayload {
  status: BootPhase;
  message: string;
  blockedOn: string;
  driftCheck: string;
  bootId: string;
  startedAt: string;
  /** The address that answered — names WHICH service this is behind an ALB. */
  path?: string;
  details: "exposed" | "withheld";
  error?: string;
  stack?: string;
  bringUpReport?: string;
}

/**
 * The one JSON body every boot-status answer uses — status address, root
 * placeholder, and not-ready 503 alike.
 *
 * `bootId` / `startedAt` are what let two rolled tasks be told apart: the
 * same URL answered by a new process reports a different identity.
 */
export function bootStatusPayload(path?: string): BootStatusPayload {
  const { bootId, startedAt } = getBootIdentity();
  const exposed = exposeBootErrors();
  const payload: BootStatusPayload = {
    status: bootStatus.phase,
    message: PHASE_MESSAGE[bootStatus.phase],
    blockedOn: bootStatus.blockedOn,
    driftCheck: bootStatus.driftCheck,
    bootId,
    startedAt,
    ...(path ? { path } : {}),
    details: exposed ? "exposed" : "withheld",
  };

  if (!exposed) {
    if (bootStatus.initError) {
      payload.message +=
        " Details are in the server logs (set EXPOSE_BOOT_ERRORS=1 to read them here).";
    }
    return payload;
  }

  if (bootStatus.initError) {
    payload.error = bootStatus.initError.message;
    payload.stack = bootStatus.initError.stack;
  }
  // The whole point of the bring-up report is that the operator may not be
  // able to reach the deploy log. Same exposure control as the error details.
  payload.bringUpReport = formatBringUpReport();
  return payload;
}

/**
 * The same answer as a page, for an operator with only a browser.
 *
 * Only the "starting" phase auto-refreshes: a failed or report-only boot is
 * terminal, and re-fetching it forever just hides that fact.
 */
export function renderBootStatusPage(path?: string): string {
  const p = bootStatusPayload(path);
  const failed = p.status === "init-failed";
  const rows: Array<[string, string]> = [
    ["state", p.status],
    ["blocked on", p.blockedOn],
    ["drift check", p.driftCheck],
    ["boot id", p.bootId],
    ["started at", p.startedAt],
  ];
  if (p.path) rows.push(["answered at", p.path]);

  const detail = exposeBootErrors()
    ? `${
        p.error
          ? `<h2>Error</h2><p><strong>${escapeHtml(p.error)}</strong></p>` +
            `<pre>${escapeHtml(p.stack || "(no stack)")}</pre>`
          : ""
      }<h2>Schema bring-up report</h2><pre>${escapeHtml(p.bringUpReport || "")}</pre>`
    : `<p><small>Error text, stack and the bring-up report are withheld here. Set
         EXPOSE_BOOT_ERRORS=1 (non-production only) to show them.</small></p>`;

  return `<!DOCTYPE html>
<html>
  <head>
    <title>${escapeHtml(PHASE_TITLE[p.status])}</title>
    ${p.status === "starting" ? '<meta http-equiv="refresh" content="2">' : ""}
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; background: #fff; color: #111; }
      h1 { color: ${failed ? "#b00020" : "#111"}; }
      table { border-collapse: collapse; margin: 1rem 0; }
      th, td { text-align: left; padding: 0.25rem 1rem 0.25rem 0; vertical-align: top; }
      th { color: #555; font-weight: 500; }
      code, pre { font-family: ui-monospace, monospace; }
      pre { background: #f5f5f5; padding: 1rem; border-radius: 6px; overflow: auto; white-space: pre-wrap; word-break: break-word; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(PHASE_TITLE[p.status])}</h1>
    <p>${escapeHtml(p.message)}</p>
    <table>
      ${rows
        .map(
          ([k, v]) =>
            `<tr><th>${escapeHtml(k)}</th><td><code>${escapeHtml(v)}</code></td></tr>`,
        )
        .join("\n      ")}
    </table>
    ${detail}
    <p><small>Status addresses: ${BOOT_STATUS_PATHS.map(
      (a) => `<code>${escapeHtml(a)}</code>`,
    ).join(", ")} — the <code>/api/…</code> spellings answer from the API service.</small></p>
  </body>
</html>`;
}

function wantsHtml(req: Request): boolean {
  return (req.headers.accept || "").includes("text/html");
}

/** Answer with the boot status, as a page for a browser and JSON otherwise. */
export function sendBootStatus(req: Request, res: Response, statusCode: number): void {
  // Path only, never the query string: this field exists to name WHICH
  // address (and therefore which service) answered, not to echo the request.
  const path = (req.originalUrl || req.path).split("?")[0];
  if (wantsHtml(req)) {
    res
      .status(statusCode)
      .set({ "Content-Type": "text/html" })
      .send(renderBootStatusPage(path));
    return;
  }
  res.status(statusCode).json(bootStatusPayload(path));
}

/**
 * Register the boot-status addresses. Call this FIRST in an entry point,
 * before any initialization: these have to answer while the boot is still
 * running (or has already failed), which is the only time they matter, and
 * registering them first also keeps a later application route from taking
 * one of the paths.
 *
 * They always answer HTTP 200 — deliberately, and unchanged from the old
 * `/health` contract: the deployment must stabilize and keep the failure
 * observable instead of cycling the task. The body carries the truth.
 */
export function registerBootStatusRoutes(app: Express): void {
  for (const path of BOOT_STATUS_PATHS) {
    app.get(path, (req, res) => sendBootStatus(req, res, 200));
  }
}

/**
 * The gate every other request passes through while the process is not
 * ready. Registered before app-init in both entry points; once the phase is
 * "ready" it steps aside for the real application.
 *
 * The root path keeps answering 200 (it is a load-balancer/browser landing
 * spot and has always done so); every other path answers 503, which is
 * honest about the request not having been served — but with a body that
 * names the actual phase instead of always claiming to be starting.
 */
export function bootStatusGate(req: Request, res: Response, next: () => void): void {
  if (bootStatus.phase === "ready") {
    next();
    return;
  }
  sendBootStatus(req, res, req.path === "/" ? 200 : 503);
}
