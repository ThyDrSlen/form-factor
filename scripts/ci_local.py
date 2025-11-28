#!/usr/bin/env python3
"""
ci_local.py - Mirror GitHub Actions CI/CD pipeline locally

Run this before pushing to catch CI failures early.
Mirrors the jobs in .github/workflows/ci-cd.yml

Usage:
    python3 scripts/ci_local.py           # Run all checks
    python3 scripts/ci_local.py --quick   # Skip native build (faster)
    python3 scripts/ci_local.py --e2e     # Include E2E tests
"""

import subprocess
import sys
import os
import argparse
from pathlib import Path
from typing import Optional, List, Tuple
from dataclasses import dataclass
from enum import Enum

ROOT = Path(__file__).parent.parent


class Colors:
    RED = '\033[0;31m'
    GREEN = '\033[0;32m'
    YELLOW = '\033[1;33m'
    BLUE = '\033[0;34m'
    MAGENTA = '\033[0;35m'
    CYAN = '\033[0;36m'
    NC = '\033[0m'
    BOLD = '\033[1m'


class Status(Enum):
    PASS = "pass"
    FAIL = "fail"
    WARN = "warn"
    SKIP = "skip"


@dataclass
class StepResult:
    name: str
    status: Status
    message: Optional[str] = None


def log(msg: str, color: str = Colors.BLUE):
    print(f"{color}▶ {msg}{Colors.NC}")


def log_job(job_num: int, name: str):
    print(f"\n{Colors.BOLD}{Colors.MAGENTA}{'='*60}{Colors.NC}")
    print(f"{Colors.BOLD}{Colors.MAGENTA}JOB {job_num}: {name}{Colors.NC}")
    print(f"{Colors.MAGENTA}{'='*60}{Colors.NC}\n")


def success(msg: str):
    print(f"{Colors.GREEN}✅ {msg}{Colors.NC}")


def warn(msg: str):
    print(f"{Colors.YELLOW}⚠️  {msg}{Colors.NC}")


def error(msg: str):
    print(f"{Colors.RED}❌ {msg}{Colors.NC}")


def skip(msg: str):
    print(f"{Colors.CYAN}⏭️  {msg}{Colors.NC}")


def run(cmd: str, cwd: Optional[Path] = None, check: bool = True, 
        capture: bool = False, timeout: int = 600) -> Tuple[bool, str]:
    """Run command and return (success, output)."""
    print(f"\n{Colors.CYAN}$ {cmd}{Colors.NC}")
    try:
        result = subprocess.run(
            cmd, 
            shell=True, 
            cwd=cwd or ROOT,
            capture_output=capture,
            text=True,
            timeout=timeout
        )
        output = result.stdout if capture else ""
        if result.returncode != 0:
            if capture and result.stderr:
                output = result.stderr
            return (False, output)
        return (True, output)
    except subprocess.TimeoutExpired:
        return (False, "Command timed out")
    except Exception as e:
        return (False, str(e))


def check_tool(name: str, cmd: str) -> bool:
    """Check if a tool is available."""
    result = subprocess.run(f"command -v {cmd}", shell=True, capture_output=True)
    return result.returncode == 0


def run_job_quality() -> List[StepResult]:
    """Job 1: Code Quality & Testing (mirrors 'quality' job in CI)"""
    log_job(1, "Code Quality & Testing")
    results = []
    
    # Install dependencies
    log("Installing dependencies...")
    ok, _ = run("bun install")
    results.append(StepResult("Install deps", Status.PASS if ok else Status.FAIL))
    if not ok:
        error("Dependency install failed - cannot continue")
        return results
    success("Dependencies installed")
    
    # TypeScript type checking
    log("TypeScript type checking...")
    ok, _ = run("bun run tsc --noEmit")
    results.append(StepResult("TypeScript", Status.PASS if ok else Status.FAIL))
    if ok:
        success("TypeScript check passed")
    else:
        error("TypeScript errors found")
    
    # ESLint
    log("Running ESLint...")
    ok, _ = run("bun run lint")
    results.append(StepResult("ESLint", Status.PASS if ok else Status.FAIL))
    if ok:
        success("ESLint passed")
    else:
        error("ESLint errors found")
    
    # Unused dependencies check (non-blocking)
    log("Checking for unused dependencies...")
    ok, _ = run("bunx depcheck --ignores='@types/*,eslint*,@babel/*,babel-*,metro-*,expo-*,playwright,jest-expo,@testing-library/*' || true")
    results.append(StepResult("Depcheck", Status.PASS if ok else Status.WARN, "Non-blocking"))
    if ok:
        success("Dependency check complete")
    else:
        warn("Some unused dependencies detected (non-blocking)")
    
    return results


