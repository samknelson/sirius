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
 *   4. NO SECOND DOOR TO A VENDOR HANDLER. A registered wc-vendors plugin
 *      carries no runnable handler; the framework alone can fetch one, by
 *      name, from the registry. Only the framework may import that lookup, or
 *      the guarantee rule 3 rests on becomes a rule callers have to remember.
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
  "server/services/comm/validators/address.ts",
  "server/services/objectStorage.ts",
  "server/services/container-facts.ts",
  "server/modules/webservices/admin.ts",
  "server/services/files/providers/s3.ts",
  "server/services/files/providers/replit.ts",
  "server/services/files/providers/local.ts",
  "server/services/file-transfer-client.ts",
  "server/auth/providers/replit.ts",
  "server/storage/db.ts",
];
/**
 * How an outbound call is recognized. `fetch` covers Lob, Google, OpenStates,
 * the site-specific clients and the scraper's attachment downloads;
 * `getTwilioClient` is the single door to Twilio; `sgMail.send` is SendGrid's;
 * `page.goto`/`page.pdf` are how the BTU scrape reaches the site it drives.
 *
 * A wc-vendors plugin is listed here even though it makes no framework request
 * of its own: it declares
 * operations, registration keeps the runnable halves in a private map, and the
 * framework is the only thing that can reach them. The framework request rule
 * 1 looks for is in `server/services/webclient` by design, and since
 * delegation is only followed within a file, naming a plugin's call marker
 * here would report every handler as off-framework and buy one exemption per
 * handler, each saying "yes it is".
 *
 * What keeps a plugin honest instead is stronger than a lexical check: the
 * registry hands out a plugin whose operations describe themselves and cannot
 * be run, so there is no way to call one at all except through the framework —
 * not even by reaching into the plugin object. Rule 3 below checks the half
 * that is still the file's own responsibility: that the vendor is reached from
 * the handlers and nowhere else. Rule 2 confines the SDK import to the one
 * module listed above.
 */
const OUTBOUND_CALLS = [
  "fetch",
  "globalThis.fetch",
  "getTwilioClient",
  "sgMail.send",
  "page.goto",
  "page.pdf",
  "this.client.send",
  "client.discovery",
  "client.refreshTokenGrant",
];

/**
 * How an unlisted vendor module is recognized: a vendor endpoint, or a vendor
 * SDK import.
 */
