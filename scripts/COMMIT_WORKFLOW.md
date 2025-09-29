# Smart Commit Workflow

This document outlines the workflow for creating focused, smaller commits by grouping files based on relevance and type.

## Quick Reference

### Manual Workflow
```bash
# 1. Check status
git status

# 2. Stage files by category
git add [files...]

# 3. Commit with descriptive message
git commit -m "type: description"

# 4. Push changes
git push origin main
```

### Automated Workflow
```bash
# Use the smart commit script
./scripts/smart-commit.sh [category] "message" [files...]

# Or use the full automated workflow
./scripts/commit-workflow.sh
```

## File Categories

### 1. Configuration Files (`config`)
**Files:** `package.json`, `tsconfig.json`, `babel.config.js`, `metro.config.js`, `tailwind.config.js`, `app.json`, `*.toml`
```bash
./scripts/smart-commit.sh config "Update build configuration" package.json tsconfig.json
```

### 2. UI Components (`ui`)
**Files:** `app/**/*.tsx`, `components/**/*.tsx`, `design-system/**/*`
```bash
./scripts/smart-commit.sh ui "Improve button styling" components/Button.tsx
```

### 3. New Features (`feat`)
**Files:** New components, new functionality, major additions
```bash
./scripts/smart-commit.sh feat "Add new dashboard component" components/dashboard/
```

### 4. Code Refactoring (`refactor`)
**Files:** `lib/services/**/*.ts`, `lib/**/*.ts`, `hooks/*.ts`
```bash
./scripts/smart-commit.sh refactor "Improve error handling" lib/services/ErrorHandler.ts
```

### 5. iOS Files (`ios`)
**Files:** `ios/**/*`, `*.xcodeproj/**/*`, `*.plist`, `*.entitlements`, `Podfile*`, `*.swift`, `*.m`
```bash
./scripts/smart-commit.sh ios "Update app icon and entitlements" ios/formfactoreas/Info.plist
```

### 6. Android Files (`android`)
**Files:** `android/**/*`, `*.gradle`, `*.xml`, `*.properties`
```bash
./scripts/smart-commit.sh android "Update build configuration" android/build.gradle
```

### 7. Context Providers (`contexts`)
**Files:** `contexts/*.tsx`
```bash
./scripts/smart-commit.sh contexts "Add new toast context" contexts/ToastContext.tsx
```

### 8. Cleanup (`chore`)
**Files:** Removing files, updating documentation, maintenance tasks
```bash
./scripts/smart-commit.sh chore "Remove obsolete files" migration_analysis.txt
```

## Commit Message Format

Follow conventional commits format:
```
<type>: <description>

[optional body]

[optional footer]
```

### Types:
- `feat`: New features
- `fix`: Bug fixes
- `style`: UI/styling changes
- `refactor`: Code refactoring
- `config`: Configuration changes
- `build`: Build system changes
- `chore`: Maintenance tasks

## Examples

### Example 1: UI Updates
```bash
./scripts/smart-commit.sh ui "Update auth screens styling" \
  app/\(auth\)/sign-in.tsx \
  app/\(auth\)/sign-up.tsx \
  app/\(auth\)/forgot-password.tsx
```

### Example 2: New Feature
```bash
./scripts/smart-commit.sh feat "Add HealthKit integration" \
  lib/services/healthkit/ \
  contexts/HealthKitContext.tsx \
  supabase/migrations/002_create_health_metrics_table.sql
```

### Example 3: Configuration Update
```bash
./scripts/smart-commit.sh config "Update dependencies and build tools" \
  package.json \
  babel.config.js \
  metro.config.js
```

### Example 4: iOS Build Update
```bash
./scripts/smart-commit.sh ios "Update iOS configuration for new features" \
  ios/Podfile \
  ios/formfactoreas/Info.plist \
  ios/formfactoreas/formfactoreas.entitlements
```

## Best Practices

1. **Group Related Files**: Commit files that are logically related together
2. **One Logical Change Per Commit**: Each commit should represent one logical change
3. **Descriptive Messages**: Write clear, concise commit messages
4. **Atomic Commits**: Each commit should be able to stand alone
5. **Test Before Commit**: Ensure changes work before committing
6. **Review Changes**: Use `git diff --staged` to review before committing

## Workflow Steps

1. **Check Status**: `git status`
2. **Review Changes**: `git diff` or `git diff --staged`
3. **Stage Files**: Use category-based staging
4. **Commit**: Use descriptive conventional commit messages
5. **Push**: `git push origin main`

## Troubleshooting

### If you commit too many files at once:
```bash
# Reset the last commit but keep changes staged
git reset --soft HEAD~1

# Then use the smart commit script to create focused commits
./scripts/smart-commit.sh [category] "message" [files...]
```

### If you need to amend a commit:
```bash
# Make additional changes
git add [files...]
git commit --amend -m "Updated message"
```

### If you need to split a large commit:
```bash
# Interactive rebase
git rebase -i HEAD~n  # where n is number of commits to edit
```
