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
  "server/services/census-geocoder.ts",
  "server/modules/sitespecific/t631/client/fetch.ts",
  "server/modules/sitespecific/freeman/edls-migrate/client.ts",
  "server/modules/sitespecific/btu/scraper-import.ts",
  "server/plugins/wizards/plugins/btu-cardcheck-scrape-import.ts",
  "server/plugins/wc-vendors/plugins/stripe.ts",
];
/**
 * How an outbound call is recognized. `fetch` covers Lob, Google, OpenStates,
 * the site-specific clients and the scraper's attachment downloads;
 * `getTwilioClient` is the single door to Twilio; `sgMail.send` is SendGrid's;
 * `page.goto`/`page.pdf` are how the BTU scrape reaches the site it drives.
 *
 * Stripe has no entry here, and rule 1 is therefore quiet about it. Its plugin
 * does not make its own framework request: the wc-vendors kind declares
 * operations, and registering the plugin wraps every one of its handlers in a
 * framework request. The `wcUncachedRequest` call rule 1 looks for is in
 * `server/plugins/wc-vendors/registry.ts` by design, and since
 * delegation is only followed within a file, naming a Stripe call marker here
 * would report all nine handlers as off-framework and buy nine exemptions that
 * each say "yes it is".
 *
 * What keeps Stripe honest instead is stronger than a lexical check: the
 * registry hands out handlers that are already on the framework, so there is
 * no way to call one that skips the refusal — not even by reaching into the
 * plugin object. Rule 2 still does its half, confining the SDK import to the
 * one module listed above.
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
  { pattern: /from\s+['"]stripe['"]/, what: "the Stripe SDK" },
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

/**
 * Rule 0: the lists themselves have to be real, or the whole check quietly
 * passes.
 *
 * Both lists are keyed by file path, so moving a module disarms whichever rule
 * named it — and disarms it silently, because a rule with nothing to scan
 * reports nothing. `WRAPPED_AT_REGISTRATION` is checked here for the same
 * reason `OUTBOUND_MODULES` is: a rename that takes rule 3 offline should fail
 * loudly rather than turn the strongest of the three rules into a no-op.
 */
function auditModuleList(files: Set<string>): Violation[] {
  const violations: Violation[] = OUTBOUND_MODULES.filter((m) => !files.has(m)).map((m) => ({
    file: "scripts/dev/check-maintenance-guards.ts",
    line: 1,
    detail: `OUTBOUND_MODULES names "${m}", which no longer exists`,
    remedy: "Remove or rename the entry so the list keeps describing the real outbound modules.",
  }));
  for (const m of Object.keys(WRAPPED_AT_REGISTRATION)) {
    if (files.has(m)) continue;
    violations.push({
      file: "scripts/dev/check-maintenance-guards.ts",
      line: 1,
      detail: `WRAPPED_AT_REGISTRATION names "${m}", which no longer exists`,
      remedy:
        "Remove or rename the entry. Leaving it disables rule 3 for that module without any error.",
    });
  }
  return violations;
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
  const roots: FunctionLike[] = [];

  const findCallbacks = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && FRAMEWORK_CALLS.includes(calleeText(node, sf))) {
      for (const arg of node.arguments) {
        if (!ts.isObjectLiteralExpression(arg)) continue;
        for (const prop of arg.properties) {
          if (!prop.name || !ts.isIdentifier(prop.name)) continue;
          if (prop.name.text !== FRAMEWORK_WORK_PROPERTY) continue;
          const value = ts.isPropertyAssignment(prop) ? prop.initializer : prop;
          if (isFunctionLike(value)) roots.push(value);
        }
      }
    }
    ts.forEachChild(node, findCallbacks);
  };
  findCallbacks(sf);

  return functionsReachableFrom(sf, roots);
}

/**
 * The given functions, plus everything in this file they hand the work to.
 *
 * The second half matters because a long operation is usually a callback that
 * delegates — `fetch: () => this.printLetterAtLob(params)`. The delegate is
 * still on the caller's path.
 *
 * By name, and therefore within one file: a delegate in another module is not
 * found. Both rules that use this are per-file for that reason.
 */