const VENDOR_MARKERS: { pattern: RegExp; what: string }[] = [
  // Keep these transport markers deliberately broad.  A wrapper can hide the
  // spelling of a vendor URL, but it cannot hide the transport it uses.  The
  // plugin audit below is the stronger check for transport-bearing plugins.
  {
    pattern:
      /(?:\bawait\s+|\breturn\s+|[=(,{;]\s*)(?:globalThis\.)?fetch\s*\(/,
    what: "a fetch transport",
  },
  {
    pattern: /\b(?:const|let|var)\s+\w+\s*=\s*(?:globalThis\.)?fetch\b/,
    what: "an alias of the fetch transport",
  },
  {
    pattern:
      /import\s+(?:\*\s+as\s+\w+|\w+(?:\s*,\s*\{[^}]*\})?|\{[^}]*(?:request|get|Agent|ClientRequest)[^}]*\})\s+from\s+['"](?:node:)?https?['"]|require\s*\(\s*['"](?:node:)?https?['"]\s*\)/,
    what: "the node HTTP/HTTPS transport",
  },
  {
    pattern:
      /(?:\bfrom\s+|\brequire\s*\(\s*|\bimport\s*\(\s*)['"](?:axios|got|node-fetch|undici|@sendgrid\/mail|twilio|stripe|puppeteer(?:-core)?|playwright(?:-core)?|@playwright\/test|googleapis|openid-client|ssh2-sftp-client|basic-ftp|@aws-sdk\/[^'"]+)['"]/,
    what: "a vendor or browser transport SDK",
  },
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
  { pattern: /from\s+['"]puppeteer(?:-core)?['"]/, what: "the Puppeteer browser SDK" },
  { pattern: /from\s+['"]playwright(?:\/[^'"]*)?['"]/, what: "the Playwright browser SDK" },
  { pattern: /from\s+['"]openid-client(?:\/[^'"]*)?['"]/, what: "the OpenID client SDK" },
  { pattern: /from\s+['"]@aws-sdk\//, what: "the AWS SDK transport" },
];

/**
 * Files that name a vendor without making a vendor call, with the reason.
 */
const VENDOR_MARKER_EXEMPT: Record<string, string> = {
  "server/services/comm/callback-handlers/twilio.ts":
    "Imports the Twilio SDK only for twilio.validateRequest(), an offline signature " +
    "check over an INBOUND webhook. It sends nothing and reaches no network.",
  "server/plugins/wc-vendors/plugins/postal.ts":
    "The Lob endpoints are called only by registered wc-vendor operation handlers; " +
    "HANDLERS_ON_FRAMEWORK audits that delegation and the framework supplies refusal.",
  "server/plugins/wc-vendors/plugins/email.ts":
    "The SendGrid SDK is called only by registered wc-vendor operation handlers; " +
    "HANDLERS_ON_FRAMEWORK audits that delegation and the framework supplies refusal.",
  "server/plugins/wc-vendors/plugins/sms-twilio.ts":
    "The Twilio SDK is called only by registered wc-vendor operation handlers; " +
    "HANDLERS_ON_FRAMEWORK audits that delegation and the framework supplies refusal.",
  "server/plugins/wc-vendors/plugins/google-geocoding.ts":
    "The Google endpoint is called only by a registered wc-vendor operation handler; " +
    "HANDLERS_ON_FRAMEWORK audits that delegation and the framework supplies refusal.",
  "server/plugins/wc-vendors/plugins/openstates.ts":
    "The OpenStates endpoint is called only by a registered wc-vendor operation handler; " +
    "HANDLERS_ON_FRAMEWORK audits that delegation and the framework supplies refusal.",
  "server/plugins/wc-vendors/plugins/census-geocoder.ts":
    "The Census endpoint is called only by a registered wc-vendor operation handler; " +
    "HANDLERS_ON_FRAMEWORK audits that delegation and the framework supplies refusal.",
  "server/plugins/wc-vendors/plugins/btu-cardcheck.ts":
    "The BTU browser and PDF endpoints are reached only by registered wc-vendor operation handlers; " +
    "HANDLERS_ON_FRAMEWORK audits that delegation and the framework supplies refusal.",
  "server/services/webclient/client.ts":
    "The fetch callback is the web-client framework's intentional transport boundary. It is the " +
    "framework implementation itself, not a caller that can bypass the framework.",
};

/**
 * Framework-only imports: the export, and the one module allowed to have it.
 *
 * `getWcVendorHandler` is how a request becomes an actual vendor call. Held
 * anywhere else it is a second door — an outbound call with no maintenance
 * refusal, no write gate and no count — and it reaches that state without
 * naming a vendor anywhere, so rules 1 to 3 all stay quiet about it.
 *
 * Tests are outside `server/` and so outside this scan, deliberately: a test
 * asserting what a handler does needs to reach one, and it is not a way
 * production code can.
 */
const FRAMEWORK_ONLY_IMPORTS: { name: string; allowed: string[]; why: string }[] = [
  {
    name: "getWcVendorHandler",
    allowed: ["server/services/webclient/wc-vendor-context.ts"],
    why:
      "it returns a vendor handler with nothing in front of it — no maintenance refusal, " +
      "no writable-database gate and no usage count",
  },
];

/**
 * Registration is an implementation detail of the framework.  In particular,
 * allowing a service to import the registration helpers makes it possible to
 * create a second list of operations beside the plugin registry.  Keep the
 * few framework files which implement or re-export the helpers explicit.
 */
const FRAMEWORK_REGISTRATION_IMPORTS: {
  name: string;
  allowed: string[];
  why: string;
}[] = [
  {
    name: "registerWcRequest",
    allowed: [
      "server/services/webclient/registry.ts",
      "server/services/webclient/uncached.ts",
      "server/plugins/wc-vendors/registry.ts",
    ],
    why:
      "request registration belongs to the web-client registry; vendor operations " +
      "are registered by the wc-vendors registry",
  },
  {
    name: "registerUncachedWcRequest",
    allowed: [],
    why:
      "the generic uncached registration API was removed; all vendor operation registration " +
      "belongs to the wc-vendors registry",
  },
  {
    name: "registerUncachedWcVendorRequest",
    allowed: ["server/services/webclient/uncached.ts", "server/plugins/wc-vendors/registry.ts"],
    why: "vendor operation registration belongs to the wc-vendors registry",
  },
];

const FRAMEWORK_IMPORT_RULES = [...FRAMEWORK_ONLY_IMPORTS, ...FRAMEWORK_REGISTRATION_IMPORTS];

function staticModuleSpecifier(node: ts.StringLiteralLike | undefined): string | undefined {
  return node?.text;
}

function isFrameworkModulePath(value: string): boolean {
  return (
    value.includes("webclient") ||
    value.includes("wc-vendors/registry") ||
    value.includes("plugins/wc-vendors")
  );
}

/**
 * Rule 4: framework-only exports are imported by the framework and nobody
 * else.  This is intentionally syntax-based rather than text-based:
 *
 *   - named aliases and namespace property access are both bindings;
 *   - named re-exports are still a way to hand the second door to callers;
 *   - static dynamic-import property/destructuring access is visible to the
 *     compiler and is checked too.
 *
 * An import of a module by itself is harmless.  It is the access to one of the
 * named framework exports that is forbidden.
 */
function auditFrameworkOnlyImports(files: string[]): Violation[] {
  const violations: Violation[] = [];

  for (const file of files) {
    const sf = parse(file);
    const forbidden = new Map<string, (typeof FRAMEWORK_IMPORT_RULES)[number]>();
    const namespaces = new Set<string>();
    const report = (node: ts.Node, rule: (typeof FRAMEWORK_IMPORT_RULES)[number], action: string) => {
      violations.push({
        file,
        line: lineOf(sf, node),
        detail: `${action} ${rule.name}, which only the web client framework may hold`,
        remedy:
          `Make the call through wcRequest() instead: ${rule.why}. If the framework itself ` +
          `has moved, update FRAMEWORK_IMPORT_RULES in scripts/dev/check-maintenance-guards.ts.`,
      });
    };
    const ruleFor = (name: string) =>
      FRAMEWORK_IMPORT_RULES.find(
        (rule) => rule.name === name && !rule.allowed.includes(file),
      );

    for (const statement of sf.statements) {
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (!clause || clause.isTypeOnly) continue;
        if (
          !ts.isStringLiteral(statement.moduleSpecifier) ||
          !isFrameworkModulePath(statement.moduleSpecifier.text)
        ) {
          continue;
        }
        if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
          namespaces.add(clause.namedBindings.name.text);
        }
        if (!clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
        for (const specifier of clause.namedBindings.elements) {
          if (specifier.isTypeOnly) continue;
          const imported = (specifier.propertyName ?? specifier.name).text;
          const rule = ruleFor(imported);
          if (!rule) continue;
          forbidden.set(specifier.name.text, rule);
          report(specifier, rule, "imports");
        }
      }

      if (ts.isExportDeclaration(statement)) {
        if (
          statement.moduleSpecifier &&
          ts.isStringLiteral(statement.moduleSpecifier) &&
          !statement.isTypeOnly &&
          !statement.exportClause &&
          isFrameworkModulePath(staticModuleSpecifier(statement.moduleSpecifier) ?? "")
        ) {
          // `export *` has no named AST children to inspect, but re-exports
          // every framework export, including the forbidden ones.
          for (const rule of FRAMEWORK_IMPORT_RULES) {
            if (!rule.allowed.includes(file)) report(statement, rule, "re-exports");
          }
        }
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          const fromFramework =
            statement.moduleSpecifier &&
            ts.isStringLiteral(statement.moduleSpecifier) &&
            isFrameworkModulePath(statement.moduleSpecifier.text);
          for (const specifier of statement.exportClause.elements) {
            const exported = specifier.name.text;
            const local = (specifier.propertyName ?? specifier.name).text;
            const rule =
              forbidden.get(local) ??
              (fromFramework ? ruleFor(exported) ?? ruleFor(local) : undefined);
            if (rule) report(specifier, rule, "re-exports");
          }
        } else if (
          statement.moduleSpecifier &&
          ts.isStringLiteral(statement.moduleSpecifier) &&
          statement.exportClause &&
          ts.isNamespaceExport(statement.exportClause) &&
          isFrameworkModulePath(statement.moduleSpecifier.text)
        ) {
          for (const rule of FRAMEWORK_IMPORT_RULES) {
            if (!rule.allowed.includes(file)) report(statement, rule, "re-exports");
          }
        }
      }
    }

    // A namespace can itself be aliased (`const fw = webclient`); follow that
    // simple, statically visible form as well.
    const visitAliases = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
          node.initializer && ts.isIdentifier(node.initializer)) {
        if (namespaces.has(node.initializer.text)) namespaces.add(node.name.text);
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isCallExpression(node.initializer) &&
        node.initializer.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.initializer.arguments[0] &&
        ts.isStringLiteral(node.initializer.arguments[0]) &&
        isFrameworkModulePath(node.initializer.arguments[0].text)
      ) {
        namespaces.add(node.name.text);
      }
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "then"
      ) {
        const imported = dynamicModuleCall(node.expression.expression);
        if (
          imported?.arguments[0] &&
          ts.isStringLiteral(imported.arguments[0]) &&
          isFrameworkModulePath(imported.arguments[0].text)
        ) {
          const callback = node.arguments[0];
          if (
            callback &&
            (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
            callback.parameters[0] &&
            ts.isIdentifier(callback.parameters[0].name)
          ) {
            namespaces.add(callback.parameters[0].name.text);
          }
        }
      }
      ts.forEachChild(node, visitAliases);
    };
    visitAliases(sf);

    const seen = new Set<string>();
    const reportOnce = (node: ts.Node, rule: (typeof FRAMEWORK_IMPORT_RULES)[number], action: string) => {
      const key = `${node.getStart(sf)}:${rule.name}:${action}`;
      if (seen.has(key)) return;
      seen.add(key);
      report(node, rule, action);
    };
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        const rule = forbidden.get(node.text);
        const parent = node.parent;
        const isImportName =
          ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent);
        const isTypePosition =
          ts.isTypeReferenceNode(parent) || ts.isTypeQueryNode(parent) || ts.isImportTypeNode(parent);
        const isFunctionDeclarationName =
          ts.isFunctionDeclaration(parent) && parent.name === node;
        // The import declaration was reported above.  References in calls,
        // exports and assignments are separately reported here.
        if (rule && !isImportName && !isTypePosition && !isFunctionDeclarationName) {
          reportOnce(node, rule, "uses");
        }
      }
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
        const rule = namespaces.has(node.expression.text) ? ruleFor(node.name.text) : undefined;
        if (rule) reportOnce(node.name, rule, "uses");
      }
      if (
        ts.isElementAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        namespaces.has(node.expression.text) &&
        node.argumentExpression &&
        ts.isStringLiteral(node.argumentExpression)
      ) {
        const rule = ruleFor(node.argumentExpression.text);
        if (rule) reportOnce(node.argumentExpression, rule, "uses");
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const source = node.arguments[0];
        if (
          source &&
          ts.isStringLiteral(source) &&
          isFrameworkModulePath(source.text)
        ) {
          // `import("./uncached").then(({ register... }) => ...)` is handled
          // by the identifier walk.  Property and destructuring access need
          // explicit treatment because their names are not references.
          const parent = node.parent;
          if (ts.isPropertyAccessExpression(parent)) {
            const rule = ruleFor(parent.name.text);
            if (rule) reportOnce(parent.name, rule, "dynamically imports");
          } else if (ts.isElementAccessExpression(parent) && ts.isStringLiteral(parent.argumentExpression)) {
            const rule = ruleFor(parent.argumentExpression.text);
            if (rule) reportOnce(parent.argumentExpression, rule, "dynamically imports");
          }
        }
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isObjectBindingPattern(node.name) &&
        node.initializer
      ) {
        const initializer = ts.isAwaitExpression(node.initializer)
          ? node.initializer.expression
          : node.initializer;
        if (
          ts.isCallExpression(initializer) &&
          initializer.expression.kind === ts.SyntaxKind.ImportKeyword &&
          initializer.arguments[0] &&
          ts.isStringLiteral(initializer.arguments[0]) &&
          isFrameworkModulePath(initializer.arguments[0].text)
        ) {
          for (const element of node.name.elements) {
            const imported = element.propertyName ?? element.name;
            if (!ts.isIdentifier(imported)) continue;
            const rule = ruleFor(imported.text);
            if (rule) reportOnce(imported, rule, "dynamically imports");
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  return violations;
}

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
  if (ts.isConstructorDeclaration(fn)) return "constructor";
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
  const known = new Set([
    ...OUTBOUND_MODULES,
    GUARD_MODULE,
    ...discoverTransportBearingPlugins(files),
  ]);

  for (const file of files) {
    if (known.has(file) || VENDOR_MARKER_EXEMPT[file]) continue;
    const sf = parse(file);
    const transports = [...transportNodes(sf)];
    if (transports.length > 0) {
      const first = transports[0];
      violations.push({
        file,
        line: lineOf(sf, first),
        detail:
          `contains an outbound transport (${first.getText(sf)}) but is not a listed ` +
          "outbound module",
        remedy:
          `Add "${file}" to OUTBOUND_MODULES in scripts/dev/check-maintenance-guards.ts and ` +
          "put each transport call through the web client framework. If it is intentional " +
          "infrastructure, add it to OUTBOUND_MODULES with function-level reasons.",
      });
    }
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
 * reports nothing. `HANDLERS_ON_FRAMEWORK` is checked here for the same
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
  for (const m of Object.keys(HANDLERS_ON_FRAMEWORK)) {
    if (files.has(m)) continue;
    violations.push({
      file: "scripts/dev/check-maintenance-guards.ts",
      line: 1,
      detail: `HANDLERS_ON_FRAMEWORK names "${m}", which no longer exists`,
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
  "server/services/objectStorage.ts": {
    checkStorageServiceAvailable:
      "Restricted Replit object-storage sidecar health check.",
    signObjectURL:
      "Restricted Replit object-storage sidecar request for a signed object URL.",
    uploadFile: "Upload to a signed object-storage URL.",
    downloadFile: "Download from a signed object-storage URL.",
    deleteFile: "Delete through a signed object-storage URL.",
    getFileMetadata: "Read metadata through a signed object-storage URL.",
    generateSignedUrl: "Generate a signed object-storage URL through the storage sidecar.",
    fileExists: "Check object existence through the storage sidecar.",
  },
  "server/services/container-facts.ts": {
    fetchEcsMetadata:
      "Restricted link-local ECS task metadata diagnostic; host and redirects are checked.",
    getContainerFacts:
      "Assembles container diagnostics, including the restricted metadata endpoint.",
  },
  "server/modules/webservices/admin.ts": {
    registerWebServiceAdminRoutes:
      "The test-operation route calls this same application through a localhost URL.",
    executeWebServiceTestRequest:
      "The admin test-operation route calls this same application through a localhost URL.",
  },
  "server/services/files/providers/s3.ts": {
    constructor:
      "Constructs the configured AWS S3 filesystem client; this is file-transfer " +
      "infrastructure, not a wc-vendor operation.",
    read: "Configured S3 filesystem provider operation.",
    write: "Configured S3 filesystem provider operation.",
    delete: "Configured S3 filesystem provider operation.",
    stat: "Configured S3 filesystem provider operation.",
    list: "Configured S3 filesystem provider operation.",
    mkdir: "Configured S3 filesystem provider operation.",
    rmdir: "Configured S3 filesystem provider operation.",
    copyThenDelete: "Configured S3 filesystem provider operation.",
    rename: "Configured S3 filesystem provider operation.",
    renameDirectory: "Configured S3 filesystem provider operation.",
    getSignedUrl: "Configured S3 filesystem provider operation.",
  },
  "server/auth/providers/replit.ts": {
    ensureStrategy:
      "Constructs the inbound Replit Passport/OIDC strategy. This configures authentication " +
      "for callers and is not an outbound vendor operation.",
    discoverOidcConfig:
      "Replit OIDC discovery for inbound application authentication.",
    refreshToken:
      "Refreshes the inbound Replit authentication session through the configured OIDC provider.",
    createProvider:
      "Builds the inbound Replit authentication provider and its configured strategy.",
    getLoginHandler:
      "Returns the inbound Replit login handler, which may initialize its OIDC strategy.",
    getCallbackHandler:
      "Returns the inbound Replit callback handler, which may initialize its OIDC strategy.",
    "anonymous function at line 212":
      "Inbound Replit login callback that initializes the configured authentication strategy.",
    "anonymous function at line 222":
      "Inbound Replit callback that initializes the configured authentication strategy.",
  },
  "server/services/file-transfer-client.ts": {
    withSftpClient:
      "Intentional SFTP transport for the configured file-transfer destination; this is " +
      "file-transfer infrastructure, not a wc-vendor operation.",
    withFtpClient:
      "Intentional FTP transport for the configured file-transfer destination; this is " +
      "file-transfer infrastructure, not a wc-vendor operation.",
    testConnect:
      "Runs the explicitly requested SFTP/FTP connection test for a file-transfer destination.",
    testList:
      "Runs the explicitly requested SFTP/FTP listing operation for a file-transfer destination.",
    testCd:
      "Runs the explicitly requested SFTP/FTP directory operation for a file-transfer destination.",
    testUpload:
      "Runs the explicitly requested SFTP/FTP upload operation for a file-transfer destination.",
    streamDownload:
      "Runs the explicitly requested SFTP/FTP download operation for a file-transfer destination.",
    "anonymous function at line 110":
      "Callback used only by the explicitly requested SFTP file-transfer connection test.",
    "anonymous function at line 133":
      "Callback used only by the explicitly requested SFTP file-transfer listing test.",
    "anonymous function at line 161":
      "Callback used only by the explicitly requested SFTP file-transfer directory test.",
    "anonymous function at line 188":
      "Callback used only by the explicitly requested SFTP file-transfer upload test.",
  },
  "server/storage/db.ts": {
    iamPasswordProvider:
      "Generates an expiring AWS RDS IAM signer token for the database driver's password " +
      "callback. This is database infrastructure, not an outbound vendor operation.",
    "anonymous function at line 164":
      "Database driver's password callback that obtains the expiring RDS IAM signer token.",
  },
};

/**
 * Modules whose vendor calls reach the framework by being registered as
 * handlers, not by a `wcRequest` written in the file.
 *
 * A wc-vendors plugin declares its operations in a map; registration keeps
 * each runnable half in a private table the framework alone can read, and
 * hands the registry a plugin whose operations only describe themselves. So a
 * handler runs when and only when the framework runs it, with the refusal, the
 * write gate and the count already applied. Rule 1 cannot see any of that: the
 * framework request is in `server/services/webclient`, and delegation is only
 * followed within a file, so listing the vendor in OUTBOUND_CALLS would report
 * every handler in the file and buy one exemption per handler each saying
 * "yes it is".
 *
 * Rule 3 checks the half the file itself still decides: the vendor is reached
 * ONLY from the handlers. Registration makes a handler unreachable except
 * through the framework, but it says nothing about the rest of the file — a
 * vendor call in a metadata hook like `validateConfig`, in a helper no handler
 * calls, or at module top level runs with no framework around it at all, and
 * is reported here.
 */
const HANDLERS_ON_FRAMEWORK: Record<
  string,
  {
    /**
     * The maps holding the handlers, by the name each is written under — a
     * property of the plugin literal (`operations: { … }`) or a variable the
     * literal spreads in. The first is the one the plugin literal declares,
     * which is how the literal itself is recognized.
     */
    handlerContainers: string[];
    /** The property on each entry that is the handler. */
    handlerProperty: string;
    /** Identifiers that get hold of the vendor's client. */
    vendorIdentifiers: string[];
  }
> = {
  "server/plugins/wc-vendors/plugins/stripe.ts": {
    handlerContainers: ["operations"],
    handlerProperty: "run",
    vendorIdentifiers: ["Stripe", "client"],
  },
  "server/plugins/wc-vendors/plugins/sitespecific-t631.ts": {
    // T631 has no SDK: it reaches its remote service with a bare `fetch`, and
    // the remote operations are written in their own map that the plugin
    // literal spreads in, so both maps are named here.
    handlerContainers: ["operations", "t631RemoteOperations"],
    handlerProperty: "run",
    vendorIdentifiers: ["fetch"],
  },
  "server/plugins/wc-vendors/plugins/sitespecific-freeman-edls-migrate.ts": {
    handlerContainers: ["operations", "remoteOperations"],
    handlerProperty: "run",
    vendorIdentifiers: ["fetch"],
  },
  "server/plugins/wc-vendors/plugins/postal.ts": {
    handlerContainers: ["operations"],
    handlerProperty: "run",
    vendorIdentifiers: ["fetch"],
  },
  "server/plugins/wc-vendors/plugins/email.ts": {
    handlerContainers: ["sendGridOperations"],
    handlerProperty: "run",
    vendorIdentifiers: ["sgMail"],
  },
  "server/plugins/wc-vendors/plugins/sms-twilio.ts": {
    handlerContainers: ["operations"],
    handlerProperty: "run",
    vendorIdentifiers: ["client"],
  },
  "server/plugins/wc-vendors/plugins/btu-cardcheck.ts": {
    handlerContainers: ["operations"],
    handlerProperty: "run",
    vendorIdentifiers: ["puppeteer", "goto", "pdf", "fetch"],
  },
  "server/plugins/wc-vendors/plugins/census-geocoder.ts": {
    handlerContainers: ["operations"],
    handlerProperty: "run",
    vendorIdentifiers: ["fetch"],
  },
  "server/plugins/wc-vendors/plugins/google-geocoding.ts": {
    handlerContainers: ["operations"],
    handlerProperty: "run",
    vendorIdentifiers: ["fetch"],
  },
  "server/plugins/wc-vendors/plugins/openstates.ts": {
    handlerContainers: ["operations"],
    handlerProperty: "run",
    vendorIdentifiers: ["fetch"],
  },
  "server/plugins/wc-vendors/plugins/sitespecific-freeman-authorization.ts": {
    handlerContainers: ["operations"],
    handlerProperty: "run",
    vendorIdentifiers: ["fetch"],
  },
};

const WC_VENDOR_PLUGIN_PREFIX = "server/plugins/wc-vendors/plugins/";
const TRANSPORT_SDK_MODULES = [
  "axios",
  "got",
  "node-fetch",
  "undici",
  "twilio",
  "stripe",
  "@sendgrid/mail",
  "puppeteer",
  "puppeteer-core",
  "playwright",
  "googleapis",
  "openid-client",
  "ssh2-sftp-client",
  "basic-ftp",
];

function importedTransportBindings(sf: ts.SourceFile): Set<string> {
  const bindings = new Set<string>(["fetch"]);
  const addBindingPattern = (pattern: ts.BindingName): void => {
    if (ts.isIdentifier(pattern)) {
      bindings.add(pattern.text);
      return;
    }
    for (const element of pattern.elements) {
      if (ts.isOmittedExpression(element)) continue;
      addBindingPattern(element.name);
    }
  };
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const moduleName = statement.moduleSpecifier.text;
    const transportImport =
      TRANSPORT_SDK_MODULES.some((name) => moduleName === name || moduleName.startsWith(`${name}/`)) ||
      /^(?:node:)?https?$/.test(moduleName) ||
      moduleName.startsWith("@aws-sdk/");
    if (!transportImport || !statement.importClause) continue;
    const clause = statement.importClause;
    if (clause.name) bindings.add(clause.name.text);
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      bindings.add(clause.namedBindings.name.text);
    }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const specifier of clause.namedBindings.elements) {
        const imported = (specifier.propertyName ?? specifier.name).text;
        const nodeHttp =
          /^(?:node:)?https?$/.test(moduleName) &&
          !["request", "get", "Agent", "ClientRequest"].includes(imported);
        if (!specifier.isTypeOnly && !nodeHttp) bindings.add(specifier.name.text);
      }
    }
  }
  // Dynamic imports and CommonJS require are bindings too.  Include
  // destructuring aliases (`{ request: req }`) rather than relying on the
  // package's original spelling.
  const visitDynamicBindings = (node: ts.Node): void => {
    const initializerCall =
      ts.isVariableDeclaration(node) && node.initializer
        ? dynamicModuleCall(node.initializer)
        : undefined;
    if (
      ts.isVariableDeclaration(node) &&
      initializerCall &&
      initializerCall.arguments[0] &&
      ts.isStringLiteral(initializerCall.arguments[0]) &&
      isTransportModule(initializerCall.arguments[0].text)
    ) {
      if (
        /^(?:node:)?https?$/.test(initializerCall.arguments[0].text) &&
        ts.isObjectBindingPattern(node.name)
      ) {
        for (const element of node.name.elements) {
          if (!ts.isBindingElement(element)) continue;
          const imported = element.propertyName;
          if (
            !imported ||
            (ts.isIdentifier(imported) &&
              ["request", "get", "Agent", "ClientRequest"].includes(imported.text))
          ) {
            addBindingPattern(element.name);
          }
        }
      } else {
        addBindingPattern(node.name);
      }
    }
    ts.forEachChild(node, visitDynamicBindings);
  };
  visitDynamicBindings(sf);
  // Follow the common `const request = fetch` / `const request = http.request`
  // spelling without attempting to infer arbitrary higher-order callbacks.
  let changed = true;
  while (changed) {
    changed = false;
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        (ts.isIdentifier(node.initializer) && bindings.has(node.initializer.text) ||
          ts.isPropertyAccessExpression(node.initializer) &&
            ts.isIdentifier(node.initializer.expression) &&
            (bindings.has(node.initializer.expression.text) ||
              (node.initializer.expression.text === "globalThis" &&
                node.initializer.name.text === "fetch")))
      ) {
        if (!bindings.has(node.name.text)) {
          bindings.add(node.name.text);
          changed = true;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return bindings;
}

function isTransportModule(moduleName: string): boolean {
  return (
    TRANSPORT_SDK_MODULES.some(
      (name) => moduleName === name || moduleName.startsWith(`${name}/`),
    ) ||
    /^(?:node:)?https?$/.test(moduleName) ||
    moduleName.startsWith("@aws-sdk/")
  );
}

function dynamicModuleCall(expression: ts.Expression): ts.CallExpression | undefined {
  let current: ts.Expression = expression;
  while (
    ts.isAwaitExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  if (!ts.isCallExpression(current)) return undefined;
  if (
    current.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(current.expression) && current.expression.text === "require")
  ) {
    return current;
  }
  return undefined;
}

const TRANSPORT_METHODS = new Set([
  "fetch",
  "goto",
  "pdf",
  "access",
  "uploadFrom",
  "downloadTo",
  "getAuthToken",
  "discovery",
  "refreshTokenGrant",
]);
const BOUND_TRANSPORT_METHODS = new Set(["request", "get", "post", "put", "delete"]);

/**
 * One syntax detector shared by the unlisted-module, listed-module, and
 * registered-plugin rules.  It follows import/require/dynamic-import aliases
 * and marks both the package load and the eventual call.  The older marker
 * strings remain useful for endpoint-only diagnostics; transport reachability
 * itself must never depend on a hand-maintained identifier list.
 */
function transportNodes(sf: ts.SourceFile): Set<ts.Node> {
  const bindings = importedTransportBindings(sf);
  const nodes = new Set<ts.Node>();
  const rootIdentifier = (expression: ts.Expression): string | undefined => {
    let current = expression;
    while (ts.isPropertyAccessExpression(current)) current = current.expression;
    return ts.isIdentifier(current) ? current.text : undefined;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        (callee.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(callee) && callee.text === "require")) &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0]) &&
        isTransportModule(node.arguments[0].text)
      ) nodes.add(node);
      const text = callee.getText(sf);
      const method = ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
      const root = rootIdentifier(callee);
      if (
        OUTBOUND_CALLS.includes(text) ||
        (ts.isIdentifier(callee) && bindings.has(callee.text)) ||
        (method &&
          ((TRANSPORT_METHODS.has(method) &&
            (root === undefined || bindings.has(root) || root === "globalThis")) ||
            (BOUND_TRANSPORT_METHODS.has(method) && root !== undefined && bindings.has(root))))
      ) {
        nodes.add(node);
      }
    }
    if (ts.isNewExpression(node)) {
      const expression = node.expression;
      if (ts.isIdentifier(expression) && bindings.has(expression.text)) nodes.add(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return nodes;
}

function hasTransportMarker(sf: ts.SourceFile): boolean {
  const bindings = importedTransportBindings(sf);
  let found = false;
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const moduleName = statement.moduleSpecifier.text;
    if (
      TRANSPORT_SDK_MODULES.some(
        (name) => moduleName === name || moduleName.startsWith(`${name}/`),
      ) ||
      /^(?:node:)?https?$/.test(moduleName) ||
      moduleName.startsWith("@aws-sdk/")
    ) {
      return true;
    }
  }
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && bindings.has(node.expression.text)) {
        found = true;
        return;
      }
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        (node.expression.name.text === "goto" ||
          node.expression.name.text === "pdf" ||
          node.expression.name.text === "send" ||
          node.expression.name.text === "request") &&
        ts.isIdentifier(node.expression.expression) &&
        bindings.has(node.expression.expression.text)
      ) {
        found = true;
        return;
      }
    }
    if (
      ts.isStringLiteral(node) &&
      /^https?:\/\//.test(node.text) &&
      !node.text.includes("localhost")
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function isWcVendorRegistration(node: ts.CallExpression, sf: ts.SourceFile): boolean {
  return calleeText(node, sf).split(".").pop() === "registerWcVendorPlugin";
}

/**
 * Every plugin that registers a vendor and contains a visible transport must
 * have a handler reachability specification.  A row in the hand-maintained
 * map is still useful for unusual containers and identifiers, but absence is
 * never treated as "there is nothing to audit".
 */
function discoverTransportBearingPlugins(files: string[]): string[] {
  return files.filter((file) => {
    if (!file.startsWith(WC_VENDOR_PLUGIN_PREFIX) || !file.endsWith(".ts")) return false;
    const sf = parse(file);
    let registers = false;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && isWcVendorRegistration(node, sf)) registers = true;
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return registers && hasTransportMarker(sf);
  });
}

