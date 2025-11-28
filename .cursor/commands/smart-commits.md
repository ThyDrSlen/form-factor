# Smart Commit Workflow

When it says "check status" or "view diffs", use the Git MCP provider first and only fall back to the terminal when needed. This is to avoid terminal hangs.

---

## Tool Routing Rules

- For Git MCP:
  - Use MCP for `status`, file diffs, and history inspection.
  - Examples: git status summary, git diff for a file or path, git log preview.

- Never run destructive commands like `git reset --hard`, `git clean -fd`, or `git push --force` unless the user explicitly asks.

---

## Quick Checklist

- Confirm the working tree only contains intentional changes.
- Bucket files by feature or scope so commits stay focused.
- Review both staged and unstaged diffs and capture the primary symbols touched.
- Stage cleanly by intent and directory scope.
- Write a formatted commit message with a brief, outcome oriented body.
- Re run status and history checks before you push or open a PR.

---

## 0. Branch Hygiene

1. Confirm you are on a feature branch  
   - `git branch --show-current`
2. If on `main` or `master`, create a feature branch:  
   - `git switch -c feat/<short-scope>`
3. Sync with remote default branch:  
   - `git fetch origin`  
   - `git rebase origin/main` (or the project default)

---

## 1. Verify Working Tree State

- Check status using Git MCP:
  - `git status -sb` to see modified and staged files at a glance.
- Inspect diffs:
  - Unstaged: `git diff`
  - Staged: `git diff --cached`
- Unstage or stash unrelated changes before continuing.
- Repeat `git status -sb` after each major action to confirm the tree matches your expectations.

---

## 2. Map the Change Set

- List modified files:
  - `git diff --name-only`
- Group files by top level directory:
  - `app/`, `components/`, `design-system/`, `contexts/`, `lib/`, `ios/`, `.kiro/`, etc.
- For `app/`, sub group by route bundle when helpful:
  - `app/(auth)/`, `app/(tabs)/`, etc.
- Identify obvious generated or noisy files:
  - Never commit things like:
    - `ios/DerivedData/`
    - `*.xcuserstate`
    - `.DS_Store`
    - local `.env*` files  
  - If these appear in `git status -sb`, restore or ignore them instead of committing.

---

## 3. Review Each Group

For each directory group:

- Summarize scope:
  - `git diff --stat -- "<file-or-path>"`
- Read the full diff and note up to three key symbols or components touched:
  - Examples: `AddFoodScreen`, `ThemeProvider`, `FqiCalculator`.
- If a file contains both feature changes and cleanups:
  - Use `git add -p` later to split hunks into separate commits.
- Capture notes for the commit body:
  - These will feed `Touches`, `Outcome`, and `Notes`.

---

## 4. Stage Cleanly

For the current group only:

- Stage by intent:
  - Feature or bug fix changes in one commit.
  - Pure cleanups or renames in a separate `chore` or `refactor` commit.
- Use:
  - `git add <files>` for fully grouped files, or
  - `git add -p` for partial staging when feature and cleanup are mixed.
- Re run:
  - `git status -sb`  
  - `git diff --cached`  
  to verify that only the intended changes are staged.

---

## 5. Craft the Commit Message

**Format**

- `type(scope): summary`
- `scope` should match the directory grouping:
  - `feat(app/add-food)`
  - `fix(ios/build)`
  - `chore(lib/telemetry)`

**Allowed types**

- `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `build`, `ci`

**Body template (always include these bullets)**

- `- Touches: <up to 3 key symbols or components>`
- `- Outcome: <observable behavior or result>`
- `- Notes: <extra info or "None">`

Examples:

- `- Touches: AddFoodScreen, useCalorieInput`
- `- Outcome: Normalizes calorie decimal entry to avoid parsing errors`
- `- Notes: Requires DB migration 019_add_calorie_decimal`

If there is nothing special to call out, use `Notes: None`.

**Command patterns**

To preserve line breaks:

- Multiple `-m` flags:
  ```sh
  git commit -m "feat(app/add-food): normalize calorie decimals" \
    -m "- Touches: AddFoodScreen, useCalorieInput" \
    -m "- Outcome: Normalizes decimal entry and avoids parsing errors" \
    -m "- Notes: None"
