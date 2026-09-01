#!/usr/bin/env npx tsx
/**
 * Author-time enforcement that the Freeman-only deployment config sits on
 * exactly the branches it belongs to — absent from `main`, present on every
 * carrying branch.
 *
 * `.github/` (CI workflows) and `deploy/` (per-environment config) belong on
 * the `freeman-dev` / `freeman-uat` branches, which push to the `freeman`
 * remote. `main` pushes to `origin`, where both are unwelcome: the Replit Git
 * token lacks the GitHub `workflow` OAuth scope, so a `main` push carrying
 * `.github/` is rejected outright, and the deploy env files must not reach
 * origin at all. Both directories are gitignored, but gitignore does not
 * apply to files git already tracks — a branch cut from a tree where they
 * were tracked carries them into `main` on merge, which is exactly how they
 * landed there once before and had to be removed by rewriting history.
 *
 * The rule has two halves, because the paths go missing in both directions
 * and neither shows up in `git status` (they are ignored, so status is silent
 * whether they are tracked, untracked, or gone):
 *
 * - On `main`, tracking them is a violation.
 * - On a carrying branch, NOT tracking them is a violation. A task agent
 *   works in an isolated environment cut from a tree that never had these
 *   paths, so its pre-merge snapshot records them as deleted and the merge
 *   wipes them off the carrying branch. Nothing warns, and this has already
 *   happened twice — each time noticed only when a deploy needed the files.
 *
 * Any other branch gets no opinion: a task or feature branch legitimately has
 * neither. Likewise a detached HEAD, where there is no branch to judge.
 *
 * Run manually:
 *
 *   npx tsx scripts/dev/check-main-branch-files.ts
 *
 * Exits 0 on pass, 1 on violations.
 */
import { spawnSync } from "node:child_process";

/** The only branch on which these directories are forbidden. */
const PROTECTED_BRANCH = "main";

/**
 * Branches that must carry these directories. Each deployment branch keeps
 * its own copy; losing it silently breaks that environment's deploy.
 *
 * Exported because the sibling `check-carrying-branch-drift` rule asks the
 * same question of the same branches — one list, or adding a deployment
 * branch guards it against half the failures.
 */
export const CARRYING_BRANCHES = ["freeman-dev", "freeman-uat"];

/**
 * Directories that must never be tracked on the protected branch — and, seen
 * from the carrying branch, the only paths that may differ from `main` there.
 * Exported for the sibling rule that enforces that second reading.
 */
export const FORBIDDEN_PATHS = [".github", "deploy"];

/** The one-line repair: untrack, leaving the on-disk copies alone. */
const FIX_COMMAND = `git rm -r --cached ${FORBIDDEN_PATHS.join(" ")}`;

function git(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return {
    ok: !result.error && result.status === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? result.error?.message ?? "").trim(),
  };
}

/**
 * A git read the verdict depends on. A failure here must not be folded into
 * the same empty result an honest answer produces — "no branch" and "no
 * tracked files" are both passes, so a broken git invocation would report
 * success without having checked anything.
 */