/**
 * The handler functions declared in a `{ x: { <prop>() {} } }` map.
 *
 * A map is found by the name it is written under, whether that is a property
 * of the plugin literal (`operations: { … }`) or a variable the literal
 * spreads in (`const remote = { … }`). Both are the same thing to the
 * registrar, and only one of them is a property.
 */
function handlersInContainer(
  sf: ts.SourceFile,
  containers: string[],
  property: string,
): FunctionLike[] {
  const handlers: FunctionLike[] = [];
  const declared = declaredFunctions(sf);

  const collect = (map: ts.ObjectLiteralExpression): void => {
    for (const entry of map.properties) {
      if (!ts.isPropertyAssignment(entry)) continue;
      if (!ts.isObjectLiteralExpression(entry.initializer)) continue;
      for (const prop of entry.initializer.properties) {
        if (!prop.name || !ts.isIdentifier(prop.name)) continue;
        if (prop.name.text !== property) continue;
        const value: ts.Node = ts.isPropertyAssignment(prop) ? prop.initializer : prop;
        if (isFunctionLike(value)) {
          handlers.push(value);
        } else if (ts.isIdentifier(value)) {
          // Most plugins keep a named handler outside the operation literal
          // (`run: lookupDistricts`).  It is still the registered function,
          // not an unregistered helper.
          handlers.push(...(declared.get(value.text) ?? []));
        }
      }
    }
  };

  /** `{ … }`, or the same behind a `satisfies`/`as` the declaration may carry. */
  const objectLiteral = (node: ts.Expression | undefined): ts.ObjectLiteralExpression | undefined => {
    let current = node;
    while (
      current &&
      (ts.isSatisfiesExpression(current) ||
        ts.isAsExpression(current) ||
        ts.isParenthesizedExpression(current))
    ) {
      current = current.expression;
    }
    return current && ts.isObjectLiteralExpression(current) ? current : undefined;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      if (containers.includes(node.name.text)) {
        const map = objectLiteral(node.initializer);
        if (map) collect(map);
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (containers.includes(node.name.text)) {
        const map = objectLiteral(node.initializer);
        if (map) collect(map);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return handlers;
}

/** Rule 3: in a plugin module, only registered handlers reach the vendor. */
function auditHandlersOnFramework(file: string): Violation[] {
  return auditHandlersOnFrameworkSource(file, parse(file));
}

function auditHandlersOnFrameworkSource(
  file: string,
  sf: ts.SourceFile,
  specOverride?: {
    handlerContainers: string[];
    handlerProperty: string;
    vendorIdentifiers: string[];
  },
): Violation[] {
  const spec = specOverride ?? HANDLERS_ON_FRAMEWORK[file];
  if (!spec) return [];
  const containers = spec.handlerContainers.map((c) => `\`${c}\``).join(" / ");
  const handlers = handlersInContainer(sf, spec.handlerContainers, spec.handlerProperty);

  if (handlers.length === 0) {
    return [
      {
        file,
        line: 1,
        detail:
          `is listed in HANDLERS_ON_FRAMEWORK but declares no ` +
          `${containers} handlers, so the rule checks nothing`,
        remedy:
          `Either the handlers moved — point handlerContainers/handlerProperty at where ` +
          `they are now — or this module no longer reaches the vendor through registered ` +
          `handlers, in which case remove the entry and put its outbound calls under rule 1.`,
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
        `module top level reaches the vendor (${identifier}), where no framework request can reach it`,
      remedy:
        `Only the ${containers} handlers are run by the web client framework. ` +
        `Move the work into an operation handler, or into a helper one of them calls.`,
    });
  }

  // The handlers, plus what they delegate to: the only functions the framework
  // ever runs.
  const registered = functionsReachableFrom(sf, handlers);

  for (const fn of vendorReaching) {
    if (registered.has(fn)) continue;
    violations.push({
      file,
      line: lineOf(sf, fn),
      detail:
        `${nameOf(fn, sf)}() reaches the vendor but is not reachable from the ` +
        `${containers} handlers, so nothing puts it on the web client framework`,
      remedy:
        `Registration hands the framework the ${containers} handlers and, through them, ` +
        `what they call — and nothing else. A call from here is not refused during ` +
        `maintenance and is not counted. Move the work into an operation handler, or into ` +
        `a helper one of them calls.`,
    });
  }

  violations.push(...auditRawPluginNotExported(sf, file, spec.handlerContainers));
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
  const transports = transportNodes(sf);

  const visit = (node: ts.Node): void => {
    const pushed = isFunctionLike(node);
    if (pushed) stack.push(node);

    if (transports.has(node)) {
      const identifier = node.getText(sf);
      if (stack.length === 0) {
        topLevel.push({ line: lineOf(sf, node), identifier });
      }
      for (const fn of stack) vendorReaching.add(fn);
    }

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
 * The runnable handlers must not leave the file.
 *
 * What registration hands to the registry describes the operations and cannot
 * run them; the literals the file declares still hold the real handlers. An
 * exported one republishes every operation as something a caller can invoke
 * directly — no refusal, no write gate, no count — and it does so without
 * naming the vendor anywhere, which is why the check above cannot see it.
 *
 * Both the plugin literal and any map it spreads in are covered: a handler is
 * just as reachable through the map it was written in.
 */
function auditRawPluginNotExported(
  sf: ts.SourceFile,
  file: string,
  handlerContainers: string[],
): Violation[] {
  const violations: Violation[] = [];
  const remedy =
    `The registry is the only supported handle on this plugin, and what it hands out cannot ` +
    `be run — the framework holds the handlers. An exported literal is the same operations ` +
    `with nothing in front of them, so keep it local to this file.`;

  // The names bound to a literal holding runnable handlers: the plugin itself,
  // recognized by the container property it declares, and each handler map.
  const raw = new Map<string, ts.VariableDeclaration>();
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      let init = declaration.initializer;
      while (
        init &&
        (ts.isSatisfiesExpression(init) ||
          ts.isAsExpression(init) ||
          ts.isParenthesizedExpression(init))
      ) {
        init = init.expression;
      }
      if (!init || !ts.isObjectLiteralExpression(init)) continue;
      if (!ts.isIdentifier(declaration.name)) continue;
      const isHandlerMap = handlerContainers.includes(declaration.name.text);
      const declares = init.properties.some(
        (p) => p.name && ts.isIdentifier(p.name) && handlerContainers.includes(p.name.text),
      );
      if (isHandlerMap || declares) raw.set(declaration.name.text, declaration);
    }
  }
  if (raw.size === 0) return violations;

  const report = (node: ts.Node, name: string, how: string): void => {
    violations.push({
      file,
      line: lineOf(sf, node),
      detail: `${how} ${name}, which holds the handlers as written, runnable by anyone`,
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
function transportReachability(sf: ts.SourceFile): {
  reaching: Set<FunctionLike>;
  topLevel: Array<{ line: number; identifier: string }>;
} {
  const declared = declaredFunctions(sf);
  const reaching = new Set<FunctionLike>();
  const topLevel: Array<{ line: number; identifier: string }> = [];
  const callers = new Map<string, Set<FunctionLike>>();
  const topLevelCalls = new Map<string, number>();
  const stack: FunctionLike[] = [];
  const transports = transportNodes(sf);

  const visit = (node: ts.Node): void => {
    const pushed = isFunctionLike(node);
    if (pushed) stack.push(node);

    if (transports.has(node)) {
      if (stack.length === 0) {
        topLevel.push({ line: lineOf(sf, node), identifier: node.getText(sf) });
      } else {
        // Seed only the function which owns the transport. Callers are added
        // by the backwards call-graph pass below, where each caller must earn
        // its own exemption. This avoids treating an unrelated inline callback
        // argument as a caller merely because it shares an enclosing body.
        reaching.add(stack[stack.length - 1]);
      }
    }

    if (ts.isCallExpression(node)) {
      const bareName = calleeText(node, sf).split(".").pop() ?? calleeText(node, sf);
      if (stack.length === 0 && !topLevelCalls.has(bareName)) {
        topLevelCalls.set(bareName, lineOf(sf, node));
      }
      let set = callers.get(bareName);
      if (!set) callers.set(bareName, (set = new Set()));
      for (const fn of stack) set.add(fn);
    }

    ts.forEachChild(node, visit);
    if (pushed) stack.pop();
  };
  visit(sf);

  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, fns] of callers) {
      const targets = declared.get(name) ?? [];
      if (!targets.some((target) => reaching.has(target))) continue;
      for (const fn of fns) {
        if (!reaching.has(fn)) {
          reaching.add(fn);
          grew = true;
        }
      }
      const line = topLevelCalls.get(name);
      if (line !== undefined && !topLevel.some((entry) => entry.line === line)) {
        topLevel.push({ line, identifier: name });
      }
    }
  }

  return { reaching, topLevel };
}

function auditOutboundModule(file: string): Violation[] {
  return auditOutboundSource(file, parse(file), OFF_FRAMEWORK_FUNCTIONS[file] ?? {});
}

function auditOutboundSource(
  file: string,
  sf: ts.SourceFile,
  exemptions: Record<string, string>,
): Violation[] {
  const underFramework = functionsUnderFramework(sf);
  const violations: Violation[] = [];
  const { reaching, topLevel } = transportReachability(sf);

  for (const { line, identifier } of topLevel) {
    violations.push({
      file,
      line,
      detail:
        `module top level reaches an outbound transport (${identifier}), where no framework ` +
        `request can reach it`,
      remedy:
        `Move the call under a ${FRAMEWORK_CALLS.join("/")} callback. If it genuinely must ` +
        `not go through the framework, put the owning function in OFF_FRAMEWORK_FUNCTIONS ` +
        `with a reason (module top level cannot be exempted).`,
    });
  }
  for (const fn of reaching) {
    const owner = nameOf(fn, sf);
    if (underFramework.has(fn) || exemptions[owner]) continue;
    violations.push({
      file,
      line: lineOf(sf, fn),
      detail:
        `${owner}() reaches an outbound transport but does not go through the web client ` +
        `framework`,
      remedy:
        `Register the operation (registerWcRequest for a cacheable answer, ` +
        `registerUncachedWcRequest for one that must never be replayed) and make the call ` +
        `inside the \`${FRAMEWORK_WORK_PROPERTY}:\` callback of ${FRAMEWORK_CALLS.join("/")}. ` +
        `If it genuinely must not go through the framework, name ${owner} in ` +
        `OFF_FRAMEWORK_FUNCTIONS with the reason. Exempting a callee does not exempt callers.`,
    });
  }
  return violations;
}

export function findViolations(): Violation[] {
  const all = listWorkingTreeFiles();
  const present = new Set(all);
  const scanned = all.filter(isScanned);
  const transportPlugins = discoverTransportBearingPlugins(scanned);

  const violations = auditModuleList(present);
  for (const module of OUTBOUND_MODULES) {
    if (present.has(module)) violations.push(...auditOutboundModule(module));
  }
  for (const module of Object.keys(HANDLERS_ON_FRAMEWORK)) {
    if (present.has(module)) violations.push(...auditHandlersOnFramework(module));
  }
  for (const module of transportPlugins) {
    if (HANDLERS_ON_FRAMEWORK[module]) continue;
    violations.push({
      file: module,
      line: 1,
      detail:
        "registers a wc vendor and contains an outbound transport, but has no " +
        "HANDLERS_ON_FRAMEWORK reachability specification",
      remedy:
        "Add a handlerContainers/handlerProperty/vendorIdentifiers row to " +
        "HANDLERS_ON_FRAMEWORK. Missing coverage fails closed so a new transport-bearing " +
        "plugin cannot silently evade the handler audit.",
    });
  }
  violations.push(...auditUnlistedVendorModules(scanned));
  violations.push(...auditFrameworkOnlyImports(scanned));
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

/** Focused fixture hooks used by the architecture tests. */
export function findTransportCallTexts(source: string): string[] {
  const sf = ts.createSourceFile(
    "transport-fixture.ts",
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );
  return [...transportNodes(sf)].map((node) => node.getText(sf));
}

export function auditWcVendorHandlerFixture(
  source: string,
  spec: {
    handlerContainers: string[];
    handlerProperty: string;
    vendorIdentifiers: string[];
  },
): Violation[] {
  const sf = ts.createSourceFile(
    "wc-vendor-handler-fixture.ts",
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );
  return auditHandlersOnFrameworkSource("wc-vendor-handler-fixture.ts", sf, spec);
}

export function auditListedTransportFixture(
  source: string,
  exemptions: Record<string, string>,
): Violation[] {
  const sf = ts.createSourceFile(
    "listed-transport-fixture.ts",
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );
  return auditOutboundSource("listed-transport-fixture.ts", sf, exemptions);
}

// Only run when executed directly (tests may import findViolations).
if (process.argv[1] && /check-maintenance-guards\.ts$/.test(process.argv[1])) {
  main();
}
