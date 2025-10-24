# Background Agent Setup Guide

Complete guide for setting up and using the Cursor background agent environment for CI/CD and smart commits.

## 🎯 Quick Start

### Option 1: Cursor Will Build Automatically
When you open this workspace in Cursor, it will automatically detect the `environment.json` and build the Docker environment.

### Option 2: Manual Docker Build
```bash
cd /workspace
docker build -t formfactor-agent -f .cursor/Dockerfile .
```

### Option 3: Verify Setup
```bash
# Run validation script
.cursor/scripts/validate-env.sh
```

## ✅ What's Included

### 🐳 Docker Environment
- **Base**: Node.js 18 slim
- **Package Manager**: Bun 1.2.22
- **Git**: Configured with agent identity
- **Tools**: TypeScript, ESLint, Expo CLI, EAS CLI, Supabase CLI

### 🛠️ Helper Scripts
All scripts are in `.cursor/scripts/`:

| Script | Purpose | When to Use |
|--------|---------|-------------|
| `validate-env.sh` | Verify environment setup | After building, troubleshooting |
| `quality-check.sh` | Run TypeScript + ESLint | Before commits, pre-push |
| `smart-commit.sh` | Analyze changes, suggest commits | When ready to commit |
| `ci-local.sh` | Full CI pipeline locally | Before pushing to GitHub |
| `build-check.sh` | Verify build config | After config changes |

## 🚀 Usage Examples

### 1. Run Quality Checks
```bash
# Quick check before committing
.cursor/scripts/quality-check.sh

# Or use the terminal command (in Cursor)
# Terminal: quality-checks
```

### 2. Smart Commit Workflow
```bash
# Make your changes
# ...

# Run quality checks
.cursor/scripts/quality-check.sh

# Analyze changes and get suggestions
.cursor/scripts/smart-commit.sh

# Stage and commit
git add .
git commit -m "feat(auth): add biometric authentication"
```

### 3. Full CI/CD Test
```bash
# Before pushing to GitHub, run full pipeline
.cursor/scripts/ci-local.sh

# If all passes, push with confidence
git push origin feature-branch
```

### 4. Verify Build Configuration
```bash
# After modifying eas.json or app.json
.cursor/scripts/build-check.sh

# For full EAS verification (requires EXPO_TOKEN)
npx eas build --platform all --profile preview --dry-run
```

## 🤖 Background Agent Capabilities

### ✅ What the Agent Can Do

#### Code Analysis
- Read and understand TypeScript/JavaScript code
- Analyze code patterns and architecture
- Identify potential issues

#### Quality Checks
- Run TypeScript type checking
- Execute ESLint linting
- Check for unused dependencies
- Security auditing

#### Git Operations
- Analyze git changes
- Suggest commit messages
- Review diff summaries
- Check commit history

#### Configuration
- Verify build configurations
- Check EAS/Expo settings
- Validate package dependencies

#### Documentation
- Read and reference docs
- Update documentation
- Generate commit messages

### ❌ What the Agent Cannot Do

#### Native Builds
- Build iOS apps (needs Xcode/macOS)
- Build Android apps (needs Android SDK)
- Compile native modules (ARKit, HealthKit)

#### Runtime Testing
- Run iOS simulator
- Run Android emulator
- Execute native code

#### Deployment
- Submit to App Store
- Submit to Google Play
- Deploy directly to production

**Note**: For native operations, use:
- Your local macOS environment
- EAS Build service (cloud)
- GitHub Actions (automated)

## 📋 Pre-Commit Checklist

Use this checklist (or the scripts) before every commit:

```bash
# 1. Type check
bun run tsc --noEmit
✅ TypeScript: No errors

# 2. Lint
bun run lint
✅ ESLint: No warnings

# 3. Review changes
git status
git diff --stat
✅ Changes reviewed

# 4. Smart commit suggestion
.cursor/scripts/smart-commit.sh
✅ Commit message ready

# 5. Commit
git add <files>
git commit -m "type(scope): message"
✅ Committed
```

## 🔄 CI/CD Pipeline Alignment

The background agent environment mirrors your GitHub Actions workflow:

| GitHub Actions Job | Local Equivalent | Script |
|-------------------|------------------|--------|
| `quality` | Type check + lint | `quality-check.sh` |
| `build-check` | EAS config verify | `build-check.sh` |
| `security` | Security audit | `ci-local.sh` |
| All jobs | Full pipeline | `ci-local.sh` |

