#!/usr/bin/env python3

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Iterable


FLOATING_REF_RE = re.compile(r"^\s*uses:\s*[^@\s]+@(main|master)\b", re.IGNORECASE)
LATEST_EXPO_EAS_RE = re.compile(
    r"^\s*(expo-version|eas-version|version)\s*:\s*latest\s*$", re.IGNORECASE
)
TOP_LEVEL_PERMISSIONS_RE = re.compile(r"^permissions:\s*$")
WRITE_PERMISSION_RE = re.compile(r":\s*write\b", re.IGNORECASE)


def _default_workflow_files(repo_root: Path) -> list[Path]:
    workflows_dir = repo_root / ".github" / "workflows"
    return sorted([*workflows_dir.glob("*.yml"), *workflows_dir.glob("*.yaml")])


def _parse_needs(block_lines: list[str]) -> list[str]:
    needs: list[str] = []
    for idx, line in enumerate(block_lines):
        match = re.match(r"^\s{4}needs:\s*(.*)$", line)
        if not match:
            continue

        inline = match.group(1).strip()
        if inline:
            if inline.startswith("[") and inline.endswith("]"):
                inner = inline[1:-1].strip()
                if not inner:
                    return []
                return [item.strip() for item in inner.split(",") if item.strip()]
            return [inline]

        for subline in block_lines[idx + 1 :]:
            if re.match(r"^\s{2}[A-Za-z0-9_-]+:\s*$", subline):
                break
            list_match = re.match(r"^\s{6}-\s*([A-Za-z0-9_-]+)\s*$", subline)
            if list_match:
                needs.append(list_match.group(1))
        return needs

    return needs


def _extract_job_block(lines: list[str], job_name: str) -> list[str]:
    start = None
    for idx, line in enumerate(lines):
        if re.match(rf"^\s{{2}}{re.escape(job_name)}:\s*$", line):
            start = idx
            break

    if start is None:
        return []

    block: list[str] = []
    for line in lines[start:]:
        if block and re.match(r"^\s{2}[A-Za-z0-9_-]+:\s*$", line):
            break
        block.append(line)
    return block


def _check_top_level_permissions(
    file_path: Path, lines: list[str], violations: list[str]
) -> None:
    for idx, line in enumerate(lines):
        if not TOP_LEVEL_PERMISSIONS_RE.match(line):
            continue

        for block_line in lines[idx + 1 :]:
            if not block_line.strip():
                continue
            if not block_line.startswith(" "):
                break
            if "write-all" in block_line:
                violations.append(f"{file_path}: top-level permissions uses write-all")
            if WRITE_PERMISSION_RE.search(block_line):
                violations.append(
                    f"{file_path}: top-level permissions contains write scope ({block_line.strip()})"
                )
        return


def _check_floating_refs(
    file_path: Path, lines: Iterable[str], violations: list[str]
) -> None:
    for line_no, line in enumerate(lines, start=1):
        if FLOATING_REF_RE.match(line):
            violations.append(
                f"{file_path}:{line_no}: floating ref is forbidden ({line.strip()})"
            )
        if LATEST_EXPO_EAS_RE.match(line):
            violations.append(
                f"{file_path}:{line_no}: latest expo/eas version is forbidden ({line.strip()})"
            )


def _check_deploy_security_gating(
    file_path: Path, lines: list[str], violations: list[str]
) -> None:
    if file_path.name != "ci-cd.yml":
        return

    for deploy_job in ("deploy-staging", "deploy-production"):
        block = _extract_job_block(lines, deploy_job)
        if not block:
            violations.append(f"{file_path}: missing expected job '{deploy_job}'")
            continue

        needs = _parse_needs(block)
        if "security" not in needs:
            violations.append(
                f"{file_path}: job '{deploy_job}' must depend on 'security' (current needs: {needs or 'none'})"
            )


def run_policy_check(files: list[Path]) -> list[str]:
    violations: list[str] = []

    for file_path in files:
        if not file_path.exists():
            violations.append(f"{file_path}: file does not exist")
            continue

        lines = file_path.read_text(encoding="utf-8").splitlines()
        _check_floating_refs(file_path, lines, violations)
        _check_top_level_permissions(file_path, lines, violations)
        _check_deploy_security_gating(file_path, lines, violations)

    return violations


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate GitHub Actions workflow policy constraints."
    )
    parser.add_argument("files", nargs="*", help="Optional workflow files to validate")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    if args.files:
        files = [
            Path(item).resolve() if Path(item).is_absolute() else (repo_root / item)
            for item in args.files
        ]
    else:
        files = _default_workflow_files(repo_root)

    violations = run_policy_check(files)
    if violations:
        print("CI policy violations found:")
        for item in violations:
            print(f"- {item}")
        return 1

    print(f"CI policy check passed for {len(files)} workflow file(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
