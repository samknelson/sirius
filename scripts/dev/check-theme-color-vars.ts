#!/usr/bin/env tsx
/**
 * Check Theme Colour Variable Usage
 *
 * This project's theme variables hold a WHOLE colour:
 *
 *     --chart-1: hsl(221 83% 53%);
 *
 * The widely-copied shadcn/ui examples assume the opposite convention, where
 * the variable holds only the channel values (`221 83% 53%`) and every call
 * site wraps it — `hsl(var(--chart-1))` — to make a colour out of it. Paste
 * one of those examples into this codebase and you get a colour nested inside
 * a colour:
 *
 *     --color-calls: hsl(hsl(221 83% 53%));
 *
 * Which is the quietest possible failure. A custom property accepts almost any
 * token sequence, so nothing complains when it is declared; the value is only
 * rejected later, when it is substituted into `stroke` or `color`, and a
 * property that is invalid at computed-value time is simply dropped. Neither
 * the type checker nor the browser console says a word. The stats chart at
 * /admin/wc/stats shipped this way and drew its grid, its axes and its tooltip
 * perfectly while the line itself was never painted at all — the page looked
 * like it had no data, and the data was fine.
 *
 * So: a theme colour variable is named as-is. `var(--chart-1)`, never
 * `hsl(var(--chart-1))`.
 *
 * Which variables count is read from the stylesheet rather than hardcoded, so
 * the rule follows the theme. If a variable is ever redefined to hold bare
 * channel values, wrapping it becomes correct and this check stops objecting
 * to it on its own.
 *
 * Two things worth knowing before you argue with a result:
 *
 *  - A variable is only covered if this script can recognise its declared
 *    value as a whole colour. Declare a theme colour in some form not listed
 *    in COLOR_FUNCTIONS and the variable quietly stops being checked — add the
 *    form rather than assuming the silence means agreement.
 *  - Comments are not exempt, matching scripts/dev/check-env-registry.ts. A
 *    comment that needs to spell out the forbidden form belongs in
 *    EXEMPT_FILES, so the exemption is visible.
 *
 * Like scripts/dev/check-html-utils.ts, this scans the CURRENT working tree —
 * tracked AND untracked files — so a brand-new file cannot dodge the check
 * before its first commit.
 *
 * Run with:  npx tsx scripts/dev/check-theme-color-vars.ts
 *
 * Exits 0 on pass, 1 on violations.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

/** The stylesheet that defines the theme. */
const THEME_STYLESHEET = "client/src/index.css";

const SCANNED_PREFIXES = ["client/", "server/", "shared/", "scripts/"];
const SCANNED_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css"];

/**
 * Narrow, documented exemptions. Add entries ONLY with a justification.
 */
const EXEMPT_FILES = new Set<string>([
  // This check script itself: needs the literal patterns to search for.
  "scripts/dev/check-theme-color-vars.ts",
]);

/** CSS functions that produce a colour, and so must not be handed one. */
const COLOR_FUNCTIONS = [
  "hsl",
  "hsla",
  "rgb",
  "rgba",
  "hwb",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "color",
  "color-mix",
  "light-dark",
];

/**
 * CSS whitespace, which may include comments. Written out because
 * `hsl(/* note *​/ var(--chart-1))` and a prettier-wrapped
 * `hsl(\n  var(--chart-1)\n)` are the same mistake as the one-line form, and a
 * plain `\s*` walks straight past both.
 */
const WS = String.raw`(?:\s|/\*[^]*?\*/)*`;

