# Background Agent Quick Reference

## 🚀 One-Line Commands

### Before Every Commit
```bash
.cursor/scripts/quality-check.sh && .cursor/scripts/smart-commit.sh
```

### Full CI Pipeline
```bash
.cursor/scripts/ci-local.sh
```

### Validate Environment
```bash
.cursor/scripts/validate-env.sh
```

### Build Config Check
```bash
.cursor/scripts/build-check.sh
```

## 📋 Common Workflows

### Workflow 1: Quick Commit
```bash
# 1. Check code quality
.cursor/scripts/quality-check.sh

# 2. Stage changes
git add .

# 3. Commit with conventional format
git commit -m "feat(auth): add biometric authentication"
```

### Workflow 2: Smart Commit
```bash
# 1. Analyze changes and get suggestions
.cursor/scripts/smart-commit.sh

# 2. Run quality checks
.cursor/scripts/quality-check.sh

# 3. Commit
git add <files>
git commit -m "<suggested-message>"
```

### Workflow 3: Pre-Push Validation
```bash
# Run full CI pipeline locally
.cursor/scripts/ci-local.sh

# If passes, push
git push origin <branch>
```

### Workflow 4: After Config Changes
```bash
# Verify build configuration
.cursor/scripts/build-check.sh

# Optional: Full EAS dry-run
npx eas build --platform all --profile preview --dry-run
```

## 🎯 Individual Commands

### TypeScript
```bash
# Type check
bun run tsc --noEmit

# Watch mode
bun run tsc --noEmit --watch
```

### ESLint
```bash
# Lint all files
bun run lint

# Fix auto-fixable issues
bunx eslint --fix .
```

### Security
```bash
# Audit dependencies
bun audit --audit-level moderate

# With audit-ci
npx audit-ci --config audit-ci.json
```

### Dependencies
```bash
# Check unused
npx depcheck --ignores="@types/*,eslint*,@babel/*,babel-*,metro-*,expo-*,playwright"

# Update all
bun update

# Install specific
bun add <package>
```

### Git
```bash
# Status
git status

# Diff summary
git diff --stat

# Recent commits
git log --oneline -10

# Show changes
git diff
```

## 🤖 What Agent Can Do

### ✅ Automatic
- Type checking
- Linting
- Security audits
- Dependency checks
- Git analysis
- Commit suggestions
- Config verification

### 🔧 Manual (EAS/Native)
- iOS builds → Use EAS or local Xcode
- Android builds → Use EAS or local Android Studio
- App submissions → Use EAS submit
- Native testing → Use physical device/simulator

## 📊 Commit Message Templates

### Features
```bash
feat(scope): add new feature
feat(auth): implement biometric authentication
feat(ui): add dark mode support
```

### Fixes
```bash
fix(scope): resolve bug
fix(native): resolve ARKit crash on iPhone 12
fix(api): handle network timeout correctly
```

### Refactoring
```bash
refactor(scope): improve implementation
refactor(dashboard): optimize weight chart rendering
refactor(auth): simplify login flow
```

### Styling
```bash
style(scope): update UI/styling
style(profile): redesign settings screen
style(components): update button animations
```

### Configuration
```bash
chore(config): update configuration
chore(deps): update expo to 54.0.0
chore(ci): optimize build pipeline
```

### Documentation
```bash
docs(scope): update documentation
docs(setup): add Docker environment guide
docs(api): document authentication flow
```

## 🎨 Conventional Commit Cheat Sheet

```
<type>(<scope>): <subject>
│      │         │
│      │         └─> Summary in present tense, not capitalized, no period
│      │
│      └─> Scope: auth, native, ui, api, deps, config, etc.
│
└─> Type: feat, fix, refactor, style, docs, test, chore, perf
```

### Types Quick Reference
- `feat` → New feature for user
- `fix` → Bug fix for user
- `refactor` → Code change that neither fixes bug nor adds feature
- `style` → UI/styling changes
- `docs` → Documentation only
- `test` → Adding missing tests
- `chore` → Maintenance/tooling
- `perf` → Performance improvements

## 🔄 CI/CD Status Check

### Local
```bash
# Run all checks
.cursor/scripts/ci-local.sh

# Exit code 0 = Pass
echo $?
```

### GitHub
- View: `https://github.com/<org>/<repo>/actions`
- Status badge in README
- PR checks before merge

### EAS
- Builds: `https://expo.dev/accounts/<user>/projects/<project>/builds`
- CLI: `eas build:list`

## 🐛 Quick Fixes

### TypeScript errors
```bash
rm -rf node_modules && bun install
bun run tsc --noEmit
```

### ESLint errors
```bash
bunx eslint --fix .
```

### Git conflicts
```bash
git status
git diff
# Resolve conflicts
git add .
git commit
```

### Build fails
```bash
.cursor/scripts/build-check.sh
eas build --platform all --profile preview --dry-run
```

## 📈 Performance

### Fast Checks (< 10s)
- `git status`
- `git diff --stat`
- `.cursor/scripts/build-check.sh`

### Medium Checks (10-30s)
- `bun run tsc --noEmit`
- `bun run lint`
- `.cursor/scripts/quality-check.sh`

### Slow Checks (30s+)
- `.cursor/scripts/ci-local.sh`
- `bun audit`
- `npx depcheck`

## 🎯 Best Practices

1. ✅ **Always** run quality checks before committing
2. ✅ **Always** use conventional commit format
3. ✅ **Always** test locally before pushing
4. ✅ **Review** changes with `git diff` before committing
5. ✅ **Update** dependencies regularly
6. ✅ **Run** security audits weekly
7. ✅ **Verify** build config after changes
8. ✅ **Document** significant changes

## 📞 Quick Help

### File an Issue
1. Run `.cursor/scripts/validate-env.sh`
2. Include output in issue
3. Include error messages
4. Include steps to reproduce

### Debug Mode
```bash
# Verbose script output
bash -x .cursor/scripts/<script>.sh

# Docker build verbose
docker build --progress=plain -t formfactor-agent -f .cursor/Dockerfile .
```

---

**Keep this reference handy!** 📌

Print or bookmark for quick access during development.
