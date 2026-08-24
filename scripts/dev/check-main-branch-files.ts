#!/usr/bin/env npx tsx
/**
 * Author-time enforcement that the Freeman-only deployment config never
 * becomes tracked on `main`.
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
 * This is a branch-conditional rule: it only fires on `main`. On a Freeman
 * branch those files are tracked deliberately, and on a detached HEAD there
 * is no branch to judge.
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

/** Directories that must never be tracked on the protected branch. */
const FORBIDDEN_PATHS = [".github", "deploy"];

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
 * The current branch name, or null on a detached HEAD (or when git cannot
 * answer — an unborn branch, no repository).
 */
export function currentBranch(): string | null {
  const head = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!head.ok) return null;
  if (head.stdout === "" || head.stdout === "HEAD") return null;
  return head.stdout;
}

/**
 * The forbidden paths tracked in the current commit. `git ls-tree` reads the
 * commit, not the working tree — `git status` shows nothing for these paths
 * once they are ignored, whether or not they are tracked.
 */
export function trackedForbiddenPaths(): string[] {
  const tree = git(["ls-tree", "-r", "--name-only", "HEAD", "--", ...FORBIDDEN_PATHS]);
  if (!tree.ok) return [];
  if (tree.stdout === "") return [];
  return tree.stdout.split("\n").filter((line) => line !== "");
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

  if (branch !== PROTECTED_BRANCH) {
    const tracked = trackedForbiddenPaths();
    console.log(
      `[check-main-branch-files] OK — on branch "${branch}", not ${PROTECTED_BRANCH} ` +
        `(${tracked.length} deployment-config file(s) tracked here, which is fine ` +
        `on a Freeman branch).`,
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
