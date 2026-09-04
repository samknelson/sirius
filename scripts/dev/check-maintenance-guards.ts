#!/usr/bin/env tsx
/**
 * Check Outbound Calls Go Through The Web Client Framework
 *
 * Maintenance mode locks the database, but a write lock cannot undo an SMS, an
 * email, a physical letter, or a metered geocode. The refusal that stops those
 * — along with the failure hold, the writable-database requirement and the
 * single audit trail — lives in the web client framework
 * (`server/services/webclient`), which every outbound call is required to go
 * through: `wcRequest()` for a cacheable answer, `wcUncachedRequest()` for one
 * that must never be replayed, such as a send.
 *
 * That framework is only as good as its coverage, and the way it breaks is
 * always the same: somebody adds a method to a vendor wrapper, or a new
 * wrapper next to the existing ones, and simply calls out directly. Nothing
 * fails; the bypass is invisible until maintenance is on and a letter goes
 * out.
 *
 * So this check enforces both halves:
 *
 *   1. NO OFF-FRAMEWORK CALL. In each of the modules below, an outbound call
 *      (`fetch(…)`, `sgMail.send(…)`, `getTwilioClient()`, `page.goto(…)`)
 *      must happen underneath a framework request: lexically inside the
 *      `fetch:` callback of a `wcRequest`/`wcUncachedRequest` call, or inside
 *      a function this file hands that callback the work to. Reaching the
 *      network from anywhere else is the violation.
 *
 *   2. NO UNLISTED VENDOR MODULE. No server file outside that list may name a
 *      vendor endpoint or import a vendor SDK. A new wrapper therefore fails
 *      this check on its first line, and the fix is to add it to
 *      OUTBOUND_MODULES — which immediately subjects it to rule 1.
 *
 * The US Census is the odd one out on the list: it is free and has no side
 * effect. It is here because it is a service the framework can name, and
 * everything the framework calls is refused through the one guard — so leaving
 * it out would split the one list in two.
 *
 * Deliberately NOT covered, matching the task's scope: browser-side Google
 * Maps in `client/` (the browser calls Google directly and cannot be gated
 * server-side), standalone `scripts/` (they never arm the flag, exactly like
 * the database write lock), and the individual calls named in
 * OFF_FRAMEWORK_FUNCTIONS, each with its written reason.
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
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";

/** The legacy standalone guard, still used by the calls exempted below. */
const GUARD_FN = "assertExternalServiceAllowed";

/** Where the refusal lives; the module itself makes no outbound call. */
const GUARD_MODULE = "server/services/maintenance-flag.ts";

/**
 * Every module that reaches somebody else's system. Each one is subject to
 * rule 1.
 */
const OUTBOUND_MODULES = [
  "server/lib/twilio-client.ts",
  "server/services/comm/providers/sms/twilio.ts",
  "server/services/comm/providers/email/sendgrid.ts",
  "server/services/comm/providers/postal/lob.ts",
  "server/services/comm/validators/address.ts",
  "server/services/google-civics.ts",
  "server/services/google-geocode.ts",
  "server/services/driving-distance.ts",
  "server/services/census-geocoder.ts",
  "server/modules/sitespecific/t631/client/fetch.ts",
  "server/modules/sitespecific/freeman/edls-migrate/client.ts",
  "server/modules/sitespecific/btu/scraper-import.ts",
  "server/plugins/wizards/plugins/btu-cardcheck-scrape-import.ts",
];
/**
 * How an outbound call is recognized. `fetch` covers Lob, Google, OpenStates,
 * the site-specific clients and the scraper's attachment downloads;
 * `getTwilioClient` is the single door to Twilio; `sgMail.send` is SendGrid's;
 * `page.goto`/`page.pdf` are how the BTU scrape reaches the site it drives.
 */
const OUTBOUND_CALLS = [
  "fetch",
  "getTwilioClient",
  "sgMail.send",
  "page.goto",
  "page.pdf",
];

/**
 * How an unlisted vendor module is recognized: a vendor endpoint, or a vendor
 * SDK import.
 */
