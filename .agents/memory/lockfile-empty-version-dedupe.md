---
name: package-lock empty-version dedupe crash
description: Fresh npm install crashes with "Invalid Version:" when package-lock.json has nested optional platform entries missing a version field.
---

A fresh `npm install` (e.g. in post-merge setup) can fail with
`npm error Invalid Version:` (empty string) even though the dev container runs
fine, because the running container already has `node_modules` and only a clean
install rebuilds the tree.

**Root cause:** `package-lock.json` accumulates malformed nested entries for
optional, platform-specific native packages (esbuild `@esbuild/*`, rollup
`@rollup/rollup-*`, `lightningcss-*`, `@tailwindcss/oxide-*`, `@napi-rs/canvas-*`,
`fsevents`). These nested copies under `node_modules/<pkg>/node_modules/...`
have a body of only `{ "optional": true }` (or `{ "dev": true, "optional": true }`)
with **no `version`/`resolved`/`link`**. npm arborist's `canDedupe` →
`pruneDedupable` calls semver `gte("", ...)` on the empty version and throws.
These are builds for *other* OSes, never installed on linux-x64.

**Why:** likely introduced by a lockfile merge that combined two states.

**How to apply / fix:** strip every lockfile `packages` entry that has no
`version`, no `resolved`, and no `link`, then run `npm install` to let npm
rewrite a valid, idempotent lockfile. One-liner:

```js
const fs=require("fs");const l=JSON.parse(fs.readFileSync("package-lock.json","utf8"));
for(const[k,v]of Object.entries(l.packages||{})){if(k&&v&&typeof v==="object"&&!("version"in v)&&!("resolved"in v)&&!("link"in v))delete l.packages[k];}
fs.writeFileSync("package-lock.json",JSON.stringify(l,null,2)+"\n");
```

Do NOT edit package.json to fix this — the corruption is purely in the lockfile.
Verify with a second `npm install` reporting "up to date" and a clean app boot.
