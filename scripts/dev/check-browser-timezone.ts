#!/usr/bin/env tsx
/**
 * Check Browser Time Zone Reads
 *
 * This site has exactly two time zones: SYSTEM time (the zone the server runs
 * in — what a stored timestamp means) and USER time (the zone a person is
 * shown dates in). Which one a person gets is decided in one place,
 * `resolveEffectiveTimeZone` in `shared/utils/timezone.ts`: system time when
 * the site has personal zones switched off, otherwise the zone they chose,
 * otherwise the zone their browser reports.
 *
 * The browser's zone is an INPUT to that last case. It is not a third zone,
 * and no screen should present it as one. That is not a style preference — it
 * is the defect this rule was written after. Two surfaces had each grown their
 * own clock reading the browser's zone: one labelled it "your time zone" and
 * the other "this browser". With personal zones off — the default — the first
 * was simply false (that zone governs nothing), the second was true but
 * useless, and the two screens contradicted each other about the same fact.
 *
 * The failure is invisible in review: a browser-zone read type-checks,
 * renders, and produces a real zone name that looks entirely plausible beside
 * the site's. It is only wrong in what it CLAIMS. So the read is confined to
 * the few places that genuinely need it, listed below with their reasons, and
 * every other file in browser code is refused.
 *
 * What is banned is asking where this browser is:
 *
 *  - `getBrowserTimeZone()` from `@/lib/display-timezone`;
 *  - `getRuntimeTimeZone()` from `@shared/utils/timezone`, which is the same
 *    question asked of the runtime directly;
 *  - a raw `Intl.DateTimeFormat(…).resolvedOptions()` with no `timeZone` in
 *    its arguments, which is what both of those wrap, and the way around
 *    them — whatever locale is passed alongside.
 *
 * What is NOT banned, and is how a screen shows a date: `useAuth()`'s
 * `displayTimeZone` (user time, already resolved), the site's own
 * `systemTimeZone`, and the formatters in `@/lib/date-format`, which are
 * redirected at user time for you.
 *
 * Scope is browser code only. The server has one zone by definition, and
 * `shared/` holds the resolver itself.
 *
 * Like scripts/dev/check-date-formatting.ts, this scans the CURRENT working
 * tree — tracked AND untracked files — so a brand-new screen cannot dodge the
 * check before its first commit.
 *
 * Run with:  npx tsx scripts/dev/check-browser-timezone.ts
 *
 * Exits 0 on pass, 1 on violations.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

/** Where the browser's own zone is defined, and the only module that may. */
const OWNER_MODULE = "client/src/lib/display-timezone.ts";

const SCANNED_PREFIXES = ["client/"];
const SCANNED_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

/**
 * The files allowed to ask where the browser is. Each entry is a REASON, not a
 * grandfathering: adding one means arguing that the file is part of resolving
 * user time, or is the one surface that must name the browser's zone out loud.
 */
const EXEMPT_FILES = new Map<string, string>([
  [
    OWNER_MODULE,
    "defines the value: captures the browser's zone at load, before the " +
      "formatters are redirected, and owns the redirection itself",
  ],
  [
    "client/src/contexts/AuthContext.tsx",
    "feeds it to the resolver as the third input, and seeds pre-auth state " +
      "with it; the resolution rule stays in shared/utils/timezone.ts",
  ],
  [
    "client/src/lib/date-format.ts",
    "skips the zone shift entirely when user time IS the browser's zone, " +
      "which is the common case and must stay allocation-free",
  ],
  [
    "client/src/components/timezone/TimeZoneList.tsx",
    'the picker\'s "automatic" row, which has to say what automatic would ' +
      "resolve to or the option is a promise about an invisible value",
  ],
  [
    "scripts/dev/check-browser-timezone.ts",
    "this rule: needs the literal patterns to search for",
  ],
]);

/** A banned way of asking where this browser is. */
interface BannedForm {
  /** What to search for, as a source-text pattern. */
  pattern: RegExp;
  /** How the message names it. */
  label: string;
  /**
   * Given the match, whether it is genuinely a violation. Absent means every
   * match is one.
   */
  isViolation?: (match: RegExpExecArray) => boolean;
}

