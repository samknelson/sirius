#!/usr/bin/env python3
"""Optionally seed verified old Git blobs for git apply --3way. Never applies a patch."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--target", type=Path, required=True)
    parser.add_argument("--write", action="store_true", help="Explicitly authorize writing Git objects")
    args = parser.parse_args()
    root = args.package.resolve()
    target = args.target.resolve()
    probe = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=target,
                           capture_output=True, text=True, check=True)
    if Path(probe.stdout.strip()).resolve() != target:
        raise SystemExit("--target must be the receiving Git repository root")
    manifest = json.loads((root / "manifest.json").read_text())
    bases = []
    for entry in manifest["files"]:
        if entry["classification"] != "shared":
            continue
        path = (root / "base" / entry["path"]).resolve()
        if not path.is_relative_to(root / "base"):
            raise SystemExit("Unsafe base path")
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != entry["base_sha256"]:
            raise SystemExit("Base checksum mismatch: " + entry["path"])
        blob = subprocess.run(["git", "hash-object", "--stdin"], input=data,
                              cwd=target, capture_output=True, check=True).stdout.decode().strip()
        if blob != entry["base_git_blob"]:
            raise SystemExit("Git blob mismatch (or incompatible Git object format): " + entry["path"])
        bases.append(data)
    # Verify every blob before writing even the first one.
    if args.write:
        for data in bases:
            subprocess.run(["git", "hash-object", "-w", "--stdin"], input=data, cwd=target,
                           capture_output=True, check=True)
    print(f"{'Imported' if args.write else 'Verified'} {len(bases)} base blobs.")
    print("No source files, staging/index, refs, database, or application settings changed.")
    if not args.write:
        print("Dry run: use --write only when ready to seed the Git object store.")


if __name__ == "__main__":
    main()
