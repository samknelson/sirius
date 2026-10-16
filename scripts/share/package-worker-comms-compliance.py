#!/usr/bin/env python3
"""Build a source-only handoff from fixed Git revisions; never reads env or databases."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]
# Parent of the initial component integration, not the benefit-history increment.
DEFAULT_BASE = "8b55ed1fa3d0bb014c80fa342e02c15241aa3be1"
FILES = [
    "shared/worker-comms-compliance.ts", "shared/components.ts",
    "server/modules/worker-comms-compliance.ts", "server/services/worker-comms-compliance.ts",
    "server/storage/worker-comms-compliance.ts", "server/storage/workers.ts",
    "server/storage/database.ts", "server/routes.ts",
    "server/plugins/dashboard/plugins/worker-comms-compliance.ts",
    "server/plugins/dashboard/index.ts", "server/plugins/menu/plugins/default.ts",
    "server/modules/bulk/messages.ts", "client/src/App.tsx",
    "client/src/components/bulk/list-bulk-action.tsx",
    "client/src/components/workers/comms-definition-editor.tsx",
    "client/src/pages/worker-comms-compliance.tsx",
    "client/src/plugins/dashboard/worker-comms-compliance/WorkerCommsCompliance.tsx",
    "tests/comm/worker-comms-compliance.test.ts",
    "tests/comm/worker-comms-compliance-service.test.ts",
    "tests/comm/worker-comms-compliance-routes.test.ts",
    "tests/comm/worker-comms-compliance-ui.test.tsx",
    "tests/comm/worker-comms-benefit-history-db.test.ts",
]
REFERENCES = [
    "client/src/components/bulk/existing-message-chooser-content.tsx",
    "server/storage/worker-search-conditions.ts", "shared/commStatus.ts",
    "shared/utils/date.ts",
]


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=DEFAULT_BASE)
    parser.add_argument("--source", default="HEAD")
    args = parser.parse_args()
    base = git("rev-parse", args.base).decode().strip()
    source = git("rev-parse", args.source).decode().strip()
    # A revision-specific directory keeps older handoffs intact.
    name = "worker-comms-compliance-" + source[:12]
    out = ROOT / "generated-artifacts" / name
    if out.exists():
        raise SystemExit(f"Already exists: {out}; keep it or remove it explicitly before regenerating")
    out.mkdir(parents=True)

    def put(path, data):
        dest = out / path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)

    entries, imports = [], []
    for path in FILES:
        content = git("show", f"{source}:{path}")
        put("source/" + path, content)
        old = subprocess.run(["git", "show", f"{base}:{path}"], cwd=ROOT, capture_output=True)
        entry = {"path": path, "classification": "shared" if old.returncode == 0 else "new",
                 "source_sha256": sha(content),
                 "source_git_blob": git("rev-parse", f"{source}:{path}").decode().strip()}
        if old.returncode == 0:
            put("base/" + path, old.stdout)
            entry.update(base_sha256=sha(old.stdout),
                         base_git_blob=git("rev-parse", f"{base}:{path}").decode().strip())
        entries.append(entry)
        if entry["classification"] == "new" or path.endswith("list-bulk-action.tsx"):
            for spec in sorted(set(re.findall(r'(?:from\s*|import\s*)["\']([^"\']+)["\']', content.decode()))):
                if spec.startswith("@shared/"):
                    candidate = "shared/" + spec[len("@shared/"):]
                elif spec.startswith("@/"):
                    candidate = "client/src/" + spec[2:]
                elif spec.startswith("."):
                    candidate = str(Path(path).parent / spec)
                else:
                    continue
                # Normalize relative .. segments without resolving against runtime cwd.
                candidate = str((ROOT / candidate).resolve().relative_to(ROOT))
                imports.append({"from": path, "specifier": spec,
                                "candidates": [candidate + ext for ext in
                                               ("", ".ts", ".tsx", ".js", "/index.ts", "/index.tsx")]})
    put("feature.patch", git("diff", "--binary", "--full-index", base, source, "--", *FILES))
    for path in REFERENCES:
        put("reference/" + path, git("show", f"{source}:{path}"))
    for doc in ("README.md", "INTEGRATION.md"):
        put(doc, (ROOT / "docs/sharing/worker-comms-compliance" / doc).read_bytes())
    for original, dest in [("worker-comms-verify.py", "verify.py"),
                           ("worker-comms-seed-bases.py", "seed_merge_bases.py")]:
        put("tools/" + dest, (ROOT / "scripts/share" / original).read_bytes())
    package = json.loads(git("show", f"{source}:package.json"))
    libraries = ("react", "react-dom", "@tanstack/react-query", "wouter", "lucide-react",
                 "zod", "drizzle-orm", "express", "vitest")
    versions = {name: package.get("dependencies", {}).get(name) or
                package.get("devDependencies", {}).get(name) for name in libraries}
    artifacts = [{"path": str(path.relative_to(out)), "sha256": sha(path.read_bytes())}
                 for path in sorted(out.rglob("*")) if path.is_file()]
    manifest = {"format": 1, "component": "worker.comms_compliance",
                "source_commit": source, "pre_feature_commit": base,
                "files": entries, "reference_files": REFERENCES,
                "direct_local_imports": imports, "source_library_versions": versions,
                "artifacts": artifacts,
                "note": "SHA-256 detects corruption, not publisher authenticity. No application data included."}
    put("manifest.json", (json.dumps(manifest, indent=2) + "\n").encode())
    subprocess.run(["python3", str(out / "tools/verify.py"), "--patch-test"], check=True, cwd=ROOT)
    archive = out.with_suffix(".zip")
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zipped:
        for path in sorted(out.rglob("*")):
            if path.is_file():
                zipped.write(path, str(Path(name) / path.relative_to(out)))
    with zipfile.ZipFile(archive) as zipped:
        if zipped.testzip():
            raise SystemExit("Archive integrity check failed")
    print(json.dumps({"archive": str(archive.relative_to(ROOT)), "bytes": archive.stat().st_size,
                      "sha256": sha(archive.read_bytes()), "files": len(entries),
                      "shared": sum(e["classification"] == "shared" for e in entries)}, indent=2))


if __name__ == "__main__":
    main()
