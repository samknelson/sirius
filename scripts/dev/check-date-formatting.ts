#!/usr/bin/env tsx
/**
 * Check Browser Date Formatting
 *
 * A person can be shown dates in a zone that is not their browser's — the site
 * zone, or one they picked themselves. Two mechanisms deliver that, and between
 * them they cover every date on screen WITHOUT the screen having to know:
 *
 *  - the platform's own locale formatters (`Intl.DateTimeFormat`, the
 *    `toLocale*String` date methods) are redirected once, at the browser entry
 *    point, by `client/src/lib/display-timezone.ts`;
 *  - `date-fns` `format` CANNOT be redirected that way. It reads a Date's raw
 *    local field getters instead of going through `Intl`, and those getters
 *    must not be patched — the library round-trips through them internally, so
 *    redirecting them would corrupt `addDays`, `startOfDay` and every other
 *    piece of date arithmetic in the app.
 *
 * So the second half is a swap rather than a patch: browser code imports its
 * formatters from `@/lib/date-format`, which shifts the instant into the
 * display zone and then hands it to the library. This rule is what keeps that
 * true. Import `format` straight from `date-fns` in a new screen and every
 * date on it silently renders in the browser's zone while the rest of the site
 * renders in the chosen one — a wrong answer that looks entirely plausible,
 * and only to the people who chose a zone.
 *
 * The ban is FLAT: every `date-fns` export whose name begins with `format` is
 * refused in browser code, whether or not it happens to read local fields.
 * A list of exceptions would have to be re-judged every time the library gains
 * an export, and the failure it guards against is invisible. If browser code
 * needs a formatter that {@link ALLOWED_MODULE} does not export yet, add it
 * there — as a zone shift if it reads local fields, as a plain pass-through if
 * it does not (`formatDistanceToNow` is one of those).
 *
 * Arithmetic and parsing are untouched: `addDays`, `startOfDay`, `parseISO`,
 * `isValid`, `differenceIn*` are all zone-independent and are imported from
 * `date-fns` directly, as they always were.
 *
 * Scope is browser code only. `shared/` runs on both sides and cannot import a
 * client module, and the server formats in the system zone by definition.
 *
 * Like scripts/dev/check-theme-color-vars.ts, this scans the CURRENT working
 * tree — tracked AND untracked files — so a brand-new screen cannot dodge the
 * check before its first commit.
 *
 * Run with:  npx tsx scripts/dev/check-date-formatting.ts
 *
 * Exits 0 on pass, 1 on violations.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

/** The library whose formatters are off limits in browser code. */
const BANNED_PACKAGE = "date-fns";

/** Where browser code gets its formatters instead. */
const ALLOWED_MODULE = "@/lib/date-format";

const SCANNED_PREFIXES = ["client/"];
const SCANNED_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

/**
 * Narrow, documented exemptions. Add entries ONLY with a justification.
 */
const EXEMPT_FILES = new Set<string>([
  // The module every other file is required to use: it is the one place that
  // wraps the library's formatters, so it must import them.
  "client/src/lib/date-format.ts",
  // This check script itself: needs the literal patterns to search for.
  "scripts/dev/check-date-formatting.ts",
]);

export interface Violation {
  file: string;
  line: number;
  /** What was imported: a specifier name, or a description of the import form. */
  imported: string;
  text: string;
}

/** Blank out comments, preserving offsets, so a commented example is not a hit. */
function blankComments(source: string): string {
  return source
    .replace(/\/\*[^]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead: string) => lead + " ".repeat(m.length - lead.length));
}

/**
 * Every static import OR RE-EXPORT of `date-fns` (or one of its subpaths) in
 * `source`, as `{ clause, module, index }`. The clause is what sits between
 * the keyword and `from`; it is empty for a bare side-effect import.
 *
 * A re-export is matched for the same reason as an import: `export { format }
 * from "date-fns"` hands the unshifted formatter to every file that imports the
 * re-exporting module, and those files would then pass this rule cleanly.
 */
function findImports(source: string): { clause: string; module: string; index: number }[] {
  const found: { clause: string; module: string; index: number }[] = [];
  const pattern = new RegExp(
    // import|export <clause> from "date-fns[/sub]"  |  import "date-fns[/sub]"
    String.raw`(?:import|export)(?:\s+([^;]*?)\s+from)?\s*["'](${BANNED_PACKAGE}(?:/[^"']*)?)["']`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(source)) !== null) {
    found.push({ clause: (m[1] ?? "").trim(), module: m[2], index: m.index });
  }
  return found;
}

/**
 * Every RUNTIME reach for the package — `import("date-fns")`,
 * `require("date-fns")` — which the static forms above cannot see.
 *
 * There is no way to tell which export one of these is after, so the form
 * itself is refused. Nothing in this codebase loads a date library lazily, and
 * the only reason to start would be to get around this rule.
 */
function findDynamicAccess(source: string): { form: string; index: number }[] {
  const found: { form: string; index: number }[] = [];
  const pattern = new RegExp(
    String.raw`\b(import|require)\s*\(\s*["'](${BANNED_PACKAGE}(?:/[^"']*)?)["']`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(source)) !== null) {
    found.push({ form: `${m[1]}("${m[2]}")`, index: m.index });
  }
  return found;
}

/**
 * True for a clause that re-exports the WHOLE package — `export * from`, or
 * `export * as dates from`. Neither binds a name locally, so the specifier
 * scan below never sees the formatters they pass along.
 */
