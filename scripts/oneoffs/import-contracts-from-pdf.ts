/**
 * One-off: import two collective-bargaining-agreement PDFs as contract test
 * data into the `contract` component tables (contracts, contract_articles,
 * contract_sections).
 *
 * This is test data — the goal is a reasonable, structurally-faithful import,
 * not a byte-perfect reproduction of the source PDFs. Article/section titles
 * and bodies come straight from `pdftotext` output (which contains OCR-style
 * artifacts) and are wrapped in lightweight HTML (paragraphs, lists, a table).
 *
 * The script is idempotent: it deletes any existing contract with the same
 * name (cascading to its articles/sections) before re-inserting, so it can be
 * re-run safely. It also self-enables the `contract` component's schema, so it
 * works on a fresh deployment where the component has never been turned on.
 *
 * Usage:
 *   npx tsx scripts/oneoffs/import-contracts-from-pdf.ts
 */

import { execFileSync } from "child_process";
import { storage } from "../../server/storage/database";
import { runInTransaction } from "../../server/storage/transaction-context";
import { enableComponentSchema } from "../../server/services/component-lifecycle";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParsedSection {
  sectionNumber: string | null;
  name: string;
  bodyLines: string[];
}

interface ParsedArticle {
  articleNumber: string | null;
  name: string;
  sections: ParsedSection[];
}