/** Replace comments with equivalent-length blanks, preserving offsets. */
function blankComments(source: string): string {
  return source.replace(/\/\*[^]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

/**
 * Is this declaration value a complete colour on its own?
 *
 * True for `hsl(221 83% 53%)` and `#1d4ed8`. False for `221 83% 53%` (bare
 * channels, which a call site is SUPPOSED to wrap), for `8px`, and for
 * `0px 2px 0px 0px hsl(221 83% 53% / 0)` — a shadow merely containing a
 * colour, which is not one.
 */
export function isWholeColor(value: string): boolean {
  const v = value.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return true;

  const open = v.indexOf("(");
  if (open === -1 || !COLOR_FUNCTIONS.includes(v.slice(0, open).toLowerCase())) {
    return false;
  }
  // The function must span the entire value: one call, nothing before or
  // after it.
  let depth = 0;
  for (let i = open; i < v.length; i++) {
    if (v[i] === "(") depth++;
    else if (v[i] === ")") {
      depth--;
      if (depth === 0) return i === v.length - 1;
    }
  }
  return false;
}

/**
 * The theme variables that already hold a whole colour.
 *
 * A variable declared in both the light and dark blocks is included when
 * EITHER declaration is a whole colour: the wrapping is written once at the
 * call site and applies under both themes, so one whole-colour declaration is
 * enough to make it wrong.
 */
export function wholeColorVars(css: string): Set<string> {
  const names = new Set<string>();
  // Comments are blanked first so a commented-out or illustrative declaration
  // cannot register a variable.
  const declaration = /(--[A-Za-z0-9_-]+)\s*:\s*([^;}]+)/g;
  let m: RegExpExecArray | null;
  while ((m = declaration.exec(blankComments(css))) !== null) {
    if (isWholeColor(m[2])) names.add(m[1]);
  }
  return names;
}

interface Violation {
  file: string;
  line: number;
  variable: string;
  fn: string;
  text: string;
}

/** Every `<colour-function>(var(--theme-colour))` in the given files. */
export function findViolations(files: string[], vars: Set<string>): Violation[] {
  const violations: Violation[] = [];
  // The lookbehind rejects a longer identifier ending in these letters
  // (`--brand-hsl(`) without rejecting `_`, which Tailwind uses in place of a
  // space inside an arbitrary value: `shadow-[0_0_0_1px_hsl(var(--border))]`
  // is one of the real shapes this rule exists to catch, and a `\b` here would
  // walk straight past it.
  //
  // Matched against whole file content rather than line by line, so a wrapper
  // broken across lines by a formatter is caught too.
  const wrapped = new RegExp(
    `(?<![A-Za-z0-9-])(${COLOR_FUNCTIONS.join("|")})\\(${WS}var\\(${WS}(--[A-Za-z0-9_-]+)`,
    "gi",
  );

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch (error) {
      // A tracked file that git listed but that is gone from the working tree
      // is nothing to check. Anything else means the rule silently skipped a
      // file it was asked to check, which is a failure, not a pass.
      if (!existsSync(file)) continue;
      throw new Error(`could not read ${file}: ${(error as Error).message}`);
    }
    const lines = content.split("\n");
    let m: RegExpExecArray | null;
    while ((m = wrapped.exec(content)) !== null) {
      if (!vars.has(m[2])) continue;
      const line = content.slice(0, m.index).split("\n").length;
      violations.push({
        file,
        line,
        variable: m[2],
        fn: m[1],
        text: lines[line - 1].trim().slice(0, 140),
      });
    }
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
  let theme: string;
  try {
    theme = readFileSync(THEME_STYLESHEET, "utf8");
  } catch (error) {
    // Failing open here would mean an empty variable set and a check that
    // silently passes everything, which is the one outcome worse than a
    // false positive.
    console.error(
      `\n[check-theme-color-vars] FAILED — could not read the theme stylesheet ${THEME_STYLESHEET}: ${
        (error as Error).message
      }\n\nThis rule reads the theme to learn which variables hold a whole colour.\nIf the stylesheet moved, update THEME_STYLESHEET in scripts/dev/check-theme-color-vars.ts.\n`,
    );
    process.exit(1);
  }

  const vars = wholeColorVars(theme);
  if (vars.size === 0) {
    console.error(
      `\n[check-theme-color-vars] FAILED — ${THEME_STYLESHEET} declares no whole-colour variables.\n\nEither the theme switched to bare channel values (in which case this rule no\nlonger applies and should be removed from the RULES table in scripts/dev/lint.ts),\nor the declaration parsing broke and the rule is now checking nothing.\n`,
    );
    process.exit(1);
  }

  const files = listWorkingTreeFiles().filter(isScanned);
  let violations: Violation[];
  try {
    violations = findViolations(files, vars);
  } catch (error) {
    console.error(
      `\n[check-theme-color-vars] FAILED — ${(error as Error).message}\n\nThe rule could not read a file it was asked to check, so its pass would have\nbeen meaningless.\n`,
    );
    process.exit(1);
  }

  if (violations.length === 0) {
    console.log(
      `[check-theme-color-vars] OK — no theme colour variable is wrapped in a colour function (${vars.size} whole-colour variables, ${files.length} files scanned).`,
    );
    process.exit(0);
  }

  console.error(
    [
      "",
      "[check-theme-color-vars] FAILED",
      "",
      "A theme colour variable is wrapped in a colour function.",
      "",
      `In this project the variables in ${THEME_STYLESHEET} already hold a WHOLE`,
      "colour — `--chart-1: hsl(221 83% 53%)`, not `--chart-1: 221 83% 53%`. Wrapping",
      "one nests a colour inside a colour, which parses but is not a colour, so the",
      "property is dropped at computed-value time and whatever it was styling renders",
      "unstyled. Nothing warns: not the type checker, not the browser console.",
      "",
      "Name the variable and nothing more.",
      "",
      ...violations.map(
        (v) =>
          `  ${v.file}:${v.line}  ${v.fn}(var(${v.variable}))\n` +
          `      ${v.text}\n` +
          `      → write var(${v.variable})`,
      ),
      "",
      "The shadcn/ui examples on the web use the opposite convention (bare channel",
      "values in the variable, wrapped at each call site). Do not copy the wrapping",
      "from them without checking how the variable is declared here.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

// Only run when executed directly (tests may import the helpers).
if (process.argv[1] && /check-theme-color-vars\.ts$/.test(process.argv[1])) {
  main();
}