### GitHub Actions Configuration
Your CI/CD pipeline (`.github/workflows/ci-cd.yml`) runs:

1. **On Push to main/develop**: Full pipeline + deployment
2. **On Pull Request**: Quality checks + preview build
3. **On Any Push**: Quality checks + build verification

The background agent can run all quality checks locally before pushing!

## 🎨 Smart Commit Message Format

The agent follows conventional commit format:

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types
- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code improvement
- `style`: Styling/UI changes
- `docs`: Documentation
- `test`: Testing
- `chore`: Maintenance/config
- `perf`: Performance improvement

### Scopes (examples)
- `auth`: Authentication
- `native`: Native modules (iOS/Android)
- `ui`: User interface
- `api`: API/backend
- `deps`: Dependencies
- `config`: Configuration

### Examples
```bash
feat(auth): add Apple Sign-In support
fix(native): resolve ARKit pose detection crash
refactor(ui): improve dashboard performance
chore(deps): update expo to 54.0.0
docs(setup): add Docker environment guide
```

## 🔧 Customization

### Modify Tools
Edit `.cursor/Dockerfile` to add more tools:
```dockerfile
# Add your tool
RUN bun add -g your-tool
```

### Add Scripts
Create new scripts in `.cursor/scripts/`:
```bash
#!/bin/bash
# Your custom script
echo "Running custom checks..."
```

### Configure Terminals
Edit `.cursor/environment.json` to add terminals:
```json
{
  "terminals": [
    {
      "name": "my-command",
      "command": "your command here",
      "autostart": false
    }
  ]
}
```

## 🐛 Troubleshooting

### Issue: Docker build fails
```bash
# Clear Docker cache
docker builder prune -a

# Rebuild
docker build --no-cache -t formfactor-agent -f .cursor/Dockerfile .
```

### Issue: Scripts not executable
```bash
chmod +x .cursor/scripts/*.sh
```

### Issue: Bun not found in container
```bash
# Verify PATH in Dockerfile
ENV PATH="/root/.bun/bin:${PATH}"

# Rebuild container
```

### Issue: TypeScript errors
```bash
# Ensure dependencies are installed
bun install --frozen-lockfile

# Clear TypeScript cache
rm -rf node_modules/.cache
bun run tsc --noEmit
```

### Issue: EAS CLI not working
```bash
# Install globally
bun add -g eas-cli

# Or use npx
npx eas --version
```

## 📊 Performance Tips

### Speed Up Builds
1. Use `.dockerignore` to exclude files
2. Cache dependencies layer
3. Don't install dev dependencies in production

### Speed Up Checks
1. Run TypeScript in watch mode
2. Use ESLint cache
3. Run checks in parallel

### Optimize Agent
1. Keep dependencies updated
2. Use specific file patterns for checks
3. Cache results when possible

## 🔒 Security Best Practices

### Environment Variables
- Never commit secrets to `.env`
- Use GitHub Secrets for CI/CD
- Use Expo environment variables for builds

### Git Configuration
- Review changes before committing
- Use signed commits (optional)
- Keep commit messages professional

### Dependencies
- Run security audits regularly
- Update dependencies frequently
- Review dependency changes

## 📚 Additional Resources

- [CI/CD Documentation](../docs/CI-CD.md)
- [GitHub Workflow](./.github/workflows/ci-cd.yml)
- [EAS Configuration](../eas.json)
- [Project Guidelines](../AGENTS.md)

## 🆘 Getting Help

### Check Logs
```bash
# Docker build logs
docker build --progress=plain -t formfactor-agent -f .cursor/Dockerfile .

# Script output
bash -x .cursor/scripts/quality-check.sh
```

### Verify Environment
```bash
.cursor/scripts/validate-env.sh
```

### Common Commands
```bash
# Check Node version
node --version

# Check Bun version  
bun --version

# Check TypeScript
tsc --version

# Check EAS CLI
eas --version

# Check git config
git config --list
```

---

**Environment Ready!** 🎉

Your background agent is configured for:
- ✅ CI/CD workflows
- ✅ Smart commits
- ✅ Code quality checks
- ✅ Security auditing
- ✅ Build verification

Start using it with: `.cursor/scripts/smart-commit.sh`
