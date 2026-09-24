#!/usr/bin/env tsx
/**
 * Check HTML Utility Consolidation
 *
 * HTML handling used to be reinvented per call site: six copies of an
 * escape helper (three of which escaped a different set of characters),
 * five mutually inconsistent sanitizers, and two partial entity
 * decoders. The visible cost was that "what may this content contain?"
 * had a different answer in every file, and nobody could see the set.
 *
 * `shared/utils/html/` is now the one library that owns escaping,
 * entity decoding, HTML→text conversion, and sanitization, with every
 * tag/attribute allowlist written down once in `policies.ts`.
 *
 * A consolidation only holds if re-fragmenting it is noisy, so this
 * check fails on the three ways it drifted apart before:
 *
 *   1. A locally defined escape helper (`function escapeHtml`, …).
 *   2. A raw HTML-entity `.replace()` chain — hand-rolled escaping or
 *      decoding, in either direction.
 *   3. A direct DOMPurify import, which is how a sixth allowlist gets
 *      written inline instead of being added to the policy table.
 *
 * …and on the way the consolidation is easiest to bypass entirely:
 *
 *   4. A `dangerouslySetInnerHTML` whose value never went through
 *      `sanitizeHtml`. Owning the sanitizer is worth nothing if a render
 *      site can just not call it, which is how the cardcheck bodies,
 *      trust benefit descriptions, invoice header/footer and signed
 *      e-signature snapshots all shipped raw. Content that a server
 *      sanitizes before it ever reaches the client is legitimate — it is
 *      just not something a future reader should have to re-derive, so
 *      those sites are named in UNSANITIZED_RENDER_ALLOWLIST with the
 *      upstream sanitizer written down.
 *
 * Like scripts/dev/check-env-registry.ts, this scans the CURRENT working
 * tree — tracked AND untracked files — so a brand-new file cannot dodge
 * the check before its first commit.
 *
 * Run with:  npx tsx scripts/dev/check-html-utils.ts
 *
 * Exits 0 on pass, 1 on violations.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** The library that is allowed to do all three of these things. */
const HTML_LIBRARY_PREFIX = "shared/utils/html/";

/**
 * Narrow, documented exemptions. Add entries ONLY with a justification —
 * every exemption is another place a future reader has to look.
 */
const EXEMPT_FILES = new Set<string>([
  // This check script itself: needs the literal patterns to search for.
  "scripts/dev/check-html-utils.ts",
]);

const SCANNED_PREFIXES = ["client/", "server/", "shared/", "scripts/"];
const SCANNED_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs"];

/**
 * Render sites that legitimately do NOT call `sanitizeHtml`, with the
 * reason each one is safe.
 *
 * `sites` is the number of unsanitized `dangerouslySetInnerHTML` in that
 * file, and it is deliberately an exact count rather than a blanket
 * per-file waiver: adding a new raw render site to an already-listed file
 * would otherwise inherit an exemption that was written about a different
 * line. The count changing in either direction fails the check, so the
 * author has to look at the reason and confirm it still applies.
 *
 * "It's admin-authored" is NOT a reason. Every one of the sites this
 * check was written for was admin-authored; that is what stored XSS is.
 * The only acceptable reasons are "a named server-side sanitizer already
 * ran on this exact value" or "this value is not stored content at all".
 */
const UNSANITIZED_RENDER_ALLOWLIST: Record<
  string,
  { sites: number; reason: string }
> = {
  "client/src/components/HelpDisplay.tsx": {
    sites: 1,
    reason:
      "help details are sanitized server-side under 'rich-document' — on write in server/modules/helps.ts, and on read for built-ins in server/help/system/index.ts",
  },
  "client/src/components/template-studio/TemplateStudio.tsx": {
    sites: 2,
    reason:
      "preview fields are sanitized server-side under 'rich-document' by server/delivery/shape.ts, the same shaping delivery uses, so preview and delivery cannot disagree",
  },
  "client/src/components/ui/chart.tsx": {
    sites: 1,
    reason:
      "not stored content: a <style> block generated from the chart's developer-authored config object in source",
  },
};

interface Rule {
  id: string;
  /** Matched against a single line of source. */
  test: (line: string) => boolean;
  /** What the author should do instead. */
  remedy: string;
}