function gitOrDie(args: string[]): string {
  const result = git(args);
  if (result.ok) return result.stdout;

  console.error(
    [
      "",
      `[check-main-branch-files] FAILED — \`git ${args.join(" ")}\` did not run:`,
      `  ${result.stderr || "unknown error"}`,
      "",
      "The rule cannot tell where the deployment config is, so it fails rather than",
      "passing blind.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

/**
 * The current branch name, or null on a detached HEAD (or when git cannot
 * answer — an unborn branch, no repository).
 */
export function currentBranch(): string | null {
  const head = gitOrDie(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (head === "" || head === "HEAD") return null;
  return head;
}

/**
 * The deployment-config paths tracked in the current commit. `git ls-tree`
 * reads the commit, not the working tree — `git status` shows nothing for
 * these paths once they are ignored, whether or not they are tracked.
 */
export function trackedForbiddenPaths(): string[] {
  const tree = gitOrDie(["ls-tree", "-r", "--name-only", "HEAD", "--", ...FORBIDDEN_PATHS]);
  if (tree === "") return [];
  return tree.split("\n").filter((line) => line !== "");
}

/**
 * Which of the directories have no tracked files at all. A partial loss is
 * not what happens here — an agent snapshot deletes whole directories — so
 * "the directory is empty" is the signal, and it stays quiet about which
 * individual files a branch chooses to carry.
 */
function emptyDirectories(tracked: string[]): string[] {
  return FORBIDDEN_PATHS.filter(
    (dir) => !tracked.some((path) => path === dir || path.startsWith(`${dir}/`)),
  );
}

/**
 * The newest commit reachable from HEAD that still tracks `dir` — the copy to
 * restore from.
 *
 * Asking "which commit deleted it" is the wrong question, and answering it
 * produces confident but wrong advice: a deletion arriving in a merge is not
 * diffed by a plain `git log`, and the two directories can be lost at
 * different times, so one deletion's parent is not necessarily a good copy of
 * the other. Looking for a commit that demonstrably HAS the directory answers
 * the question the repair actually asks, and is verified rather than
 * inferred. Resolved per directory for the same reason.
 */
function lastCommitContaining(dir: string): string | null {
  const log = git(["log", "--format=%h", "-50", "--", dir]);
  if (!log.ok || log.stdout === "") return null;

  for (const sha of log.stdout.split("\n").filter((line) => line !== "")) {
    const tree = git(["ls-tree", "-r", "--name-only", sha, "--", dir]);
    if (tree.ok && tree.stdout !== "") return sha;
  }
  return null;
}

function main(): void {
  const branch = currentBranch();

  if (branch === null) {
    console.log(
      `[check-main-branch-files] OK — detached HEAD (no branch to check); ` +
        `${FORBIDDEN_PATHS.join("/, ")}/ are only forbidden on ${PROTECTED_BRANCH}.`,
    );
    process.exit(0);
  }

  if (CARRYING_BRANCHES.includes(branch)) {
    const tracked = trackedForbiddenPaths();
    const missing = emptyDirectories(tracked);

    if (missing.length === 0) {
      console.log(
        `[check-main-branch-files] OK — on carrying branch "${branch}", ` +
          `${tracked.length} deployment-config file(s) tracked, as required.`,
      );
      process.exit(0);
    }

    // Resolved per directory: they can have been lost at different times, and
    // restoring one from the other's last good commit would be wrong.
    const sources = missing.map((dir) => ({ dir, sha: lastCommitContaining(dir) }));
    const found = sources.filter((s) => s.sha !== null);
    const unresolved = sources.filter((s) => s.sha === null).map((s) => s.dir);

    console.error(
      [
        "",
        `[check-main-branch-files] FAILED — carrying branch "${branch}" has lost its ` +
          `deployment config.`,
        "",
        `Empty here: ${missing.map((p) => `${p}/`).join(", ")}`,
        `Still tracked: ${tracked.length} file(s)`,
        "",
        "This branch deploys an environment and needs its own copy of these",
        "directories. They are almost always wiped by a task-agent merge: the agent",
        "works in an isolated environment cut from a tree that never had these",
        "gitignored paths, so its pre-merge snapshot records them as deleted and the",
        "merge takes the deletion. Nothing warns, and git status stays silent because",
        "the paths are ignored.",
        "",
        ...(found.length > 0
          ? [
              "Restore from the newest commit here that still has each one:",
              "",
              ...found.map((s) => `  git checkout ${s.sha} -- ${s.dir}`),
              "",
            ]
          : []),
        ...(unresolved.length > 0
          ? [
              `No commit on this branch tracks ${unresolved.join(" or ")} — copy from a`,
              "branch that has it, and check that branch is up to date first:",
              "",
              ...unresolved.map((dir) => `  git checkout <carrying-branch> -- ${dir}`),
              "",
            ]
          : []),
        "A plain `git add` will NOT stage these — they are gitignored, so it does",
        "nothing and reports no error. `git checkout <commit> -- <path>` bypasses the",
        "ignore rules and stages them directly. Confirm with `git diff --cached",
        "--name-only` before committing.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  if (branch !== PROTECTED_BRANCH) {
    console.log(
      `[check-main-branch-files] OK — on branch "${branch}", which is neither ` +
        `${PROTECTED_BRANCH} nor a carrying branch ` +
        `(${CARRYING_BRANCHES.join(", ")}); no requirement either way.`,
    );
    process.exit(0);
  }

  const tracked = trackedForbiddenPaths();
  if (tracked.length === 0) {
    console.log(
      `[check-main-branch-files] OK — no ${FORBIDDEN_PATHS.join("/ or ")}/ ` +
        `files are tracked on ${PROTECTED_BRANCH}.`,
    );
    process.exit(0);
  }

  console.error(
    [
      "",
      `[check-main-branch-files] FAILED — ${tracked.length} deployment-config file(s) ` +
        `are tracked on ${PROTECTED_BRANCH}.`,
      "",
      `${FORBIDDEN_PATHS.map((p) => `${p}/`).join(" and ")} belong on the Freeman ` +
        `deployment branches only. On`,
      `${PROTECTED_BRANCH} they break the push to origin: the Replit Git token has no`,
      "GitHub `workflow` OAuth scope, so a push carrying .github/ is rejected outright,",
      "and the deploy env files must not reach origin at all.",
      "",
      "Both directories are gitignored, but ignore rules do not apply to files git",
      "already tracks — this most often arrives via a merge from a branch that was cut",
      "from a tree where they were tracked.",
      "",
      "Tracked paths:",
      ...tracked.map((path) => `  ${path}`),
      "",
      "Fix (untracks them, leaves the on-disk copies in place):",
      "",
      `  ${FIX_COMMAND}`,
      "",
      "Then commit the removal. Do not delete the working-tree copies, and do not",
      "commit the files here — edits to them are made on a Freeman branch.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

// Only run when executed directly (tests may import the helpers).
if (process.argv[1] && /check-main-branch-files\.ts$/.test(process.argv[1])) {
  main();
}
