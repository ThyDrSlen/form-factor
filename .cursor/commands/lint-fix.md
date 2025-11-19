# Lint & Fix Workflow

## Objective
- Keep `bun run lint` at 0 errors / 0 warnings with minimal manual effort.
- Use fast feedback loops inside Cursor, capturing outputs for context.
- Pair lint passes with `bun run check:types` so fixes stay type-safe.

## Preflight
1. Confirm dependencies are fresh: `bun install`.
2. Snapshot current tree: `git status --short` and note any pre-existing noise.
3. Open a scratch note if you expect multiple manual fixes; jot remaining rule IDs there.

## Baseline Scan
1. Run `bun run lint --max-warnings=0`.
   - Copy the exit code and the error/warning totals into the command context.
   - If the command passes cleanly, stop here and report success.
2. When it fails, immediately capture the stderr/stdout block so later comparisons are easy.

## Automated Pass
1. Run `bun run lint --fix --max-warnings=0`.
   - Keep the output; if ESLint applies fixes, re-run `git status --short` to see touched files.
   - If no files changed but lint still fails, skip to Manual Pass.
2. Re-run `bun run lint --max-warnings=0` to measure the delta.

## Manual Pass
1. Generate a categorized report for reference: `bun run lint --max-warnings=0 --format json > /tmp/eslint-report.json`.
2. Summarize outstanding problems by rule (Cursor can `jq 'group_by(.ruleId)'` if needed).
3. Tackle remaining issues rule-by-rule, using this priority:
   - `react-hooks/rules-of-hooks`, `react-hooks/exhaustive-deps`
   - `@typescript-eslint/no-unused-vars`
   - `import/no-duplicates`, `@typescript-eslint/no-require-imports`
   - Formatting / JSX entity rules
4. After each file edit, run targeted lint when practical: `bun run lint --max-warnings=0 -- "<path/to/file>"`.
5. Once a batch of fixes is done, run a full `bun run lint --max-warnings=0`.
6. Repeat Manual Pass steps until ESLint reports `0 problems (0 errors, 0 warnings)`.

## Type & CI Validation
1. Run `bun run check:types` to ensure TypeScript is still happy.
2. Optionally run the full local suite: `bun run ci:local` (runs lint + types in CI parity).
3. If either command fails, treat new issues as regressions and resolve before proceeding.

## Post-run Hygiene
1. Inspect changes with `git status --short`; review diffs for risky refactors.
2. Remove temporary artifacts such as `/tmp/eslint-report.json` when done.
3. Document any justified `eslint-disable` additions with a short inline reason.
4. If residual lint violations must remain, list them in a TODO (with owner/date) and link in the PR description.

## Notes & Heuristics
- Prefer `_unused` prefixes only when the symbol is required by an API signature.
- For hook dependency loops, stabilize callbacks with `useCallback`/`useMemo` or fall back to `useRef`.
- Only disable lint rules when a platform constraint forces imperative `require()` or similar; always explain why.
- Keep a running tally of resolved issues vs. remaining ones so progress is visible in the thread.
- After completing the workflow, suggest rerunning `bun run lint` if the user continues editing the same files.

