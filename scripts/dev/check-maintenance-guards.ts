#!/usr/bin/env tsx
/**
 * Check Maintenance Guards On Outbound Vendor Calls
 *
 * Maintenance mode locks the database, but a write lock cannot undo an SMS,
 * an email, a physical letter, or a metered Google geocode. So while
 * `system_mode` is "maintenance", every server-side call to Twilio, SendGrid,
 * Lob and Google is refused by one shared guard —
 * `assertExternalServiceAllowed()` in `server/services/maintenance-flag.ts` —
 * before the network call and before any credential is read.
 *
 * That kind of guard is only as good as its coverage, and the way it breaks is
 * always the same: somebody adds a method to a vendor wrapper, or a fifth
 * vendor wrapper next to the four, and simply does not call it. Nothing fails;
 * the bypass is invisible until maintenance is on and a letter goes out.
 *
 * So this check enforces both halves:
 *
 *   1. NO UNGUARDED OPERATION. In each of the vendor modules below, any
 *      function that makes an outbound call (`fetch(…)`, `sgMail.send(…)`,
 *      `getTwilioClient()`) must have `assertExternalServiceAllowed(…)` as a
 *      statement of its own body — or of an enclosing function's body. It must
 *      be a plain statement, not buried in a branch or a nested closure,
 *      because the guard is meant to run first, ahead of the credential read
 *      and outside the method's own try/catch.
 *
 *   2. NO UNLISTED VENDOR MODULE. No server file outside that list may name a
 *      Twilio/SendGrid/Lob/Google endpoint or import a vendor SDK. A new
 *      wrapper therefore fails this check on its first line, and the fix is to
 *      add it to GUARDED_MODULES — which immediately subjects it to rule 1.
 *
 * Deliberately NOT covered, matching the task's scope: browser-side Google
 * Maps in `client/` (the browser calls Google directly and cannot be gated
 * server-side), standalone `scripts/` (they never arm the flag, exactly like
 * the database write lock), and the non-vendor external calls that live in
 * these same files (OpenStates, the US Census, the Replit connector
 * credential endpoint) — those are named in UNGUARDED_FUNCTIONS with a reason.
 *
 * Like scripts/dev/check-env-registry.ts, this scans the CURRENT working tree
 * — tracked AND untracked files — so a brand-new vendor module cannot dodge
 * the check before its first commit.
 *
 * Run with:  npx tsx scripts/dev/check-maintenance-guards.ts
 *
 * Exits 0 on pass, 1 on violations.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";

/** The one guard every outbound vendor operation must call. */
const GUARD_FN = "assertExternalServiceAllowed";

/** Where the guard lives; the module itself is not a vendor wrapper. */
const GUARD_MODULE = "server/services/maintenance-flag.ts";

/**
 * The vendor wrappers. Every outbound call to Twilio, SendGrid, Lob or Google
 * is made from one of these files, and each one is subject to rule 1.
 */
const GUARDED_MODULES = [
  "server/lib/twilio-client.ts",
  "server/services/comm/providers/sms/twilio.ts",
  "server/services/comm/providers/email/sendgrid.ts",
  "server/services/comm/providers/postal/lob.ts",
  "server/services/comm/validators/address.ts",
  "server/services/google-civics.ts",
];

/**
 * Functions inside a guarded module that make an outbound call which is NOT a
 * Twilio/SendGrid/Lob/Google call, and so is intentionally left alone.
 *
 * Per-function rather than per-file on purpose: exempting a whole file would
 * silently cover the next vendor method somebody adds to it.
 */
const UNGUARDED_FUNCTIONS: Record<string, Record<string, string>> = {
  "server/lib/twilio-client.ts": {
    getCredentialsFromConnector:
      "Reads Twilio credentials from the Replit connector endpoint, not from Twilio. " +
      "getTwilioClient() — the only caller path — is guarded, so this never runs during maintenance.",
  },
  "server/services/google-civics.ts": {
    callOpenStates:
      "OpenStates, not Google. Non-vendor external calls are out of this guard's scope.",
  },
};

