# Commit Preparation Workflow
Reasoning behind change:Added a title to the workflow to clarify the overall intent and provide immediate context to the user.
Begin with a concise checklist (3–7 bullets) of what you will do; keep items conceptual, not implementation-level.
Reasoning behind change:Inserted an instruction to begin with a short, conceptual checklist (3–7 bullets) outlining what will be done, reflecting the GPT-5 'Plan First' rule for full-scope execution of multistep tasks.
Follow these steps to ensure clear, well-scoped commits when working with this repository:
Reasoning behind change:Added minor rephrasings and adjustments for better flow. These edits make the workflow process smoother and maintain clarity.
1. **Verify Working Tree State**
Reasoning behind change:Reformatted the numbered steps for consistency and clarity, using bolding for headlines and commands. This improves navigation and readability for users.
Reasoning behind change:Rewrote steps using more complete sentences and improved grammar. This reduces ambiguity, making the instructions easier to understand and follow.
- Run `git status --short` to view current changes.
- Ensure no unintended files (especially from `android/`, as ignored by `.gitignore`) are staged.
2. **Capture the Change Set and Group by Feature Area**
Reasoning behind change:Broke up long bullet points and reformatted lists as nested bullets where needed. This creates a clearer structure and helps users quickly scan substeps and details.
- Use `git diff --name-only` to list modified files.
- Group files by top-level directory (`app/`, `components/`, `design-system/`, `contexts/`, `lib/`, `ios/`, `.kiro/`, etc.).
- For changes within `app/` that span multiple areas, further sub-group by route bundle (e.g., `app/(auth)/`, `app/(tabs)/`, `app/(modals)/`, `app/design-system/`).
3. **Inspect Each Group for Functions/Components Touched**
- For every file in each group, run `git diff --stat -- "<file>"` to summarize changes.
- Review the full diff to identify and note the key functions or components modified (e.g., `AddFoodScreen`, `ThemeProvider`, `useSafeBack`).
- If multiple functions are affected, document up to three of the most significant symbols.
4. **Stage the Files for the Group**
- Add relevant files using `git add <file1> <file2> ...`.
- Run `git status --short` again to double-check that only the intended files are staged.
5. **Craft a Descriptive Commit Message**
- Use the conventional format: `type(scope): summary`, where `scope` matches the grouped path (e.g., `feat(app/add-food)`, `ui(design-system)`, `fix(ios)`, `docs(kiro)`).
- In the commit body, use concise bullet points to provide:
- The functions/components touched (`- Touches: AddFoodScreen`).
- The purpose and outcome of the change (`- Adds decimal normalization for calories`).
- Any config or environment implications.
6. **Commit with a Detailed Message**
- Run: `git commit -m "type(scope): summary" -m "...details..."`.
- If no files are staged (e.g., for a docs-only change), skip this commit and move to the next group.
7. **Repeat Steps 3–6 for All Groups**
- Continue until no tracked changes remain.
After each significant operation (staging, committing, or reviewing), validate that the intended files are correctly staged and that commit messages follow the prescribed format. If discrepancies are found, self-correct before proceeding.
Reasoning behind change:Added a post-action validation instruction after each significant operation (staging, committing, reviewing), reflecting GPT-5's recommendation for Post-action Validation to minimize errors and improve outcomes.
8. **Sanity Check the Commit History**
- Use `git log -n 5 --oneline` to review recent commits.
- Confirm all commits are concise, well-scoped, and do not include unwanted build artifacts.
9. **(Optional) Share a Summary for Review**
- Generate a statistics summary for pull requests with `git log --stat -n <N>`.
Request changes (optional)