const VENDOR_MARKERS: { pattern: RegExp; what: string }[] = [
  { pattern: /https?:\/\/[\w.-]*\bgoogleapis\.com/, what: "a Google API endpoint" },
  { pattern: /https?:\/\/[\w.-]*\blob\.com/, what: "a Lob API endpoint" },
  { pattern: /https?:\/\/[\w.-]*\btwilio\.com/, what: "a Twilio API endpoint" },
  { pattern: /https?:\/\/[\w.-]*\bsendgrid\.(com|net)/, what: "a SendGrid API endpoint" },
  { pattern: /https?:\/\/[\w.-]*\bcensus\.gov/, what: "a US Census API endpoint" },
  { pattern: /https?:\/\/[\w.-]*\bopenstates\.org/, what: "an OpenStates API endpoint" },
  {
    pattern: /https?:\/\/sirius-btu\.activistcentral\.net/,
    what: "the BTU site the scraper drives",
  },
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
    // `git ls-files` still names a tracked file that has been deleted in the
    // working tree. The scan is of the working tree, so a file that is not
    // there is not a file: reading it would crash the whole check on the one
    // commit that removes a module.
  ).filter((file) => existsSync(file));
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

/** Every function-like node declared in the file, indexed by callable name. */
function declaredFunctions(sf: ts.SourceFile): Map<string, FunctionLike[]> {
  const byName = new Map<string, FunctionLike[]>();
  const record = (name: string, fn: FunctionLike) => {
    const existing = byName.get(name);
    if (existing) existing.push(fn);
    else byName.set(name, [fn]);
  };

  const visit = (node: ts.Node): void => {
    if (isFunctionLike(node)) {
      const name = nameOf(node, sf);
      record(name, node);
      // A method is called as `this.method(…)` or `service.method(…)`; index
      // it under the bare name and let the caller match on the last segment.
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return byName;
}
/** Rule 2: nothing outside OUTBOUND_MODULES talks to one of these vendors. */
function auditUnlistedVendorModules(files: string[]): Violation[] {
  const violations: Violation[] = [];
  const known = new Set([...OUTBOUND_MODULES, GUARD_MODULE]);

  for (const file of files) {
    if (known.has(file) || VENDOR_MARKER_EXEMPT[file]) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    for (const marker of VENDOR_MARKERS) {
      const index = lines.findIndex((l) => marker.pattern.test(l));
      if (index === -1) continue;
      violations.push({
        file,
        line: index + 1,
        detail: `references ${marker.what} but is not a listed outbound module`,
        remedy:
          `Add "${file}" to OUTBOUND_MODULES in scripts/dev/check-maintenance-guards.ts and put ` +
          `each outbound operation through the web client framework. If it names the vendor ` +
          `without calling it, add it to VENDOR_MARKER_EXEMPT with the reason.`,
      });
    }
  }
  return violations;
}

/** Rule 0: the list itself has to be real, or the whole check quietly passes. */
function auditModuleList(files: Set<string>): Violation[] {
  return OUTBOUND_MODULES.filter((m) => !files.has(m)).map((m) => ({
    file: "scripts/dev/check-maintenance-guards.ts",
    line: 1,
    detail: `OUTBOUND_MODULES names "${m}", which no longer exists`,
    remedy: "Remove or rename the entry so the list keeps describing the real outbound modules.",
  }));
}

/** The framework entry points. An outbound call must sit under one of them. */
const FRAMEWORK_CALLS = ["wcRequest", "wcUncachedRequest"];

/** The property that carries the work the framework performs. */
const FRAMEWORK_WORK_PROPERTY = "fetch";

/**
 * The functions in this file that run underneath a framework request: the
 * `fetch:` callbacks themselves, plus everything they hand the work to.
 *
 * The second half matters because a long operation is usually a callback that
 * delegates — `fetch: () => this.printLetterAtLob(params)`. The delegate is
 * still on the framework's path: it only runs once the refusal, the hold and
 * the writable-database requirement have all been satisfied.
 */
function functionsUnderFramework(sf: ts.SourceFile): Set<FunctionLike> {
  const declared = declaredFunctions(sf);
  const underFramework = new Set<FunctionLike>();
  const queue: FunctionLike[] = [];

  const findCallbacks = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && FRAMEWORK_CALLS.includes(calleeText(node, sf))) {
      for (const arg of node.arguments) {
        if (!ts.isObjectLiteralExpression(arg)) continue;
        for (const prop of arg.properties) {
          if (!prop.name || !ts.isIdentifier(prop.name)) continue;
          if (prop.name.text !== FRAMEWORK_WORK_PROPERTY) continue;
          const value = ts.isPropertyAssignment(prop) ? prop.initializer : prop;
          if (isFunctionLike(value)) queue.push(value);
        }
      }
    }
    ts.forEachChild(node, findCallbacks);
  };
  findCallbacks(sf);

  // Walk outward from each callback to whatever it calls, by name, until the
  // set stops growing.
  while (queue.length > 0) {
    const fn = queue.pop()!;
    if (underFramework.has(fn)) continue;
    underFramework.add(fn);

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = calleeText(node, sf);
        const bareName = callee.split(".").pop() ?? callee;
        for (const target of declared.get(bareName) ?? []) {
          if (!underFramework.has(target)) queue.push(target);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(fn);
  }

  return underFramework;
}

/**
 * Outbound calls that are deliberately not made through the framework, with
 * the reason for each.
 *
 * Per-function rather than per-file on purpose: exempting a whole file would
 * silently cover the next method somebody adds to it.
 */
const OFF_FRAMEWORK_FUNCTIONS: Record<string, Record<string, string>> = {
  "server/lib/twilio-client.ts": {
    getCredentialsFromConnector:
      "Reads Twilio credentials from the Replit connector endpoint, not from Twilio. It is " +
      "reached only from getTwilioClient(), which is itself an outbound call the framework " +
      "gates at every call site, so it cannot run during maintenance.",
  },
  "server/services/comm/providers/sms/twilio.ts": {
    validatePhone:
      "IS the work of a framework request — the cached phone-lookup entry registered in " +
      "server/services/comm/validators/phone.ts, whose fetch callback calls this. The " +
      "framework request is in that file, so it is not visible here.",
  },
  "server/services/comm/providers/postal/lob.ts": {
    verifyAddress:
      "Cacheable, and the only one of the address lookups still off the framework: the " +
      "Google validation, parsing and geocoding that surround it are now cached entries, " +
      `and this one follows them. Guarded by ${GUARD_FN}() until it does.`,
  },
};

/** Rule 1: every outbound call in a listed module goes through the framework. */
function auditOutboundModule(file: string): Violation[] {
  const sf = parse(file);
  const exemptions = OFF_FRAMEWORK_FUNCTIONS[file] ?? {};
  const underFramework = functionsUnderFramework(sf);
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

      if (!exemptReason && !stack.some((fn) => underFramework.has(fn))) {
        violations.push({
          file,
          line: lineOf(sf, node),
          detail:
            `${owner}() makes an outbound call (${calleeText(node, sf)}) that does not go ` +
            `through the web client framework`,
          remedy:
            `Register the operation (registerWcRequest for a cacheable answer, ` +
            `registerUncachedWcRequest for one that must never be replayed) and make the call ` +
            `inside the \`${FRAMEWORK_WORK_PROPERTY}:\` callback of ${FRAMEWORK_CALLS.join("/")}. ` +
            `If it genuinely must not go through the framework, name ${owner} in ` +
            `OFF_FRAMEWORK_FUNCTIONS with the reason.`,
        });
      }
    }

    ts.forEachChild(node, visit);
    if (pushed) stack.pop();
  };

  visit(sf);
  return violations;
}

export function findViolations(): Violation[] {
  const all = listWorkingTreeFiles();
  const present = new Set(all);
  const scanned = all.filter(isScanned);

  const violations = auditModuleList(present);
  for (const module of OUTBOUND_MODULES) {
    if (present.has(module)) violations.push(...auditOutboundModule(module));
  }
  violations.push(...auditUnlistedVendorModules(scanned));
  return violations;
}

function main(): void {
  const violations = findViolations();

  if (violations.length === 0) {
    console.log(
      `[check-maintenance-guards] OK — every outbound call in ${OUTBOUND_MODULES.length} ` +
        `module(s) goes through the web client framework, and no other server file reaches one ` +
        `of these outside systems.`,
    );
    process.exit(0);
  }

  console.error(
    [
      "",
      "[check-maintenance-guards] FAILED",
      "",
      "An outbound call can bypass maintenance mode.",
      "",
      "Maintenance mode makes the database read-only, but an SMS, an email, a",
      "letter or a metered geocode cannot be rolled back when maintenance ends.",
      "The refusal, the failure hold and the audit trail all live in the web",
      `client framework, so every outbound call goes through ${FRAMEWORK_CALLS.join(" / ")}`,
      "from server/services/webclient.",
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