function isStarExport(clause: string, source: string, index: number): boolean {
  if (!source.slice(index).startsWith("export")) return false;
  return clause === "*" || /^\*\s+as\s+\S+$/.test(clause);
}

/** Split a named-import clause into its bound specifiers' SOURCE names. */
function namedSpecifiers(clause: string): string[] {
  const braces = clause.match(/\{([^}]*)\}/);
  if (!braces) return [];
  return braces[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    // `format as fmt` is still an import of `format`.
    .map((s) => s.replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim())
    .filter(Boolean);
}

/** Is this a formatter — i.e. off limits in browser code? */
export function isBannedName(name: string): boolean {
  return /^format/.test(name);
}

export function findViolationsInSource(file: string, source: string): Violation[] {
  const violations: Violation[] = [];
  const blanked = blankComments(source);
  const lines = source.split("\n");
  const lineOf = (index: number) => blanked.slice(0, index).split("\n").length;
  const textAt = (line: number) => (lines[line - 1] ?? "").trim().slice(0, 140);

  for (const imp of findImports(blanked)) {
    const line = lineOf(imp.index);

    // A subpath import addresses one export by path (`date-fns/format`), so the
    // path itself names what is being imported.
    const subpath = imp.module.slice(BANNED_PACKAGE.length + 1);
    if (subpath && isBannedName(subpath)) {
      violations.push({ file, line, imported: imp.module, text: textAt(line) });
      continue;
    }

    // A namespace or default import puts every export within reach, so there
    // is no way to tell whether a formatter is used — refuse the form.
    if (/(^|[,{]\s*)\*\s+as\s+/.test(imp.clause) || /^[A-Za-z_$][\w$]*\s*(,|$)/.test(imp.clause)) {
      violations.push({
        file,
        line,
        imported: `${imp.clause} (whole-module import)`,
        text: textAt(line),
      });
      continue;
    }

    if (isStarExport(imp.clause, blanked, imp.index)) {
      violations.push({
        file,
        line,
        imported: `${imp.clause} (whole-module re-export)`,
        text: textAt(line),
      });
      continue;
    }

    for (const name of namedSpecifiers(imp.clause)) {
      if (isBannedName(name)) {
        violations.push({ file, line, imported: name, text: textAt(line) });
      }
    }
  }

  for (const dynamic of findDynamicAccess(blanked)) {
    const line = lineOf(dynamic.index);
    violations.push({ file, line, imported: dynamic.form, text: textAt(line) });
  }

  return violations;
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
  if (!SCANNED_EXTENSIONS.some((e) => file.endsWith(e))) return false;
  if (EXEMPT_FILES.has(file)) return false;
  return true;
}

function main(): void {
  const files = listWorkingTreeFiles().filter(isScanned);

  // The allowed module has to exist, or every file would be told to import
  // from somewhere that is not there and the rule would be nonsense.
  if (!existsSync("client/src/lib/date-format.ts")) {
    console.error(
      `\n[check-date-formatting] FAILED — client/src/lib/date-format.ts is missing.\n\nThis rule redirects browser code to that module. If it moved, update\nALLOWED_MODULE and EXEMPT_FILES in scripts/dev/check-date-formatting.ts.\n`,
    );
    process.exit(1);
  }

  const violations: Violation[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch (error) {
      // A tracked file git listed but that is gone from the working tree is
      // nothing to check. Anything else means the rule silently skipped a file
      // it was asked to check, which is a failure, not a pass.
      if (!existsSync(file)) continue;
      console.error(
        `\n[check-date-formatting] FAILED — could not read ${file}: ${(error as Error).message}\n`,
      );
      process.exit(1);
    }
    violations.push(...findViolationsInSource(file, content));
  }

  if (violations.length === 0) {
    console.log(
      `[check-date-formatting] OK — browser code formats dates through ${ALLOWED_MODULE} (${files.length} files scanned).`,
    );
    process.exit(0);
  }

  console.error(
    [
      "",
      "[check-date-formatting] FAILED",
      "",
      `Browser code imports a formatter from "${BANNED_PACKAGE}" directly.`,
      "",
      "Dates on screen render in the viewer's effective time zone, which is not",
      "necessarily the browser's. The platform's own formatters are redirected",
      `globally, but ${BANNED_PACKAGE} \`format\` reads a Date's raw local fields and`,
      "cannot be — so it is wrapped instead, and browser code uses the wrapper.",
      "",
      `Import it from "${ALLOWED_MODULE}" instead. Same arguments.`,
      "",
      ...violations.map(
        (v) =>
          `  ${v.file}:${v.line}  ${v.imported}\n` +
          `      ${v.text}\n` +
          `      → import { ${v.imported.split(" ")[0]} } from "${ALLOWED_MODULE}"`,
      ),
      "",
      "Arithmetic and parsing are NOT affected: addDays, startOfDay, parseISO,",
      `isValid, differenceIn* and friends stay on "${BANNED_PACKAGE}" — they are the same`,
      "in every zone, and shifting their inputs would corrupt them.",
      "",
      `If ${ALLOWED_MODULE} does not export the formatter you need, add it there`,
      "rather than reaching around it.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

// Only run when executed directly (tests may import the helpers).
if (process.argv[1] && /check-date-formatting\.ts$/.test(process.argv[1])) {
  main();
}
