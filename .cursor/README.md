# Background Agent Environment

This directory contains the Docker-based environment configuration for Cursor's background agent, optimized for CI/CD workflows and smart commit operations.

## 🚀 Features

### CI/CD Capabilities
- ✅ TypeScript type checking (`tsc --noEmit`)
- ✅ ESLint linting
- ✅ Dependency auditing
- ✅ Security scanning
- ✅ EAS build verification (dry-run)
- ✅ Supabase database migrations
- ✅ Git operations

### Smart Commit Support
- ✅ Automated change analysis
- ✅ Commit message suggestions
- ✅ Conventional commit formatting
- ✅ Pre-commit quality checks

## 📁 Structure

```
.cursor/
├── Dockerfile              # Main environment definition
├── environment.json        # Cursor agent configuration
├── .dockerignore          # Optimization for builds
├── scripts/               # Helper scripts
│   ├── quality-check.sh   # Run all quality checks
│   ├── smart-commit.sh    # Smart commit assistant
│   ├── ci-local.sh        # Local CI/CD simulation
│   └── build-check.sh     # Build verification
└── README.md              # This file
```

## 🛠️ Environment Setup

### Base Image
- **Node.js**: 18 (slim)
- **Package Manager**: Bun 1.2.22
- **OS**: Debian-based Linux

### Installed Tools
- TypeScript compiler
- ESLint
- Depcheck (unused dependency checker)
- Audit CI (security auditing)
- Expo CLI
- EAS CLI
- Supabase CLI
- Git (configured)

## 📋 Available Terminal Commands

The environment includes pre-configured terminal commands accessible through the agent:

### Quality Checks
```bash
# Run all quality checks (TypeScript + ESLint)
quality-checks

# Watch mode for TypeScript
type-check

# Security audit
security-audit
```

## 🔧 Helper Scripts

### Run Quality Checks
```bash
.cursor/scripts/quality-check.sh
```
Runs TypeScript type checking, ESLint, and dependency checks.

### Smart Commit Assistant
```bash
.cursor/scripts/smart-commit.sh
```
Analyzes your changes and suggests:
- Appropriate commit type (feat/fix/chore/etc.)
- Commit message structure
- Recent commit style for consistency

### Local CI/CD Simulation
```bash
.cursor/scripts/ci-local.sh
```
Runs the same checks as GitHub Actions locally:
- Code quality checks
- Security scanning
- Dependency auditing

### Build Verification
```bash
.cursor/scripts/build-check.sh
```
Verifies build configuration without running full build:
- EAS configuration check
- App configuration validation
- Native directory verification

## 🔄 CI/CD Integration

This environment mirrors the GitHub Actions workflow defined in `.github/workflows/ci-cd.yml`:

### Quality Job
- ✅ TypeScript type checking
- ✅ ESLint linting
- ✅ Unused dependency check

### Build Job
- ✅ EAS configuration verification
- ✅ Dry-run build test

### Security Job
- ✅ Dependency audit
- ✅ Security scanning

## 🤖 Smart Commit Workflow

The background agent can assist with commits:

1. **Analyze Changes**
   - Detects modified files
   - Categorizes changes (native/config/docs/tests/etc.)
   - Suggests appropriate commit type

2. **Quality Checks**
   - Runs TypeScript and ESLint
   - Ensures code quality before commit

3. **Commit Message**
   - Follows conventional commit format
   - References recent commit style
   - Provides clear, descriptive messages

### Example Usage

```bash
# Agent analyzes changes
.cursor/scripts/smart-commit.sh

# Suggests: "feat(auth): add biometric authentication support"
# or: "fix(native): resolve ARKit pose detection crash"
# or: "chore(deps): update expo to 54.0.0"
```

## 🐳 Docker Commands

### Build the Environment
```bash
docker build -t formfactor-agent -f .cursor/Dockerfile .
```

### Run Interactive Shell
```bash
docker run -it --rm -v $(pwd):/workspace formfactor-agent bash
```

### Run Quality Checks
```bash
docker run --rm -v $(pwd):/workspace formfactor-agent \
  .cursor/scripts/quality-check.sh
```

## 🔍 Environment Variables

The environment includes:
- `NODE_ENV=development`
- `CI=true` (enables CI mode for tools)

Additional secrets (for deployment) should be configured in:
- GitHub Secrets (for Actions)
- Local `.env` (for development)

## 📊 What the Agent Can Do

### ✅ Supported Operations
- Read and analyze code
- Run linters and type checkers
- Execute quality checks
- Verify build configuration
- Analyze git changes
- Suggest commit messages
- Run security audits
- Check dependencies

### ❌ Limitations
- Cannot build iOS apps (requires Xcode/macOS)
- Cannot build Android apps (requires Android SDK)
- Cannot run simulators/emulators
- Cannot test native modules (ARKit, HealthKit)
- Cannot deploy to app stores

For full native builds, use:
- Local macOS environment (iOS)
- EAS Build service (cloud builds)
- GitHub Actions (automated builds)

## 🔧 Troubleshooting

### Build Issues
If the Docker build fails:
1. Check Docker is running
2. Ensure you have internet connectivity
3. Try clearing Docker cache: `docker builder prune`

### Script Execution Issues
If scripts fail:
1. Ensure they're executable: `chmod +x .cursor/scripts/*.sh`
2. Check you're in the workspace root
3. Verify dependencies are installed

### Agent Performance
To optimize agent performance:
1. Keep dependencies up to date
2. Use `.dockerignore` to exclude unnecessary files
3. Clear caches periodically

## 📚 References

- [CI/CD Documentation](../docs/CI-CD.md)
- [GitHub Actions Workflow](../.github/workflows/ci-cd.yml)
- [EAS Build Configuration](../eas.json)
- [Package Configuration](../package.json)

## 🎯 Best Practices

1. **Run quality checks before commits**
   ```bash
   .cursor/scripts/quality-check.sh && git commit
   ```

2. **Use smart commit suggestions**
   ```bash
   .cursor/scripts/smart-commit.sh
   ```

3. **Test locally before pushing**
   ```bash
   .cursor/scripts/ci-local.sh
   ```

4. **Keep the environment updated**
   - Rebuild when dependencies change
   - Update Bun version in Dockerfile
   - Sync with CI/CD workflow requirements

---

**Last Updated**: 2025-10-24  
**Bun Version**: 1.2.22  
**Node Version**: 18  
**Expo SDK**: 54.0.0
