# Smart Commit Workflow

## Quick Checklist

- Confirm the working tree only contains intentional changes.
- Bucket files by feature or scope so commits stay focused.
- Review diffs, capture the primary symbols touched, and stage cleanly.
- Write a formatted commit message with a brief, outcome-oriented body.
- Re-run status and history checks before you push or open a PR.

## Steps

1. **Verify Working Tree State**
   - Run `git status -sb` to see modified and staged files at a glance.
   - Unstage or stash unrelated changes before continuing.
   - Repeat `git status -sb` after each major action to confirm the tree matches your expectations.
2. **Map the Change Set**
   - Use `git diff --name-only` to list modified files.
   - Group files by top-level directory (`app/`, `components/`, `design-system/`, `contexts/`, `lib/`, `ios/`, `.kiro/`, etc.).
   - For `app/`, sub-group by route bundle when it improves clarity (e.g., `app/(auth)/`, `app/(tabs)/`).
3. **Review Each Group**
   - Summarize scope with `git diff --stat -- "<file>"`.
   - Read the full diff, noting up to three key symbols or components per group (e.g., `AddFoodScreen`, `ThemeProvider`).
   - Capture these notes for your commit body.
4. **Stage Cleanly**
   - Stage only the files in the active group (`git add <files>` or `git add -p` for partials).
   - Re-run `git status -sb` to verify nothing unexpected is staged.
5. **Craft the Commit Message**
   - Format: `type(scope): summary`, aligning `scope` with the directory grouping (e.g., `feat(app/add-food)`).
   - In the body, add short bullets such as:
     - `- Touches: AddFoodScreen`
     - `- Outcome: Normalizes calorie decimal entry`
     - `- Notes: Requires schema migration` (only when needed)
   - Use one of these patterns to preserve actual line breaks (avoid literal `\n` in shells):
     - Multiple flags: `git commit -m "type(scope): summary" -m "- Touches: …" -m "- Outcome: …"`
     - Here-doc: 
       ```
       git commit --amend -F - <<'EOF'
       type(scope): summary

       - Touches: …
       - Outcome: …
       EOF
       ```
   - When rewording, you can skip pre-commit hooks with `HUSKY=0 git commit --amend …` to avoid linting historical snapshots; re-enable hooks for new work.
6. **Commit and Validate**
   - Run `git commit -m "type(scope): summary" -m "...details..."`.
   - Immediately follow up with `git status -sb`; the staged area should be clean.
   - If tests or linting are required for this scope, run them now.
7. **Repeat for Remaining Groups**
   - Return to Step 3 for the next group until all tracked changes are committed.
8. **Sanity Check History**
   - Use `git log --oneline -5` (or similar) to confirm the new commit fits the project’s conventions.
   - Ensure no auto-generated artifacts slipped into history.
9. **Optional: Share a Summary**
   - Generate a stats overview for reviewers with `git log --stat -n <N>`.
