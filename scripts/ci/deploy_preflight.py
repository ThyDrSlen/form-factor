#!/usr/bin/env python3

from __future__ import annotations

import argparse
import os
import sys


REQUIRED_ENV = {
    "staging": [
        "EXPO_TOKEN",
        "SUPABASE_ACCESS_TOKEN",
        "SUPABASE_STAGING_PROJECT_REF",
    ],
    "production": [
        "EXPO_TOKEN",
        "SUPABASE_ACCESS_TOKEN",
        "SUPABASE_PRODUCTION_PROJECT_REF",
        "ASC_API_KEY_P8_BASE64",
    ],
}

ALLOWED_REF = {
    "staging": "refs/heads/develop",
    "production": "refs/heads/main",
}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate deploy preflight requirements"
    )
    parser.add_argument("--env", required=True, choices=["staging", "production"])
    parser.add_argument("--ref", required=True)
    args = parser.parse_args()

    missing = [name for name in REQUIRED_ENV[args.env] if not os.getenv(name)]
    if missing:
        print(
            f"Preflight failed: missing required environment variables for {args.env}: {', '.join(missing)}"
        )
        return 1

    expected_ref = ALLOWED_REF[args.env]
    if args.ref != expected_ref:
        print(
            f"Preflight failed: {args.env} deploys are only allowed from {expected_ref}, got {args.ref}"
        )
        return 1

    print(f"Preflight passed for {args.env} on {args.ref}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
