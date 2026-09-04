#!/usr/bin/env npx tsx
/**
 * Author-time enforcement that a Freeman deployment branch carries nothing
 * but its own deployment config — that no finished feature is sitting on it,
 * unreachable from `main`.
 *
 * The sibling rule (`check-main-branch-files.ts`) watches the files that go
 * missing. This one watches the opposite failure, which is worse: an entire
 * feature merged onto `freeman-dev` because that was the branch checked out
 * when the work finished. Nothing surfaces it — the task reads complete, the
 * merge commit exists, and the code is simply absent from `main` and from
 * everything built from it. The last one was found weeks later, by accident.
 * A deployment branch is long-lived, so the commit sits on a line `main`
 * never sees and the two diverge further the longer it sits.
 *
 * The signal is paths, not commits. A carrying branch should differ from
 * `main` only under `.github/` and `deploy/`; anything else it changed is
 * application work that never landed. Two diffs decide it, and a path must
 * appear in BOTH:
 *
 * - `main...HEAD` — what this branch changed since it diverged. This is the
 *   half that keeps a branch merely *behind* `main` passing: `main` moving
 *   ahead is normal and harmless, and a three-dot diff never looks at it.
 * - `main HEAD` — what actually differs between the two trees today. This is
 *   the half that lets the repair clear the failure: once the paths are
 *   copied onto `main`, their content matches and the rule goes quiet
 *   without the branch having to merge anything.
 *
 * Deliberately silent on `main` itself and on every other branch. From `main`
 * the rule would have to name which carrying branch drifted, and a developer
 * standing on `main` cannot act on it anyway; the branch that holds the work
 * is where the message belongs.
 *
 * Run manually:
 *
 *   npx tsx scripts/dev/check-carrying-branch-drift.ts
 *
 * Exits 0 on pass, 1 on violations.
 */
import { spawnSync } from "node:child_process";

import {
  CARRYING_BRANCHES,
  FORBIDDEN_PATHS as DEPLOYMENT_CONFIG_PATHS,
} from "./check-main-branch-files.ts";

/** The branch every carrying branch is measured against. */
const PROTECTED_BRANCH = "main";

/** Its remote-tracking copy, used when it is the more complete of the two. */
const REMOTE_MAIN = "origin/main";

function git(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return {
    ok: !result.error && result.status === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? result.error?.message ?? "").trim(),
  };
}

/**
 * A git read the verdict depends on. An empty answer is this rule's pass, so
 * a failed invocation must not be folded into one — it would report success
 * without having compared anything.
 */
function gitOrDie(args: string[], context: string): string {
  const result = git(args);
  if (result.ok) return result.stdout;

  console.error(
    [
      "",
      `[check-carrying-branch-drift] FAILED — \`git ${args.join(" ")}\` did not run:`,
      `  ${result.stderr || "unknown error"}`,
      "",
      context,
      "",
    ].join("\n"),
  );
  process.exit(1);
}

/** The current branch name, or null on a detached HEAD. */
function currentBranch(): string | null {
  const head = gitOrDie(
    ["rev-parse", "--abbrev-ref", "HEAD"],
    "The rule cannot tell which branch it is on, so it fails rather than passing blind.",
  );
  if (head === "" || head === "HEAD") return null;
  return head;
}

function commitExists(ref: string): boolean {
  return git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).ok;
}

/**
 * Which copy of `main` to compare against. A local `main` left behind by a
 * few fetches would report work that has already landed as stranded, so the
 * more complete of the two wins. Only a strict "local is an ancestor of the
 * remote" prefers the remote: diverged copies (local commits not yet pushed)
 * keep the local one, which is the copy the developer is working with.
 */