/**
 * How an outbound vendor call is recognized. `fetch` covers Lob and Google;
 * `getTwilioClient` is the single door to Twilio (and is itself guarded);
 * `sgMail.send` is SendGrid's.
 */
const OUTBOUND_CALLS = ["fetch", "getTwilioClient", "sgMail.send"];

/**
 * How an unlisted vendor module is recognized: a vendor endpoint, or a vendor
 * SDK import.
 */
const VENDOR_MARKERS: { pattern: RegExp; what: string }[] = [
  { pattern: /https?:\/\/[\w.-]*\bgoogleapis\.com/, what: "a Google API endpoint" },
  { pattern: /https?:\/\/[\w.-]*\blob\.com/, what: "a Lob API endpoint" },
  { pattern: /https?:\/\/[\w.-]*\btwilio\.com/, what: "a Twilio API endpoint" },
  { pattern: /https?:\/\/[\w.-]*\bsendgrid\.(com|net)/, what: "a SendGrid API endpoint" },
  { pattern: /from\s+['"]@sendgrid\//, what: "the SendGrid SDK" },
  { pattern: /from\s+['"]twilio['"]/, what: "the Twilio SDK" },
];

/**
 * Files that name a vendor without making a vendor call, with the reason.
 */
const VENDOR_MARKER_EXEMPT: Record<string, string> = {
  "server/services/comm/callback-handlers/twilio.ts":
    "Imports the Twilio SDK only for twilio.validateRequest(), an offline signature " +
    "check over an INBOUND webhook. It sends nothing and reaches no network.",
};

/** Only server code is gated; see the header for why client/ and scripts/ are not. */
const SCANNED_PREFIXES = ["server/", "shared/"];
const SCANNED_EXTENSIONS = [".ts", ".tsx"];

interface Violation {
  file: string;
  line: number;
  detail: string;
  remedy: string;
}

function listWorkingTreeFiles(): string[] {
  const tracked = execSync("git ls-files", { encoding: "utf8" });
  const untracked = execSync("git ls-files --others --exclude-standard", {
    encoding: "utf8",
  });
  return Array.from(
    new Set(
      (tracked + "\n" + untracked)
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

function isScanned(file: string): boolean {
  if (!SCANNED_PREFIXES.some((p) => file.startsWith(p))) return false;
  return SCANNED_EXTENSIONS.some((e) => file.endsWith(e));
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

type FunctionLike =
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration;

function isFunctionLike(node: ts.Node): node is FunctionLike {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessor(node)
  );
}

/** A readable name for the reported function, walking out to a variable name. */
function nameOf(fn: FunctionLike, sf: ts.SourceFile): string {
  if ("name" in fn && fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
  const parent = fn.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (parent && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  return `anonymous function at line ${lineOf(sf, fn)}`;
}

/** Dotted text of a call's callee: `fetch`, `sgMail.send`, `this.getApiKey`. */
function calleeText(call: ts.CallExpression, sf: ts.SourceFile): string {
  return call.expression.getText(sf);
}

/**
 * True when the guard is a plain statement of this function's own body — not
 * inside an `if`, a `try`, or a nested closure. That placement is the point:
 * the guard runs before the credential read and outside the try/catch that
 * would otherwise turn a refusal into an empty list or a failed-send result.
 */
function hasGuardStatement(fn: FunctionLike, sf: ts.SourceFile): boolean {
  const body = fn.body;
  if (!body || !ts.isBlock(body)) return false;
  return body.statements.some(
    (stmt) =>
      ts.isExpressionStatement(stmt) &&
      ts.isCallExpression(stmt.expression) &&
      calleeText(stmt.expression, sf) === GUARD_FN,
  );
}

/** Rule 1: every outbound call in a guarded module sits under the guard. */
function auditGuardedModule(file: string): Violation[] {
  const sf = parse(file);
  const exemptions = UNGUARDED_FUNCTIONS[file] ?? {};
  const violations: Violation[] = [];
  const stack: FunctionLike[] = [];

  const visit = (node: ts.Node): void => {
    const pushed = isFunctionLike(node);
    if (pushed) stack.push(node);

    if (ts.isCallExpression(node) && OUTBOUND_CALLS.includes(calleeText(node, sf))) {
      const enclosing = stack[stack.length - 1];
      const owner = enclosing ? nameOf(enclosing, sf) : "(module top level)";
      const exemptReason = stack
        .map((fn) => exemptions[nameOf(fn, sf)])
        .find(Boolean);

      if (!exemptReason && !stack.some((fn) => hasGuardStatement(fn, sf))) {
        violations.push({
          file,
          line: lineOf(sf, node),
          detail: `${owner}() makes an outbound call (${calleeText(node, sf)}) with no maintenance guard`,
          remedy:
            `Add \`${GUARD_FN}("<Twilio|SendGrid|Lob|Google>", "<what it does>");\` as the ` +
            `first statement of ${owner}(), ahead of credential resolution and outside any try/catch.`,
        });
      }
    }

    ts.forEachChild(node, visit);
    if (pushed) stack.pop();
  };

  visit(sf);
  return violations;
}

/** Rule 2: nothing outside GUARDED_MODULES talks to one of these vendors. */
function auditUnlistedVendorModules(files: string[]): Violation[] {
  const violations: Violation[] = [];
  const known = new Set([...GUARDED_MODULES, GUARD_MODULE]);

  for (const file of files) {
    if (known.has(file) || VENDOR_MARKER_EXEMPT[file]) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    for (const marker of VENDOR_MARKERS) {
      const index = lines.findIndex((l) => marker.pattern.test(l));
      if (index === -1) continue;
      violations.push({
        file,
        line: index + 1,
        detail: `references ${marker.what} but is not a guarded vendor module`,
        remedy:
          `Add "${file}" to GUARDED_MODULES in scripts/dev/check-maintenance-guards.ts and guard ` +
          `each outbound operation with ${GUARD_FN}(). If it names the vendor without calling it, ` +
          `add it to VENDOR_MARKER_EXEMPT with the reason.`,
      });
    }
  }
  return violations;
}

/** Rule 0: the list itself has to be real, or the whole check quietly passes. */
function auditModuleList(files: Set<string>): Violation[] {
  return GUARDED_MODULES.filter((m) => !files.has(m)).map((m) => ({
    file: "scripts/dev/check-maintenance-guards.ts",
    line: 1,
    detail: `GUARDED_MODULES names "${m}", which no longer exists`,
    remedy: "Remove or rename the entry so the list keeps describing the real vendor wrappers.",
  }));
}

export function findViolations(): Violation[] {
  const all = listWorkingTreeFiles();
  const present = new Set(all);
  const scanned = all.filter(isScanned);

  const violations = auditModuleList(present);
  for (const module of GUARDED_MODULES) {
    if (present.has(module)) violations.push(...auditGuardedModule(module));
  }
  violations.push(...auditUnlistedVendorModules(scanned));
  return violations;
}

function main(): void {
  const violations = findViolations();

  if (violations.length === 0) {
    console.log(
      `[check-maintenance-guards] OK — every outbound call in ${GUARDED_MODULES.length} vendor ` +
        `module(s) runs under ${GUARD_FN}(), and no other server file talks to Twilio, SendGrid, Lob or Google.`,
    );
    process.exit(0);
  }

  console.error(
    [
      "",
      "[check-maintenance-guards] FAILED",
      "",
      "An outbound vendor call can bypass maintenance mode.",
      "",
      "Maintenance mode makes the database read-only, but an SMS, an email, a",
      "letter or a metered geocode cannot be rolled back when maintenance ends.",
      `Every call to Twilio, SendGrid, Lob and Google must go through ${GUARD_FN}()`,
      `from ${GUARD_MODULE}.`,
      "",
      ...violations.map((v) => `  ${v.file}:${v.line}  ${v.detail}\n      → ${v.remedy}`),
      "",
    ].join("\n"),
  );
  process.exit(1);
}

// Only run when executed directly (tests may import findViolations).
if (process.argv[1] && /check-maintenance-guards\.ts$/.test(process.argv[1])) {
  main();
}