interface ContractConfig {
  name: string;
  file: string;
  /** Line marking the start of the real body (everything before is title/TOC). */
  bodyStart: RegExp;
  /** Name to give the leading pre-ARTICLE-1 content (preamble/agreement). */
  preambleName: string;
  /** Detect an ARTICLE header. Returns number + inline title (may be empty). */
  matchArticle: (line: string) => { number: string; inlineTitle: string } | null;
  /** When true, the article title sits on the next non-blank line. */
  articleTitleOnNextLine: boolean;
  /** Detect a section header. Returns number + rest-of-line. */
  matchSection: (line: string) => { number: string; rest: string } | null;
  /** When true, the rest-of-line is the section title; otherwise it is body. */
  sectionHasInlineTitle: boolean;
  /** True for lines that are page/footer noise and should be dropped. */
  isNoise: (line: string) => boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function cleanTitle(s: string): string {
  return s
    .replace(/\.{2,}/g, " ") // dot leaders
    .replace(/[.\s]+$/g, "") // trailing dots/space
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract text from a PDF via the `pdftotext` binary. */
function pdfToText(file: string): string[] {
  const out = execFileSync("pdftotext", [file, "-"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.split("\n");
}

/**
 * Turn a run of body lines into lightweight HTML. Blank lines separate blocks.
 * Blocks that look like list items ((a), A., 1., etc.) are grouped into <ul>;
 * consecutive "Group N ..." blocks become a two-column <table>; everything
 * else becomes a <p>. Wrapped lines inside a block are joined with spaces.
 */
function bodyToHtml(lines: string[]): string {
  // Split into blocks on blank lines, joining wrapped lines with a space.
  const blocks: string[] = [];
  let cur: string[] = [];
  for (const raw of lines) {
    if (raw.trim() === "") {
      if (cur.length) {
        blocks.push(cur.join(" ").replace(/\s+/g, " ").trim());
        cur = [];
      }
    } else {
      cur.push(raw.trim());
    }
  }
  if (cur.length) blocks.push(cur.join(" ").replace(/\s+/g, " ").trim());

  // Pre-merge pass: PDFs frequently put a list/table marker on its own line
  // with a blank line before its text ("Group 1" / "A." alone, then the
  // description). Merge such an orphan marker with the next real block so the
  // list/table detection below can see them as a single item.
  const bareMarkerRe = /^(Group\s+\d+|\([a-zA-Z0-9]{1,3}\)|[A-Za-z]\.|\d{1,2}\.)$/;
  const merged: string[] = [];
  for (let k = 0; k < blocks.length; k++) {
    const b = blocks[k];
    if (bareMarkerRe.test(b) && k + 1 < blocks.length && !bareMarkerRe.test(blocks[k + 1])) {
      merged.push(`${b} ${blocks[k + 1]}`);
      k++;
    } else {
      merged.push(b);
    }
  }
  blocks.length = 0;
  blocks.push(...merged);

  const listRe = /^(\([a-zA-Z0-9]{1,3}\)|[A-Za-z]\.|\d{1,2}\.)\s+(.+)$/;
  const groupRe = /^(Group\s+\d+)\s+(.+)$/;

  const html: string[] = [];
  let listBuf: { marker: string; text: string }[] = [];
  let tableBuf: { label: string; text: string }[] = [];

  const flushList = () => {
    if (!listBuf.length) return;
    html.push(
      "<ul>" +
        listBuf
          .map(
            (i) =>
              `<li><strong>${esc(i.marker)}</strong> ${esc(i.text)}</li>`,
          )
          .join("") +
        "</ul>",
    );
    listBuf = [];
  };
  const flushTable = () => {
    if (!tableBuf.length) return;
    html.push(
      "<table><tbody>" +
        tableBuf
          .map(
            (r) =>
              `<tr><td><strong>${esc(r.label)}</strong></td><td>${esc(r.text)}</td></tr>`,
          )
          .join("") +
        "</tbody></table>",
    );
    tableBuf = [];
  };

  for (const b of blocks) {
    if (!b) continue;
    const g = b.match(groupRe);
    if (g) {
      flushList();
      tableBuf.push({ label: g[1], text: g[2] });
      continue;
    }
    const m = b.match(listRe);
    if (m) {
      flushTable();
      listBuf.push({ marker: m[1], text: m[2] });
      continue;
    }
    flushList();
    flushTable();
    html.push(`<p>${esc(b)}</p>`);
  }
  flushList();
  flushTable();
  return html.join("\n");
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function parse(cfg: ContractConfig, allLines: string[]): ParsedArticle[] {
  // Find body start.
  let start = allLines.findIndex((l) => cfg.bodyStart.test(l));
  if (start < 0) start = 0;
  const lines = allLines.slice(start).filter((l) => !cfg.isNoise(l));

  const articles: ParsedArticle[] = [];
  let curArticle: ParsedArticle | null = null;
  let curSection: ParsedSection | null = null;

  const startPreamble = () => {
    curArticle = {
      articleNumber: null,
      name: cfg.preambleName,
      sections: [],
    };
    curSection = {
      sectionNumber: null,
      name: cfg.preambleName,
      bodyLines: [],
    };
    curArticle.sections.push(curSection);
    articles.push(curArticle);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const art = cfg.matchArticle(line);
    if (art) {
      let title = art.inlineTitle;
      if (cfg.articleTitleOnNextLine || !title) {
        // Look ahead for the next non-blank line as the title.
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim() !== "") {
            title = lines[j].trim();
            i = j; // consume the title line
            break;
          }
        }
      }
      curArticle = {
        articleNumber: art.number,
        name: cleanTitle(title) || `Article ${art.number}`,
        sections: [],
      };
      curSection = null;
      articles.push(curArticle);
      continue;
    }

    const sec = cfg.matchSection(line);
    if (sec) {
      if (!curArticle) startPreamble();
      let name: string;
      const bodyLines: string[] = [];
      if (cfg.sectionHasInlineTitle) {
        name = cleanTitle(sec.rest) || sec.number;
      } else {
        name = sec.number;
        if (sec.rest.trim()) bodyLines.push(sec.rest.trim());
      }
      curSection = { sectionNumber: sec.number, name, bodyLines };
      curArticle!.sections.push(curSection);
      continue;
    }

    // Plain body line.
    if (!curArticle) startPreamble();
    if (!curSection) {
      // Article body before its first numbered section — attach to a lead
      // section named after the article.
      curSection = {
        sectionNumber: null,
        name: curArticle!.name,
        bodyLines: [],
      };
      curArticle!.sections.push(curSection);
    }
    curSection.bodyLines.push(line);
  }

  // Drop empty trailing sections/articles.
  for (const a of articles) {
    a.sections = a.sections.filter(
      (s) => s.bodyLines.some((l) => l.trim() !== "") || s.sectionNumber,
    );
  }
  return articles.filter((a) => a.sections.length > 0);
}

// ---------------------------------------------------------------------------
// Per-contract configuration
// ---------------------------------------------------------------------------

const WHITSETT: ContractConfig = {
  name: "M.R. Whitsett, Inc. (2015–2021)",
  file: "attached_assets/2015-2021_MR_Whitsett-EngS_1783249265499.pdf",
  bodyStart: /^THIS AGREEMENT is made/,
  preambleName: "Agreement",
  articleTitleOnNextLine: false,
  matchArticle: (line) => {
    const m = line.match(/^ARTICLE\s+(\d+)\s*[-.\u2013]\s*(.+)$/);
    if (!m) return null;
    return { number: m[1], inlineTitle: m[2] };
  },
  sectionHasInlineTitle: true,
  matchSection: (line) => {
    const m = line.match(/^(\d{1,2}\.\d{2})\.\s*(.*)$/);
    if (!m) return null;
    return { number: m[1], rest: m[2] };
  },
  isNoise: (line) => {
    const t = line.trim();
    if (t === "") return false; // keep blanks (paragraph separators)
    if (/^M\.?R\.?\s*Whitsett/i.test(t)) return true;
    if (/^TABLE OF CONTENTS$/i.test(t)) return true;
    if (/^Page$/i.test(t)) return true;
    if (/^\d{1,3}$/.test(t)) return true; // bare page number
    if (/^[ivxlIVXL1]{1,4}$/.test(t)) return true; // roman-ish page numeral (OCR)
    return false;
  },
};

const NSTEC: ContractConfig = {
  name: "National Security Technologies LLC / NSTec (2012–2017)",
  file: "attached_assets/NSTec_2012-2017_1783249463594.pdf",
  bodyStart: /^HOUSING, CUSTODIAL AND FOOD SERVICES AGREEMENT/,
  preambleName: "Preamble",
  articleTitleOnNextLine: true,
  matchArticle: (line) => {
    const m = line.match(/^ARTICLE\s+(\d+)\s*(.*)$/);
    if (!m) return null;
    return { number: m[1], inlineTitle: m[2].trim() };
  },
  sectionHasInlineTitle: false,
  matchSection: (line) => {
    const m = line.match(/^(\d{1,2}\.\d{1,2})\.?\s*(.*)$/);
    if (!m) return null;
    return { number: m[1], rest: m[2] };
  },
  isNoise: (line) => {
    const t = line.trim();
    if (t === "") return false;
    if (/^Page\s+\d+\s+of\s+\d+$/i.test(t)) return true;
    if (/^TABLE OF CONTENTS$/i.test(t)) return true;
    if (/^\d{1,3}$/.test(t)) return true;
    return false;
  },
};

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

async function importContract(cfg: ContractConfig): Promise<void> {
  console.log(`\n=== ${cfg.name} ===`);
  const lines = pdfToText(cfg.file);
  const articles = parse(cfg, lines);
  const totalSections = articles.reduce((n, a) => n + a.sections.length, 0);
  console.log(`Parsed ${articles.length} articles, ${totalSections} sections.`);

  await runInTransaction(async () => {
    const removed = await storage.contracts.deleteByName(cfg.name);
    if (removed > 0) console.log(`Removed ${removed} existing contract(s) with this name.`);

    const contract = await storage.contracts.createContract({
      name: cfg.name,
      stubSections: false,
      data: null,
    });

    let articleSeq = 0;
    for (const a of articles) {
      const article = await storage.contracts.createArticle({
        contractId: contract.id,
        sequence: articleSeq++,
        articleNumber: a.articleNumber,
        name: a.name,
        data: null,
      });

      let sectionSeq = 0;
      for (const s of a.sections) {
        const body = bodyToHtml(s.bodyLines);
        await storage.contracts.createSection({
          articleId: article.id,
          sequence: sectionSeq++,
          sectionNumber: s.sectionNumber,
          name: s.name,
          body: body || null,
          isStub: false,
          data: null,
        });
      }
    }
    console.log(`Inserted contract "${contract.id}".`);
  });
}

async function main(): Promise<void> {
  console.log("Enabling `contract` component schema (idempotent)...");
  const result = await enableComponentSchema("contract");
  if (!result.success) {
    console.error(`Failed to enable contract component: ${result.error}`);
    process.exit(1);
  }

  await importContract(WHITSETT);
  await importContract(NSTEC);

  console.log("\n=== Done ===");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Script failed:", err);
    process.exit(1);
  });