/** Entity literals that betray hand-rolled escaping or decoding. */
const ENTITY_LITERAL =
  /&(?:amp|lt|gt|quot|apos|nbsp|copy|reg|trade|bull|ndash|mdash|hellip|#\d+|#x[0-9a-fA-F]+);/;

const RULES: Rule[] = [
  {
    id: "local-escape-helper",
    test: (line) =>
      /(?:function|const|let|var)\s+(?:escapeHtml|escapeHTML|htmlEscape|escapeHtmlAttr)\b/.test(
        line,
      ),
    remedy:
      "import { escapeHtml } from '@shared/utils/html' (or '.../html/escape' on the boot path)",
  },
  {
    id: "entity-replace-chain",
    test: (line) => line.includes(".replace(") && ENTITY_LITERAL.test(line),
    remedy:
      "use escapeHtml() to encode text, or decodeHtmlEntities() to decode it — both from @shared/utils/html",
  },
  {
    id: "direct-dompurify",
    test: (line) =>
      /\bfrom\s+["'](?:isomorphic-)?dompurify["']/.test(line) ||
      /\brequire\(\s*["'](?:isomorphic-)?dompurify["']\s*\)/.test(line) ||
      /\bimport\(\s*["'](?:isomorphic-)?dompurify["']\s*\)/.test(line),
    remedy:
      "call sanitizeHtml(html, '<policy>') from @shared/utils/html; add a policy to shared/utils/html/policies.ts if none fits",
  },
];

/** Functions that count as "this value came from the shared sanitizer". */
const SANITIZER_CALL = /\b(?:sanitizeHtml|sanitizeHtmlReportingChange)\s*\(/;

/**
 * Read the balanced `{...}` group that starts at or after `from`, and
 * return its text. Used to grab the whole `{{ __html: … }}` expression,
 * which routinely spans several lines once prettier has had a go at it.
 */
function readBalancedBraces(source: string, from: number): string {
  const start = source.indexOf("{", from);
  if (start === -1) return "";
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return source.slice(start);
}

/**
 * Names in this file that hold a sanitized value.
 *
 * Almost no render site inlines the call — it sanitizes into a local
 * first (`const clean = …`, a `useMemo`, a destructured
 * `{ clean: safeDocRender }`), so following the binding is the difference
 * between a check that works and one that flags every real call site.
 */
function sanitizedBindings(source: string): Set<string> {
  const names = new Set<string>();
  const decl = /\b(?:const|let|var)\s+/g;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(source)) !== null) {
    const after = source.slice(m.index + m[0].length);
    // Split the declaration at its top-level `=` (depth 0), then walk the
    // initializer to the end of the statement.
    let depth = 0;
    let eq = -1;
    for (let i = 0; i < after.length; i++) {
      const c = after[i];
      if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) depth--;
      else if (c === "=" && depth === 0 && after[i + 1] !== "=" && after[i - 1] !== "=" && after[i - 1] !== "!" && after[i - 1] !== "<" && after[i - 1] !== ">") {
        eq = i;
        break;
      } else if (c === ";" && depth === 0) break;
    }
    if (eq === -1) continue;
    const target = after.slice(0, eq);

    let init = "";
    depth = 0;
    for (let i = eq + 1; i < after.length; i++) {
      const c = after[i];
      if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) depth--;
      else if (c === ";" && depth === 0) break;
      if (depth < 0) break;
      init += c;
    }
    if (!SANITIZER_CALL.test(init)) continue;

    const destructured = target.match(/\{([\s\S]*)\}/);
    if (destructured) {
      // `{ clean: safeDocRender, contentChanged }` binds the RENAMED name.
      for (const part of destructured[1].split(",")) {
        const [left, right] = part.split(":").map((s) => s.trim());
        const bound = (right || left || "").replace(/=.*$/, "").trim();
        if (/^[A-Za-z_$][\w$]*$/.test(bound)) names.add(bound);
      }
    } else {
      const plain = target.trim().replace(/:.*$/, "").trim();
      if (/^[A-Za-z_$][\w$]*$/.test(plain)) names.add(plain);
    }
  }
  return names;
}

interface RenderSite {
  file: string;
  line: number;
  text: string;
}

/**
 * Every `dangerouslySetInnerHTML` in a file whose value neither calls the
 * shared sanitizer inline nor reads a local that does.
 */
export function findUnsanitizedRenderSites(
  file: string,
  source: string,
): RenderSite[] {
  const sites: RenderSite[] = [];
  const sanitized = sanitizedBindings(source);
  const marker = /dangerouslySetInnerHTML/g;
  let m: RegExpExecArray | null;
  while ((m = marker.exec(source)) !== null) {
    const expression = readBalancedBraces(source, m.index);
    if (SANITIZER_CALL.test(expression)) continue;
    const referenced = expression.match(/\b[A-Za-z_$][\w$]*\b/g) ?? [];
    if (referenced.some((name) => sanitized.has(name))) continue;
    sites.push({
      file,
      line: source.slice(0, m.index).split("\n").length,
      text: expression.replace(/\s+/g, " ").slice(0, 100),
    });
  }
  return sites;
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
  if (file.startsWith(HTML_LIBRARY_PREFIX)) return false;
  if (EXEMPT_FILES.has(file)) return false;
  return true;
}

interface Violation {
  rule: string;
  remedy: string;
  file: string;
  line: number;
  text: string;
}

export function findViolations(files: string[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue; // deleted-but-still-listed files
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const rule of RULES) {
        if (rule.test(lines[i])) {
          violations.push({
            rule: rule.id,
            remedy: rule.remedy,
            file,
            line: i + 1,
            text: lines[i].trim(),
          });
        }
      }
    }
  }
  return violations;
}

/** Audit every render site against the allowlist. Returns problem lines. */
export function auditRenderSites(files: string[]): string[] {
  const problems: string[] = [];
  const counted = new Map<string, RenderSite[]>();

  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!source.includes("dangerouslySetInnerHTML")) continue;
    const sites = findUnsanitizedRenderSites(file, source);
    if (sites.length > 0) counted.set(file, sites);
  }

  for (const [file, sites] of counted) {
    const allowed = UNSANITIZED_RENDER_ALLOWLIST[file];
    if (!allowed) {
      for (const s of sites) {
        problems.push(
          `  ${s.file}:${s.line}  [unsanitized-render]  ${s.text}\n` +
            "      → wrap the value in sanitizeHtml(value, '<policy>') from @shared/utils/html\n" +
            "        (pick the narrowest policy in shared/utils/html/policies.ts that keeps\n" +
            "        the content rendering as it does today), or — if a named server-side\n" +
            "        sanitizer already ran on it — add the file to\n" +
            "        UNSANITIZED_RENDER_ALLOWLIST with that sanitizer written down.",
        );
      }
      continue;
    }
    if (allowed.sites !== sites.length) {
      problems.push(
        `  ${file}  [unsanitized-render-count]  allowlisted for ${allowed.sites} site(s), found ${sites.length}\n` +
          `      allowlist reason: ${allowed.reason}\n` +
          "      → that reason was written about the sites that existed then. Confirm it\n" +
          "        still covers every site in the file, then update the `sites` count\n" +
          `        (lines: ${sites.map((s) => s.line).join(", ")}).`,
      );
    }
  }

  for (const file of Object.keys(UNSANITIZED_RENDER_ALLOWLIST)) {
    if (!counted.has(file)) {
      problems.push(
        `  ${file}  [unsanitized-render-stale]  allowlisted, but has no unsanitized render sites\n` +
          "      → remove the entry from UNSANITIZED_RENDER_ALLOWLIST.",
      );
    }
  }

  return problems;
}