const BANNED_FORMS: BannedForm[] = [
  { pattern: /\bgetBrowserTimeZone\b/g, label: "getBrowserTimeZone()" },
  { pattern: /\bgetRuntimeTimeZone\b/g, label: "getRuntimeTimeZone()" },
  {
    // Constructing a formatter and then asking it what zone it settled on.
    // With no `timeZone` in the arguments, that answer IS the runtime's own
    // zone however the constructor was called — `DateTimeFormat()`,
    // `DateTimeFormat("en-US")` and `DateTimeFormat(undefined, { … })` are
    // the same question, so matching only the empty-argument spelling would
    // leave the rule trivially side-stepped by adding a locale.
    //
    // A formatter given an explicit `timeZone` is left alone: it is a
    // renderer, and reading back the zone it was handed tells nobody where
    // the browser is. The argument text is scanned rather than parsed, so one
    // nested level of parens is tolerated and anything deeper is refused
    // (below) rather than silently passed.
    pattern:
      /Intl\s*\.\s*DateTimeFormat\s*\(((?:[^()]|\([^()]*\))*)\)\s*\.\s*resolvedOptions\s*\(\s*\)/g,
    label: "Intl.DateTimeFormat(…).resolvedOptions()",
    isViolation: (match) => !/\btimeZone\b/.test(match[1] ?? ""),
  },
];

export interface Violation {
  file: string;
  line: number;
  form: string;
  text: string;
}

/** Blank out comments, preserving offsets, so prose about the rule is not a hit. */
function blankComments(source: string): string {
  return source
    .replace(/\/\*[^]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead: string) => lead + " ".repeat(m.length - lead.length));
}

export function findViolationsInSource(file: string, source: string): Violation[] {
  const violations: Violation[] = [];
  const blanked = blankComments(source);
  const lines = source.split("\n");
  const lineOf = (index: number) => blanked.slice(0, index).split("\n").length;

  for (const form of BANNED_FORMS) {
    form.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = form.pattern.exec(blanked)) !== null) {
      if (form.isViolation && !form.isViolation(m)) continue;
      const line = lineOf(m.index);
      violations.push({
        file,
        line,
        form: form.label,
        text: (lines[line - 1] ?? "").trim().slice(0, 140),
      });
    }
  }

  return violations.sort((a, b) => a.line - b.line);
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
  // The exemptions are the rule's argument, so a stale one is a real failure:
  // a file that has moved leaves its read unguarded while the list still says
  // it is accounted for.
  const missing = [...EXEMPT_FILES.keys()].filter((f) => !existsSync(f));
  if (missing.length > 0) {
    console.error(
      `\n[check-browser-timezone] FAILED — exempt file(s) no longer exist: ${missing.join(", ")}.\n\n` +
        `Update EXEMPT_FILES in scripts/dev/check-browser-timezone.ts, with the reason\n` +
        `the new location needs the browser's own zone.\n`,
    );
    process.exit(1);
  }

  const files = listWorkingTreeFiles().filter(isScanned);
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
        `\n[check-browser-timezone] FAILED — could not read ${file}: ${(error as Error).message}\n`,
      );
      process.exit(1);
    }
    violations.push(...findViolationsInSource(file, content));
  }

  if (violations.length === 0) {
    console.log(
      `[check-browser-timezone] OK — no browser code asks where the browser is ` +
        `(${files.length} files scanned, ${EXEMPT_FILES.size} exempt).`,
    );
    process.exit(0);
  }

  console.error(
    [
      "",
      "[check-browser-timezone] FAILED",
      "",
      "Browser code asks what time zone this browser is in.",
      "",
      "This site has two zones and only two: SYSTEM time (what stored dates mean)",
      "and USER time (what this person is shown). The browser's zone is an input",
      "to resolving user time — it is not a zone of its own, and a screen that",
      "shows it states something the reader cannot act on, or that governs nothing",
      "at all when the site has personal time zones switched off.",
      "",
      ...violations.map(
        (v) => `  ${v.file}:${v.line}  ${v.form}\n      ${v.text}`,
      ),
      "",
      "To render a date or a clock, use what is already resolved:",
      "",
      "  const { timezone, displayTimeZone } = useAuth();",
      "    displayTimeZone        → user time, the zone dates are shown in",
      "    timezone.systemTimeZone → system time",
      "",
      "For the words to describe either one, use describeTimeZones() in",
      "client/src/components/timezone/zone-vocabulary.ts, which both clock",
      "surfaces render from.",
      "",
      "If a new surface genuinely must name where the browser is, add it to",
      "EXEMPT_FILES in scripts/dev/check-browser-timezone.ts with the reason.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

// Only run when executed directly (tests may import the helpers).
if (process.argv[1] && /check-browser-timezone\.ts$/.test(process.argv[1])) {
  main();
}
