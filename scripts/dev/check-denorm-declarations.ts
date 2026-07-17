#!/usr/bin/env tsx
/**
 * Check Denorm Plugin Storage Declarations
 *
 * Every denorm plugin (server/plugins/system/denorm/plugins/) must declare
 * the storage namespaces it reads (`reads: [...]`) and writes
 * (`writes: [{ storage, soleWriter }]`) at storage-object granularity. This
 * lint enforces, in the same regex/line-scan style as
 * check-storage-encapsulation.ts:
 *
 *  1. Every storage usage reachable from a plugin file (including the shared
 *     dispatch `_shared.ts` helpers) appears in that plugin's `reads` or
 *     `writes`; mutating-looking calls (create/update/delete/replace/upsert/
 *     set/insert prefixes) must be covered by `writes`.
 *  2. Declared-but-unused entries fail, so declarations stay honest.
 *  3. Every `soleWriter: true` claim is verified codebase-wide: no file
 *     outside the declaring plugin (and the storage layer itself) may issue a
 *     mutating call on that namespace, and no two plugins may claim sole
 *     ownership of the same namespace.
 *
 * The framework's own bookkeeping namespaces (`denorm`, `pluginConfigs`) are
 * implicit — the wrapper routes every plugin through them — and are exempt
 * from declarations.
 *
 * Usage: npx tsx scripts/dev/check-denorm-declarations.ts
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const PLUGINS_DIR = "server/plugins/system/denorm/plugins";
const SHARED_HELPER = `${PLUGINS_DIR}/dispatch/_shared.ts`;

/** Namespaces owned by the denorm framework itself — implicit, never declared. */
const FRAMEWORK_NAMESPACES = new Set(["denorm", "pluginConfigs"]);

/** Method-name prefixes that indicate a mutation. */
const MUTATING_PREFIXES = [
  "create",
  "update",
  "delete",
  "replace",
  "upsert",
  "set",
  "insert",
];

/**
 * Factory-function → storage-namespace mapping for storages that plugins
 * construct directly instead of reaching through the `storage` aggregate.
 * The namespace is the aggregate property name where one exists, else the
 * lowerCamel form of the storage interface name (factory-only storages).
 * Extend this table when a plugin starts using a new factory; the lint fails
 * loudly on an unmapped `create*Storage` call in a plugin file.
 */
const FACTORY_NAMESPACES: Record<string, string> = {
  createVariableStorage: "variables",
  createWorkerHoursStorage: "workerHours",
  createEmployerCompanyStorage: "employerCompanies",
  createWorkerBanStorage: "workerBans",
  createWorkerSkillStorage: "workerSkills",
  createDispatchStorage: "dispatches",
  createDispatchJobStorage: "dispatchJobs",
  createWorkerDispatchDncStorage: "workerDispatchDnc",
  createWorkerDispatchEbaStorage: "workerDispatchEba",
  createWorkerDispatchHfeStorage: "workerDispatchHfe",
  createWorkerDispatchStatusStorage: "workerDispatchStatus",
};

/** Reverse map used by the sole-writer sweep (namespace → factory names). */
const NAMESPACE_FACTORIES: Record<string, string[]> = {};
for (const [factory, ns] of Object.entries(FACTORY_NAMESPACES)) {
  (NAMESPACE_FACTORIES[ns] ??= []).push(factory);
}
/** Guess the factory name for namespaces not in the table (denorm stores). */
function factoryCandidatesFor(ns: string): string[] {
  const mapped = NAMESPACE_FACTORIES[ns] ?? [];
  const guessed = `create${ns.charAt(0).toUpperCase()}${ns.slice(1)}Storage`;
  return mapped.includes(guessed) ? mapped : [...mapped, guessed];
}

interface Usage {
  namespace: string;
  method: string;
  line: number;
  mutating: boolean;
}

interface PluginDecl {
  file: string;
  pluginId: string | null;
  reads: string[];
  writes: { storage: string; soleWriter: boolean }[];
}

interface Violation {
  file: string;
  line: number;
  message: string;
}

function isMutating(method: string): boolean {
  return MUTATING_PREFIXES.some((p) => method.startsWith(p));
}

function findTsFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (entry !== "node_modules" && entry !== ".git" && entry !== "dist") {
        findTsFiles(fullPath, files);
      }
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Extract every storage usage (aggregate + factory-constructed) in a file.
 * `factoryMap` maps factory function names to namespaces; unmapped factories
 * are reported as a synthetic usage when `reportUnmappedFactories` is set
 * (used for plugin files, where every factory must be reconcilable).
 */