def run_job_build_check() -> List[StepResult]:
    """Job 2: Build Verification (mirrors 'build-check' job in CI)"""
    log_job(2, "Build Verification")
    results = []
    
    # Check if EAS CLI is available and logged in
    log("Verifying EAS configuration...")
    ok, output = run("bunx eas whoami", capture=True)
    if not ok:
        warn("Not logged into EAS - skipping EAS verification")
        warn("Run 'bunx eas login' to enable this check")
        results.append(StepResult("EAS config", Status.SKIP, "Not logged in"))
        return results
    
    success(f"Logged into EAS as: {output.strip()}")
    
    # Verify EAS config by checking eas.json validity
    log("Verifying EAS build config...")
    ok, _ = run("bunx eas config --platform ios --profile preview", capture=True, timeout=60)
    results.append(StepResult("EAS config", Status.PASS if ok else Status.WARN))
    if ok:
        success("EAS configuration valid")
    else:
        warn("EAS config check had issues (may still work in CI)")
    
    return results


def run_job_prebuild() -> List[StepResult]:
    """Job 3: Expo Prebuild & Native Build"""
    log_job(3, "Expo Prebuild & Native Build")
    results = []
    
    # Expo prebuild
    log("Running expo prebuild (generates ios/android)...")
    ok, _ = run("bunx expo prebuild --clean", timeout=300)
    results.append(StepResult("Expo prebuild", Status.PASS if ok else Status.FAIL))
    if ok:
        success("Prebuild complete")
    else:
        error("Prebuild failed")
        return results  # Can't continue without prebuild
    
    # Pod install
    ios_dir = ROOT / "ios"
    if ios_dir.exists():
        log("Running pod install...")
        ok, _ = run("pod install", cwd=ios_dir, timeout=300)
        results.append(StepResult("Pod install", Status.PASS if ok else Status.FAIL))
        if ok:
            success("Pod install complete")
        else:
            error("Pod install failed")
            return results
        
        # iOS build check (simulator, no signing)
        log("Building iOS for simulator (no signing)...")
        
        # Check for xcpretty
        has_xcpretty = check_tool("xcpretty", "xcpretty")
        pipe_cmd = "| xcpretty" if has_xcpretty else ""
        
        xcode_cmd = (
            f"xcodebuild -workspace formfactoreas.xcworkspace "
            f"-scheme formfactoreas -configuration Debug "
            f"-sdk iphonesimulator "
            f"-destination 'platform=iOS Simulator,name=iPhone 15 Pro' "
            f"build CODE_SIGNING_ALLOWED=NO {pipe_cmd}"
        )
        ok, _ = run(xcode_cmd, cwd=ios_dir, timeout=600)
        results.append(StepResult("iOS build", Status.PASS if ok else Status.FAIL))
        if ok:
            success("iOS build succeeded")
        else:
            error("iOS build failed - this will fail in CI!")
    else:
        warn("ios/ folder not found after prebuild")
        results.append(StepResult("iOS build", Status.SKIP, "No ios/ folder"))
    
    return results


def run_job_tests() -> List[StepResult]:
    """Job 4: Unit Tests"""
    log_job(4, "Unit Tests")
    results = []
    
    log("Running Jest unit tests...")
    ok, _ = run("bun run test -- --passWithNoTests", timeout=120)
    results.append(StepResult("Unit tests", Status.PASS if ok else Status.WARN))
    if ok:
        success("Unit tests passed")
    else:
        warn("Some unit tests failed")
    
    return results


def run_job_security() -> List[StepResult]:
    """Job 5: Security Scan (mirrors 'security' job in CI)"""
    log_job(5, "Security Scan")
    results = []
    
    # Dependency audit
    log("Running dependency audit...")
    ok, _ = run("bun pm audit 2>/dev/null || npm audit --audit-level moderate 2>/dev/null || true")
    results.append(StepResult("Dep audit", Status.PASS if ok else Status.WARN, "Non-blocking"))
    success("Dependency audit complete")
    
    # audit-ci config check
    audit_config = ROOT / "config" / "audit-ci.json"
    if audit_config.exists():
        log("Running audit-ci...")
        ok, _ = run(f"bunx audit-ci --config {audit_config} || true")
        results.append(StepResult("audit-ci", Status.PASS if ok else Status.WARN))
    
    return results


