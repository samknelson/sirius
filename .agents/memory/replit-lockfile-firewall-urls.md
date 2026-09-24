---
name: Replit lockfile firewall URLs break external CI
description: Regenerating package-lock.json inside Replit writes internal proxy URLs that external CI (GitHub Actions) cannot reach.
---

**Rule:** After running any `npm install` / `npm install --package-lock-only` inside the Replit workspace, check package-lock.json for `http://package-firewall.replit.local/npm/` in `resolved` fields before the lockfile is used by external CI. Rewrite with:

```
sed -i 's|http://package-firewall.replit.local/npm/|https://registry.npmjs.org/|g' package-lock.json
```

**Why:** Replit routes npm through an internal proxy and npm records that proxy host as the tarball `resolved` URL. GitHub Actions runners fail `npm ci` with `EAI_AGAIN package-firewall.replit.local`. Versions and integrity hashes are unaffected — only the URL host needs rewriting.

**How to apply:** Any time a lockfile is (re)generated here and the repo is built outside Replit (GitHub Actions, Docker CI, etc.). Verify with `grep -c package-firewall package-lock.json` → must be 0.

Related CI lessons from the same incident (freeman repo, July 2026):
- npm 10.8.2 (bundled with Node 20.20.x) can crash `npm ci` with "Exit handler never called!" while exiting 0, leaving node_modules half-installed → phantom tsc errors like "Cannot find module 'pg'". Fix: `npm install -g npm@11` before `npm ci`, plus a `require.resolve` sanity check after install.
- npm 11 `npm ci` is stricter: it requires all optional platform-specific packages (esbuild/@tailwindcss/oxide/@napi-rs binaries) in the lockfile; older lockfiles missing them fail with EUSAGE "Missing: ... from lock file". Fix: `npx -y npm@11 install --package-lock-only` (adds entries, changes no versions) — then apply the URL rewrite above.
- GitHub Actions re-runs rebuild the SAME commit with the SAME workflow snapshot; pushed workflow fixes only take effect on a NEW run.
- Pushing changes under `.github/workflows/` requires a token with `workflow` scope; Replit's git OAuth token lacks it. Workaround: `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push ...` (gh device-flow token has the scope).
