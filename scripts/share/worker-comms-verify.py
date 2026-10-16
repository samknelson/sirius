#!/usr/bin/env python3
"""Verify an extracted handoff without executing app code or changing its target."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile


def run(args, cwd):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--patch-test", action="store_true")
    parser.add_argument("--target", type=Path)
    args = parser.parse_args()
    root = args.package.resolve()
    manifest = json.loads((root / "manifest.json").read_text())
    failures = []
    for entry in manifest["artifacts"]:
        path = (root / entry["path"]).resolve()
        if not path.is_relative_to(root):
            raise SystemExit("Unsafe package path")
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != entry["sha256"]:
            failures.append(entry["path"])
    if failures:
        raise SystemExit("Integrity failures: " + ", ".join(failures))
    print(f"Integrity: {len(manifest['artifacts'])} packaged artifacts verified")

    if args.patch_test:
        with tempfile.TemporaryDirectory(prefix="worker-comms-patch-") as directory:
            temp = Path(directory)
            subprocess.run(["git", "init", "-q", directory], check=True)
            for entry in manifest["files"]:
                if entry["classification"] == "shared":
                    dest = temp / entry["path"]
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes((root / "base" / entry["path"]).read_bytes())
            result = run(["git", "apply", str(root / "feature.patch")], temp)
            if result.returncode:
                raise SystemExit("Patch reconstruction failed:\n" + result.stderr)
            for entry in manifest["files"]:
                if (temp / entry["path"]).read_bytes() != (root / "source" / entry["path"]).read_bytes():
                    raise SystemExit("Reconstructed source differs: " + entry["path"])
            print(f"Patch reconstruction: all {len(manifest['files'])} source files match")

    if args.target:
        target = args.target.resolve()
        if not target.is_dir():
            raise SystemExit("Target directory does not exist")
        probe = run(["git", "rev-parse", "--show-toplevel"], target)
        if probe.returncode or Path(probe.stdout.strip()).resolve() != target:
            raise SystemExit("--target must be the receiving Git repository root")
        status = run(["git", "status", "--porcelain"], target)
        print("Target working tree:", "DIRTY — commit/stash before applying" if status.stdout else "clean")
        for entry in manifest["files"]:
            path = target / entry["path"]
            if not path.exists():
                state = "new path available" if entry["classification"] == "new" else "MISSING SHARED FRAMEWORK FILE"
            elif path.is_file():
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                state = "already matches source" if digest == entry["source_sha256"] else (
                    "matches pre-feature base" if digest == entry.get("base_sha256") else "DIFFERS — review/merge")
            else:
                state = "PATH COLLISION — not a regular file"
            print(f"  {state}: {entry['path']}")
        missing = []
        for dependency in manifest["direct_local_imports"]:
            if not any((target / candidate).is_file() or (root / "source" / candidate).is_file()
                       for candidate in dependency["candidates"]):
                missing.append(f"{dependency['from']}: {dependency['specifier']}")
        print("Missing direct prerequisite paths:", len(missing))
        for item in missing:
            print("  " + item)
        result = run(["git", "apply", "--check", str(root / "feature.patch")], target)
        print("Direct patch check:", "PASS" if not result.returncode else "NEEDS MERGE")
        if result.returncode:
            print(result.stderr.strip())
        print("Compatibility report only: no target files, Git objects, index or database changed.")


if __name__ == "__main__":
    main()