function resolveMainRef(): string {
  const local = commitExists(PROTECTED_BRANCH);
  const remote = commitExists(REMOTE_MAIN);

  if (local && remote) {
    const localInRemote = git([
      "merge-base",
      "--is-ancestor",
      PROTECTED_BRANCH,
      REMOTE_MAIN,
    ]).ok;
    const remoteInLocal = git([
      "merge-base",
      "--is-ancestor",
      REMOTE_MAIN,
      PROTECTED_BRANCH,
    ]).ok;
    return localInRemote && !remoteInLocal ? REMOTE_MAIN : PROTECTED_BRANCH;
  }
  if (local) return PROTECTED_BRANCH;
  if (remote) return REMOTE_MAIN;

  console.error(
    [
      "",
      `[check-carrying-branch-drift] FAILED — neither \`${PROTECTED_BRANCH}\` nor ` +
        `\`${REMOTE_MAIN}\` exists here.`,
      "",
      "There is nothing to compare this carrying branch against, so the rule fails",
      "rather than passing blind. Fetch the main branch and run it again.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

interface Change {
  /** A single git status letter: A, M, D, T, … (renames are split apart). */
  status: string;
  path: string;
}

function parseNameStatus(output: string): Change[] {
  if (output === "") return [];
  return output
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [status, ...rest] = line.split("\t");
      return { status: status.charAt(0), path: rest.join("\t") };
    })
    .filter((change) => change.path !== "");
}

function isDeploymentConfig(path: string): boolean {
  return DEPLOYMENT_CONFIG_PATHS.some(
    (dir) => path === dir || path.startsWith(`${dir}/`),
  );
}

/**
 * Paths this branch changed since it diverged from `main` AND whose content
 * still differs from `main` today, excluding the deployment config that
 * legitimately lives only here.
 */
function strandedChanges(mainRef: string): Change[] {
  const context =
    `The rule cannot compare this branch against ${mainRef}, so it fails rather than\n` +
    "passing blind.";

  // Three-dot: what the branch itself changed. Renames are split into a
  // delete and an add so every line is one path.
  const branchSide = parseNameStatus(
    gitOrDie(
      ["diff", "--name-status", "--no-renames", `${mainRef}...HEAD`],
      context,
    ),
  );

  // Two-dot: what actually differs between the trees right now. A path the
  // branch changed and someone has since copied onto `main` is not stranded.
  const stillDiffers = new Set(
    gitOrDie(["diff", "--name-only", mainRef, "HEAD"], context)
      .split("\n")
      .filter((line) => line !== ""),
  );

  return branchSide.filter(
    (change) => !isDeploymentConfig(change.path) && stillDiffers.has(change.path),
  );
}

function main(): void {
  const branch = currentBranch();

  if (branch === null || !CARRYING_BRANCHES.includes(branch)) {
    console.log(
      `[check-carrying-branch-drift] OK — ${branch === null ? "detached HEAD" : `on branch "${branch}"`}, ` +
        `not a carrying branch (${CARRYING_BRANCHES.join(", ")}); nothing to compare.`,
    );
    process.exit(0);
  }

  const mainRef = resolveMainRef();
  const stranded = strandedChanges(mainRef);

  if (stranded.length === 0) {
    console.log(
      `[check-carrying-branch-drift] OK — carrying branch "${branch}" differs from ` +
        `${mainRef} only under ${DEPLOYMENT_CONFIG_PATHS.map((p) => `${p}/`).join(" and ")}.`,
    );
    process.exit(0);
  }

  // Split, because the repair differs: a path this branch added or edited is
  // copied onto `main`, while one it deleted cannot be (there is nothing to
  // copy) and needs a deliberate decision instead.
  const present = stranded.filter((change) => change.status !== "D");
  const deleted = stranded.filter((change) => change.status === "D");

  console.error(
    [
      "",
      `[check-carrying-branch-drift] FAILED — carrying branch "${branch}" holds ` +
        `${stranded.length} file change(s) that are not on ${mainRef}.`,
      "",
      "A carrying branch exists to hold this environment's .github/ and deploy/ config.",
      "Anything else on it is application work that never reached main — almost always",
      "because this branch happened to be the one checked out when the work finished",
      "merging. It runs nowhere main runs, and the two lines diverge further the longer",
      "it sits.",
      "",
      ...(present.length > 0
        ? [
            "Not on main:",
            ...present.map((change) => `  ${change.status}  ${change.path}`),
            "",
            "Copy them across — from main, never by merging this branch:",
            "",
            `  git checkout ${PROTECTED_BRANCH}`,
            `  git checkout ${branch} -- ${present.map((c) => c.path).join(" ")}`,
            "  git commit",
            "",
          ]
        : []),
      ...(deleted.length > 0
        ? [
            `Deleted here, still on ${mainRef}:`,
            ...deleted.map((change) => `  D  ${change.path}`),
            "",
            "Nothing to copy for these. Decide deliberately: if the removal was intended it",
            "belongs on main as its own `git rm`; if it was not, restore them here with",
            `\`git checkout ${mainRef} -- <path>\`.`,
            "",
          ]
        : []),
      `Do NOT run \`git merge ${branch}\` on main. Merging a carrying branch pulls the`,
      "add/delete history of the gitignored .github/ and deploy/ paths into main's",
      "ancestry, which can move another carrying branch's merge base onto a commit where",
      "those files exist — that branch then takes the deletion on its next `git merge",
      "main`, silently for files it never touched. Copying the paths keeps that history",
      "off main entirely.",
      "",
      "Confirm when done:",
      "",
      `  git diff --name-only ${PROTECTED_BRANCH} ${branch}   # only .github/ and deploy/ files`,
      "",
    ].join("\n"),
  );
  process.exit(1);
}

// Only run when executed directly (tests may import the helpers).
if (process.argv[1] && /check-carrying-branch-drift\.ts$/.test(process.argv[1])) {
  main();
}