function main(): void {
  const files = listWorkingTreeFiles().filter(isScanned);
  const violations = findViolations(files);
  const renderProblems = auditRenderSites(files);

  if (violations.length === 0 && renderProblems.length === 0) {
    console.log(
      `[check-html-utils] OK — escaping, entity decoding and sanitization all live in ${HTML_LIBRARY_PREFIX}, and every dangerouslySetInnerHTML either sanitizes or is allowlisted with a reason (${files.length} files scanned).`,
    );
    process.exit(0);
  }

  const report: string[] = [
    "",
    "[check-html-utils] FAILED",
    "",
  ];

  if (violations.length > 0) {
    report.push(
      "HTML handling defined outside the shared library.",
      "",
      `All escaping, entity decoding and sanitization belongs in ${HTML_LIBRARY_PREFIX}.`,
      "Remember the distinction: escapeHtml() is for text that must NOT render as",
      "markup; sanitizeHtml(html, policy) is for markup that must. They are not",
      "interchangeable — see the header of shared/utils/html/index.ts.",
      "",
      ...violations.map(
        (v) => `  ${v.file}:${v.line}  [${v.rule}]  ${v.text}\n      → ${v.remedy}`,
      ),
      "",
      "Genuinely impossible cases may be added to EXEMPT_FILES in",
      "scripts/dev/check-html-utils.ts with a comment justifying the exemption.",
      "",
    );
  }

  if (renderProblems.length > 0) {
    report.push(
      "Unsanitized HTML reaching the DOM.",
      "",
      "A dangerouslySetInnerHTML whose value never passed through the shared",
      "sanitizer renders whatever is stored, so anyone who can write that field",
      "can run script in every later viewer's browser.",
      "",
      ...renderProblems,
      "",
    );
  }

  console.error(report.join("\n"));
  process.exit(1);
}

// Only run when executed directly (tests may import findViolations).
if (process.argv[1] && /check-html-utils\.ts$/.test(process.argv[1])) {
  main();
}