def run_job_e2e() -> List[StepResult]:
    """Job 6: E2E Tests (Playwright)"""
    log_job(6, "E2E Tests (Playwright)")
    results = []
    
    log("Running Playwright E2E tests...")
    ok, _ = run("bunx playwright test", timeout=300)
    results.append(StepResult("E2E tests", Status.PASS if ok else Status.FAIL))
    if ok:
        success("E2E tests passed")
    else:
        error("E2E tests failed")
    
    return results


def print_summary(all_results: List[StepResult]):
    """Print final summary."""
    print(f"\n{Colors.BOLD}{'='*60}{Colors.NC}")
    print(f"{Colors.BOLD}SUMMARY{Colors.NC}")
    print(f"{'='*60}\n")
    
    passed = [r for r in all_results if r.status == Status.PASS]
    failed = [r for r in all_results if r.status == Status.FAIL]
    warned = [r for r in all_results if r.status == Status.WARN]
    skipped = [r for r in all_results if r.status == Status.SKIP]
    
    for r in all_results:
        if r.status == Status.PASS:
            print(f"  {Colors.GREEN}✅ {r.name}{Colors.NC}")
        elif r.status == Status.FAIL:
            print(f"  {Colors.RED}❌ {r.name}{Colors.NC}")
        elif r.status == Status.WARN:
            msg = f" ({r.message})" if r.message else ""
            print(f"  {Colors.YELLOW}⚠️  {r.name}{msg}{Colors.NC}")
        elif r.status == Status.SKIP:
            msg = f" ({r.message})" if r.message else ""
            print(f"  {Colors.CYAN}⏭️  {r.name}{msg}{Colors.NC}")
    
    print(f"\n{Colors.BOLD}Results:{Colors.NC}")
    print(f"  Passed:  {len(passed)}")
    print(f"  Failed:  {len(failed)}")
    print(f"  Warned:  {len(warned)}")
    print(f"  Skipped: {len(skipped)}")
    
    if failed:
        print(f"\n{Colors.RED}{Colors.BOLD}❌ CI will likely FAIL{Colors.NC}")
        print(f"{Colors.RED}Fix these issues before pushing:{Colors.NC}")
        for r in failed:
            print(f"  - {r.name}")
        return False
    else:
        print(f"\n{Colors.GREEN}{Colors.BOLD}✅ CI should PASS{Colors.NC}")
        if warned:
            print(f"{Colors.YELLOW}Note: Some warnings to review{Colors.NC}")
        return True


def main():
    parser = argparse.ArgumentParser(
        description="Run CI checks locally before pushing",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python3 scripts/ci_local.py           # Full check
    python3 scripts/ci_local.py --quick   # Skip native build
    python3 scripts/ci_local.py --e2e     # Include E2E tests
        """
    )
    parser.add_argument("--quick", action="store_true", 
                        help="Skip native build (faster)")
    parser.add_argument("--e2e", action="store_true",
                        help="Include E2E tests")
    parser.add_argument("--skip-prebuild", action="store_true",
                        help="Skip expo prebuild step")
    args = parser.parse_args()
    
    print(f"{Colors.BOLD}{Colors.MAGENTA}")
    print("╔══════════════════════════════════════════════════════════╗")
    print("║           Form Factor - Local CI Check                   ║")
    print("║   Mirrors .github/workflows/ci-cd.yml                    ║")
    print("╚══════════════════════════════════════════════════════════╝")
    print(f"{Colors.NC}")
    
    all_results: List[StepResult] = []
    
    # Job 1: Quality
    all_results.extend(run_job_quality())
    
    # Check for blocking failures
    if any(r.status == Status.FAIL for r in all_results):
        error("Quality checks failed - fix before continuing")
        print_summary(all_results)
        sys.exit(1)
    
    # Job 2: Build check
    all_results.extend(run_job_build_check())
    
    # Job 3: Prebuild & Native build
    if not args.quick and not args.skip_prebuild:
        all_results.extend(run_job_prebuild())
    else:
        skip("Skipping prebuild/native build (--quick or --skip-prebuild)")
        all_results.append(StepResult("Prebuild", Status.SKIP, "Skipped via flag"))
    
    # Job 4: Unit tests
    all_results.extend(run_job_tests())
    
    # Job 5: Security
    all_results.extend(run_job_security())
    
    # Job 6: E2E (optional)
    if args.e2e:
        all_results.extend(run_job_e2e())
    else:
        skip("Skipping E2E tests (use --e2e to include)")
        all_results.append(StepResult("E2E tests", Status.SKIP, "Use --e2e flag"))
    
    # Summary
    passed = print_summary(all_results)
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
