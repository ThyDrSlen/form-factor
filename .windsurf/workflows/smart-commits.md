---
description: generate small detailed commits grouped by feature
auto_execution_mode: 3
---

1. Verify working tree state.
   - `git status --short`
   - Ensure no unintended files from `android/` (ignored via `.gitignore`) are staged.
2. Capture the change set and group by feature area.
   - `git diff --name-only`
   - Group paths by top-level directory (`app/`, `components/`, `design-system/`, `contexts/`, `lib/`, `ios/`, `.kiro/`, etc.).
   - For mixed concerns inside `app/`, sub-group by route bundle (`app/(auth)/`, `app/(tabs)/`, `app/(modals)/`, `app/design-system/`, etc.).
3. Inspect each group for functions/components touched.
   - For each file in the group run `git diff --stat -- "<file>"`.
   - Skim the full diff to note key functions/components (e.g., `AddFoodScreen`, `ThemeProvider`, `useSafeBack`).
   - When multiple functions are touched, list up to three most important symbols.
4. Stage the files for the group.
   - `git add <file1> <file2> ...`
   - Re-run `git status --short` to confirm only desired files are staged.
5. Craft a descriptive commit message.
   - Use format `type(scope): summary` where scope is the grouped path (e.g., `feat(app/add-food)`, `ui(design-system)`, `fix(ios)`, `docs(kiro)`).
   - In the body add concise bullet points describing:
     - Functions/components touched (`- Touches: AddFoodScreen`)
     - Purpose and outcomes (`- Adds decimal normalization for calories`)
     - Any config/env implications.
6. Commit with detailed message.
   - `git commit -m "type(scope): summary" -m "...details..."`
   - If nothing staged (e.g., docs-only change), skip commit and continue with next group.
7. Repeat steps 3-6 for each group until no tracked changes remain.
8. Sanity check the history.
   - `git log -n 5 --oneline`
   - Ensure commits are small, scoped, and free of build artifacts.
9. Share summary (optional) by running `git log --stat -n <N>` for PR notes.