function extractUsages(
  filePath: string,
  content: string,
  factoryMap: Record<string, string> = FACTORY_NAMESPACES,
  reportUnmappedFactories = true,
): Usage[] {
  const usages: Usage[] = [];
  const lines = content.split("\n");

  // Factory-constructed storages: `const <var> = create<X>Storage(` binds
  // <var> to the factory's namespace for the rest of the file.
  const varNamespaces = new Map<string, string>();
  lines.forEach((line, index) => {
    const factoryBind = line.match(/(?:const|let)\s+(\w+)\s*=\s*(create\w+Storage)\s*\(/);
    if (factoryBind) {
      const [, varName, factory] = factoryBind;
      const ns = factoryMap[factory];
      if (!ns) {
        if (reportUnmappedFactories) {
          usages.push({
            namespace: `<unmapped factory ${factory}>`,
            method: factory,
            line: index + 1,
            mutating: true,
          });
        }
        return;
      }
      varNamespaces.set(varName, ns);
    }
  });

  lines.forEach((line, index) => {
    // Aggregate usage: storage.<ns>.<method>(
    for (const m of line.matchAll(/\bstorage\.(\w+)\.(\w+)\s*\(/g)) {
      usages.push({
        namespace: m[1],
        method: m[2],
        line: index + 1,
        mutating: isMutating(m[2]),
      });
    }
    // Factory-var usage: <var>.<method>(
    for (const m of line.matchAll(/\b(\w+)\.(\w+)\s*\(/g)) {
      const ns = varNamespaces.get(m[1]);
      if (ns) {
        usages.push({
          namespace: ns,
          method: m[2],
          line: index + 1,
          mutating: isMutating(m[2]),
        });
      }
    }
  });

  return usages;
}

/** Extract the plugin's reads/writes declarations via bracket-matched scan. */
function extractDeclarations(filePath: string, content: string): PluginDecl {
  const pluginIdMatch = content.match(/^\s*id:\s*["']([\w-]+)["']/m);
  // Some plugins key their id through a const (e.g. `id: PLUGIN_ID`).
  const pluginIdConst = content.match(/^const PLUGIN_ID = ["']([\w-]+)["']/m);

  const readsMatch = matchArray(content, /^\s*reads:\s*\[/m);
  const writesMatch = matchArray(content, /^\s*writes:\s*\[/m);

  const reads = readsMatch
    ? Array.from(readsMatch.matchAll(/["']([\w.]+)["']/g)).map((m) => m[1])
    : [];

  const writes: { storage: string; soleWriter: boolean }[] = [];
  if (writesMatch) {
    for (const m of writesMatch.matchAll(
      /\{\s*storage:\s*["']([\w.]+)["']\s*,\s*soleWriter:\s*(true|false)\s*\}/g,
    )) {
      writes.push({ storage: m[1], soleWriter: m[2] === "true" });
    }
  }

  return {
    file: filePath,
    pluginId: pluginIdMatch?.[1] ?? pluginIdConst?.[1] ?? null,
    reads,
    writes,
  };
}

/** Return the bracket-balanced `[...]` slice starting at `startRe`, or null. */
function matchArray(content: string, startRe: RegExp): string | null {
  const m = content.match(startRe);
  if (!m || m.index === undefined) return null;
  const open = content.indexOf("[", m.index);
  let depth = 0;
  for (let i = open; i < content.length; i++) {
    if (content[i] === "[") depth++;
    else if (content[i] === "]") {
      depth--;
      if (depth === 0) return content.slice(open, i + 1);
    }
  }
  return null;
}

function main() {
  console.log("Checking denorm plugin storage declarations...\n");

  const violations: Violation[] = [];
  const cwd = process.cwd();

  const pluginFiles = findTsFiles(join(cwd, PLUGINS_DIR))
    .map((f) => relative(cwd, f).replace(/\\/g, "/"))
    .filter((f) => f !== SHARED_HELPER)
    .sort();

  const sharedContent = readFileSync(join(cwd, SHARED_HELPER), "utf-8");
  const sharedUsages = extractUsages(SHARED_HELPER, sharedContent);

  // ---- Check 1 + 2: per-plugin usage/declaration reconciliation ----
  const soleWriterClaims = new Map<string, string[]>(); // ns -> plugin files

  for (const file of pluginFiles) {
    const content = readFileSync(join(cwd, file), "utf-8");
    const decl = extractDeclarations(file, content);

    if (!/^\s*reads:\s*\[/m.test(content) || !/^\s*writes:\s*\[/m.test(content)) {
      violations.push({
        file,
        line: 1,
        message:
          "Denorm plugin is missing its `reads: [...]` / `writes: [...]` storage declarations.",
      });
      continue;
    }

    let usages = extractUsages(file, content);
    // Dispatch plugins route reads/writes through the shared helpers; their
    // effective usage includes _shared.ts's usage.
    if (/from ["']\.\/_shared["']/.test(content)) {
      usages = usages.concat(sharedUsages.map((u) => ({ ...u, line: 0 })));
    }

    const declaredReads = new Set(decl.reads);
    const declaredWrites = new Set(decl.writes.map((w) => w.storage));

    for (const w of decl.writes) {
      if (w.soleWriter) {
        (soleWriterClaims.get(w.storage) ?? soleWriterClaims.set(w.storage, []).get(w.storage))!.push(file);
      }
    }

    const usedNamespaces = new Set<string>();
    const mutatedNamespaces = new Set<string>();

    for (const u of usages) {
      if (u.namespace.startsWith("<unmapped factory")) {
        violations.push({
          file,
          line: u.line,
          message: `${u.method} has no FACTORY_NAMESPACES mapping in check-denorm-declarations.ts — add one so the usage can be reconciled.`,
        });
        continue;
      }
      if (FRAMEWORK_NAMESPACES.has(u.namespace)) continue;
      usedNamespaces.add(u.namespace);
      if (u.mutating) mutatedNamespaces.add(u.namespace);

      if (!declaredReads.has(u.namespace) && !declaredWrites.has(u.namespace)) {
        violations.push({
          file,
          line: u.line,
          message: `storage.${u.namespace}.${u.method}(...) is used but "${u.namespace}" is not declared in reads or writes.`,
        });
      } else if (u.mutating && !declaredWrites.has(u.namespace)) {
        violations.push({
          file,
          line: u.line,
          message: `storage.${u.namespace}.${u.method}(...) looks mutating but "${u.namespace}" is only declared in reads — move it to writes.`,
        });
      }
    }

    // Declared-but-unused entries keep declarations honest.
    for (const r of decl.reads) {
      if (FRAMEWORK_NAMESPACES.has(r)) {
        violations.push({
          file,
          line: 1,
          message: `"${r}" is a framework-implicit namespace and must not be declared in reads.`,
        });
      } else if (!usedNamespaces.has(r)) {
        violations.push({
          file,
          line: 1,
          message: `reads declares "${r}" but no usage of it was found in the plugin (or its shared helpers).`,
        });
      }
    }
    for (const w of decl.writes) {
      if (FRAMEWORK_NAMESPACES.has(w.storage)) {
        violations.push({
          file,
          line: 1,
          message: `"${w.storage}" is a framework-implicit namespace and must not be declared in writes.`,
        });
      } else if (!mutatedNamespaces.has(w.storage)) {
        violations.push({
          file,
          line: 1,
          message: `writes declares "${w.storage}" but no mutating usage of it was found in the plugin (or its shared helpers).`,
        });
      }
    }
  }

  // ---- Check 3: verify soleWriter claims codebase-wide ----
  for (const [ns, claimants] of soleWriterClaims) {
    if (claimants.length > 1) {
      violations.push({
        file: claimants[1],
        line: 1,
        message: `Multiple plugins claim soleWriter on "${ns}" (${claimants.join(", ")}) — at most one sole writer can exist; mark the target shared (soleWriter: false) instead.`,
      });
    }
  }

  if (soleWriterClaims.size > 0) {
    const scanRoots = ["server", "scripts"].map((d) => join(cwd, d));
    const allFiles: string[] = [];
    for (const root of scanRoots) findTsFiles(root, allFiles);

    // Extend the factory map with guessed factory names for the sole-writer
    // namespaces so factory-constructed usage is tracked at variable
    // granularity — mere construction is not a violation; a mutating call is.
    const sweepFactoryMap: Record<string, string> = { ...FACTORY_NAMESPACES };
    for (const ns of soleWriterClaims.keys()) {
      for (const factory of factoryCandidatesFor(ns)) {
        sweepFactoryMap[factory] ??= ns;
      }
    }

    for (const absPath of allFiles) {
      const file = relative(cwd, absPath).replace(/\\/g, "/");
      // The storage layer itself and this lint are exempt.
      if (file.startsWith("server/storage/")) continue;
      if (file === "scripts/dev/check-denorm-declarations.ts") continue;

      const content = readFileSync(absPath, "utf-8");
      const usages = extractUsages(file, content, sweepFactoryMap, false);

      for (const u of usages) {
        if (!u.mutating) continue;
        const claimants = soleWriterClaims.get(u.namespace);
        if (!claimants || claimants.includes(file)) continue;
        violations.push({
          file,
          line: u.line,
          message: `storage "${u.namespace}" is mutated via .${u.method}(...), but ${claimants[0]} declares soleWriter: true on it. Either move the mutation into that plugin or downgrade the claim to soleWriter: false.`,
        });
      }
    }
  }

  if (violations.length === 0) {
    console.log("✓ No denorm declaration violations found.\n");
    console.log(
      `Checked ${pluginFiles.length} plugin(s); ${soleWriterClaims.size} sole-writer claim(s) verified codebase-wide.`,
    );
    process.exit(0);
  }

  console.log(`✗ Found ${violations.length} denorm declaration violation(s):\n`);
  for (const v of violations) {
    console.log(`  ${v.file}:${v.line}`);
    console.log(`    ${v.message}`);
    console.log("");
  }
  console.log(
    "RULE: every denorm plugin declares its storage reads/writes (storage-object",
  );
  console.log(
    "granularity) and its soleWriter claims must hold codebase-wide. See",
  );
  console.log("server/plugins/system/denorm/types.ts for the contract.");
  process.exit(1);
}

main();