function functionsReachableFrom(
  sf: ts.SourceFile,
  roots: FunctionLike[],
): Set<FunctionLike> {
  const declared = declaredFunctions(sf);
  const reachable = new Set<FunctionLike>();
  const queue = [...roots];

  while (queue.length > 0) {
    const fn = queue.pop()!;
    if (reachable.has(fn)) continue;
    reachable.add(fn);

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = calleeText(node, sf);
        const bareName = callee.split(".").pop() ?? callee;
        for (const target of declared.get(bareName) ?? []) {
          if (!reachable.has(target)) queue.push(target);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(fn);
  }

  return reachable;
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

/**
 * Modules whose vendor calls are put on the framework by the registrar that
 * registers them, not by a `wcRequest` written in the file.
 *
 * A wc-vendors plugin declares handlers in an `operations` map and
 * `registerWcVendorPlugin` registers the plugin with every one of those
 * handlers already wrapped in a framework request. Rule 1 cannot see that: the
 * `wcUncachedRequest` call is in the registry, and delegation is only followed
 * within a file, so listing the vendor in OUTBOUND_CALLS would report every
 * handler in the file and buy one exemption per handler each saying "yes it
 * is".
 *
 * Rule 3 checks the property that actually makes the wrapping total: the
 * vendor is reachable ONLY from the handlers. A vendor call anywhere else in
 * the file — a metadata hook like `validateConfig`, a helper nothing wraps,
 * module top level — is not covered by the registrar and is reported.
 */
const WRAPPED_AT_REGISTRATION: Record<
  string,
  {
    /** The object literal property holding the wrapped handlers. */
    handlerContainer: string;
    /** The property on each entry that is the handler. */
    handlerProperty: string;
    /** Identifiers that get hold of the vendor's client. */
    vendorIdentifiers: string[];
  }
> = {
  "server/plugins/wc-vendors/plugins/stripe.ts": {
    handlerContainer: "operations",
    handlerProperty: "run",
    vendorIdentifiers: ["Stripe", "client"],
  },
};

/** The handler functions declared in a `<container>: { x: { <prop>() {} } }` map. */
function handlersInContainer(
  sf: ts.SourceFile,
  container: string,
  property: string,
): FunctionLike[] {
  const handlers: FunctionLike[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === container &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const entry of node.initializer.properties) {
        if (!ts.isPropertyAssignment(entry)) continue;
        if (!ts.isObjectLiteralExpression(entry.initializer)) continue;
        for (const prop of entry.initializer.properties) {
          if (!prop.name || !ts.isIdentifier(prop.name)) continue;
          if (prop.name.text !== property) continue;
          const value = ts.isPropertyAssignment(prop) ? prop.initializer : prop;
          if (isFunctionLike(value)) handlers.push(value);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return handlers;
}

/** Rule 3: in a wrapped-at-registration module, only handlers reach the vendor. */
function auditWrappedAtRegistration(file: string): Violation[] {
  const spec = WRAPPED_AT_REGISTRATION[file];
  const sf = parse(file);
  const handlers = handlersInContainer(sf, spec.handlerContainer, spec.handlerProperty);

  if (handlers.length === 0) {
    return [
      {
        file,
        line: 1,
        detail:
          `is listed in WRAPPED_AT_REGISTRATION but declares no ` +
          `\`${spec.handlerContainer}\` handlers, so the rule checks nothing`,
        remedy:
          `Either the handlers moved — point handlerContainer/handlerProperty at where ` +
          `they are now — or this module no longer wraps at registration, in which case ` +
          `remove the entry and put its outbound calls under rule 1.`,
      },
    ];
  }

  const violations: Violation[] = [];

  // Everything that can end up touching the vendor, found by working BACKWARDS:
  // the functions that name it, then the functions that call those, and so on.
  //
  // Backwards rather than forwards from the handlers, because forwards answers
  // the wrong question. That a helper CAN be reached from a handler does not
  // mean it can ONLY be reached from one: a `sharedStripeCall()` called by both
  // a handler and `validateConfig` is reachable from a handler, and reading
  // forwards it looks fine, while the second caller quietly reaches Stripe with
  // nothing wrapping it. Working backwards, that second caller is itself
  // vendor-reaching, and it is not a handler, so it is reported.
  const { vendorReaching, topLevel } = vendorReachingFunctions(sf, spec);

  for (const { line, identifier } of topLevel) {
    violations.push({
      file,
      line,
      detail:
        `module top level reaches the vendor (${identifier}), where nothing can wrap it`,
      remedy:
        `Only the \`${spec.handlerContainer}\` handlers are put on the web client framework. ` +
        `Move the work into an operation handler, or into a helper one of them calls.`,
    });
  }

  // The handlers, plus what they delegate to: the only functions registration
  // puts on the framework.
  const wrapped = functionsReachableFrom(sf, handlers);

  for (const fn of vendorReaching) {
    if (wrapped.has(fn)) continue;
    violations.push({
      file,
      line: lineOf(sf, fn),
      detail:
        `${nameOf(fn, sf)}() reaches the vendor but is not reachable from the ` +
        `\`${spec.handlerContainer}\` handlers, so nothing puts it on the web client framework`,
      remedy:
        `Registration wraps the \`${spec.handlerContainer}\` handlers and what they call, ` +
        `and nothing else, so a call from here is not refused during maintenance and is not ` +
        `counted. Move the work into an operation handler, or into a helper one of them calls.`,
    });
  }

  violations.push(...auditRawPluginNotExported(sf, file, spec.handlerContainer));
  return violations;
}

/**
 * The functions that reach the vendor, and any mention of it outside them all.
 *
 * A mention counts for every function it sits inside, not just the innermost
 * one: `validateConfig` with a `() => client(ctx)` inside it reaches the vendor
 * just as surely as if it said so directly, and nothing calls that arrow by a
 * name the walk could follow.
 */
function vendorReachingFunctions(
  sf: ts.SourceFile,
  spec: { vendorIdentifiers: string[] },
): {
  vendorReaching: Set<FunctionLike>;
  topLevel: Array<{ line: number; identifier: string }>;
} {
  const declared = declaredFunctions(sf);
  const vendorReaching = new Set<FunctionLike>();
  const topLevel: Array<{ line: number; identifier: string }> = [];
  /** Who calls what, by bare name, for every function the name sits inside. */
  const callers = new Map<string, Set<FunctionLike>>();
  const topLevelCalls = new Map<string, number>();
  const stack: FunctionLike[] = [];

  const visit = (node: ts.Node): void => {
    const pushed = isFunctionLike(node);
    if (pushed) stack.push(node);

    // A value-position mention of the vendor. A type position (`: Stripe`)
    // reaches nothing, and neither does the name being imported or declared.
    if (
      ts.isIdentifier(node) &&
      spec.vendorIdentifiers.includes(node.text) &&
      !ts.isTypeReferenceNode(node.parent) &&
      !ts.isImportSpecifier(node.parent) &&
      !ts.isImportClause(node.parent) &&
      !(ts.isFunctionDeclaration(node.parent) && node.parent.name === node)
    ) {
      if (stack.length === 0) {
        topLevel.push({ line: lineOf(sf, node), identifier: node.text });
      }
      for (const fn of stack) vendorReaching.add(fn);
    }

    if (ts.isCallExpression(node)) {
      const callee = calleeText(node, sf);
      const bareName = callee.split(".").pop() ?? callee;
      if (stack.length === 0) {
        if (!topLevelCalls.has(bareName)) topLevelCalls.set(bareName, lineOf(sf, node));
      }
      let set = callers.get(bareName);
      if (!set) callers.set(bareName, (set = new Set()));
      for (const fn of stack) set.add(fn);
    }

    ts.forEachChild(node, visit);
    if (pushed) stack.pop();
  };
  visit(sf);

  // Propagate upward: calling something that reaches the vendor reaches it too.
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, fns] of callers) {
      const targets = declared.get(name) ?? [];
      if (!targets.some((t) => vendorReaching.has(t))) continue;
      for (const fn of fns) {
        if (!vendorReaching.has(fn)) {
          vendorReaching.add(fn);
          grew = true;
        }
      }
      const line = topLevelCalls.get(name);
      if (line !== undefined && !topLevel.some((t) => t.line === line)) {
        topLevel.push({ line, identifier: name });
      }
    }
  }

  return { vendorReaching, topLevel };
}

/**
 * The plugin object as the file writes it must not leave the file.
 *
 * What registration hands to the registry is a COPY whose handlers are wrapped.
 * The literal the file declares still holds the bare ones, so exporting it
 * would republish every operation with the refusal missing — and it would do so
 * without naming the vendor anywhere, which is why the check above cannot see
 * it.
 */
function auditRawPluginNotExported(
  sf: ts.SourceFile,
  file: string,
  handlerContainer: string,
): Violation[] {
  const violations: Violation[] = [];
  const remedy =
    `The registry is the only supported handle on this plugin, and what it hands out has ` +
    `the web client framework around every handler. An exported literal is the same plugin ` +
    `with the maintenance refusal missing, so keep it local to this file.`;

  // The names bound to a raw plugin literal in this file.
  const raw = new Map<string, ts.VariableDeclaration>();
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const init = declaration.initializer;
      if (!init || !ts.isObjectLiteralExpression(init)) continue;
      if (!ts.isIdentifier(declaration.name)) continue;
      const declares = init.properties.some(
        (p) => p.name && ts.isIdentifier(p.name) && p.name.text === handlerContainer,
      );
      if (declares) raw.set(declaration.name.text, declaration);
    }
  }
  if (raw.size === 0) return violations;

  const report = (node: ts.Node, name: string, how: string): void => {
    violations.push({
      file,
      line: lineOf(sf, node),
      detail:
        `${how} ${name}, whose \`${handlerContainer}\` are the handlers as written, ` +
        `before registration wraps them`,
      remedy,
    });
  };

  // Every spelling of "this leaves the file": the modifier, a later named
  // export, and a default export. Checking only the first would be a rule that
  // asks how something is written instead of what it does.
  for (const statement of sf.statements) {
    if (
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        if (raw.has(declaration.name.text)) {
          report(declaration, declaration.name.text, "exports");
        }
      }
    }

    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const specifier of statement.exportClause.elements) {
        const local = (specifier.propertyName ?? specifier.name).text;
        if (raw.has(local)) report(specifier, local, "exports");
      }
    }

    if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
      const local = statement.expression.text;
      if (raw.has(local)) report(statement, local, "default-exports");
    }
  }

  return violations;
}

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
  for (const module of Object.keys(WRAPPED_AT_REGISTRATION)) {
    if (present.has(module)) violations.push(...auditWrappedAtRegistration(module));
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
