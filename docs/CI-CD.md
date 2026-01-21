# CI/CD Pipeline Documentation

This document describes the CI/CD pipeline setup for the Form Factor EAS React Native/Expo application.

## Overview

The CI/CD pipeline provides automated testing, building, and deployment for your React Native/Expo application using GitHub Actions, EAS Build, and Supabase.

## Pipeline Jobs

### 1. Code Quality & Testing (`quality`)
- **Triggers**: All pushes and PRs
- **Purpose**: Ensures code quality and catches issues early
- **Tasks**:
  - TypeScript type checking
  - ESLint code linting
  - Dependency audit
  - Unused dependency check

### 2. Build Verification (`build-check`)
- **Triggers**: After quality checks pass
- **Purpose**: Verifies that the project can build successfully
- **Tasks**:
  - EAS build configuration validation
  - Dry-run build test

### 3. Staging Deployment (`deploy-staging`)
- **Triggers**: Pushes to `develop` branch
- **Purpose**: Deploys to staging environment
- **Tasks**:
  - Deploys database changes to staging
  - Builds and submits staging app
  - Deploys OTA update
  - Sends Slack notification

### 4. Production Deployment (`deploy-production`)
- **Triggers**: Pushes to `main` branch
- **Purpose**: Deploys to production environment
- **Tasks**:
  - Deploys database changes to production
  - Builds and submits production app
  - Deploys OTA update
  - Creates GitHub release
  - Sends Slack notification

### 5. Security Scan (`security`)
- **Triggers**: After quality checks
- **Purpose**: Scans for security vulnerabilities
- **Tasks**:
  - Dependency security audit
  - Secret scanning

## Required Setup

### GitHub Secrets
Add these secrets in your GitHub repository settings:

| Secret | Description | How to Get |
|--------|-------------|------------|
| `EXPO_TOKEN` | Expo access token | [Expo Dashboard](https://expo.dev/accounts/[username]/settings/access-tokens) |
| `SUPABASE_ACCESS_TOKEN` | Supabase access token | [Supabase Dashboard](https://supabase.com/dashboard/account/tokens) |
| `SUPABASE_STAGING_PROJECT_REF` | Staging project reference | Supabase project settings |
| `SUPABASE_PRODUCTION_PROJECT_REF` | Production project reference | Supabase project settings |
| `SLACK_WEBHOOK` | Slack webhook (optional) | [Slack API](https://api.slack.com/messaging/webhooks) |

### GitHub Environments
Create these environments in your repository settings:

1. **staging** - For staging deployments
2. **production** - For production deployments

### EAS Configuration
Ensure your `eas.json` is properly configured with:
- Development profile
- Preview profile
- Staging profile with environment variables
- Production profile with environment variables

## Tools Used

- **Bun**: Package manager and runtime
- **EAS Build**: Expo's build service
- **EAS Update**: Over-the-air updates
- **Supabase CLI**: Database migrations
- **GitHub Actions**: CI/CD orchestration
- **TypeScript**: Type checking
- **ESLint**: Code linting

## Workflow Triggers

| Event | Branch | Action |
|-------|--------|--------|
| Push | `main` | Full pipeline + production deployment |
| Push | `develop` | Full pipeline + staging deployment |
| Push | Other | Quality checks + build verification |
| Pull Request | Any | Quality checks + build verification (no EAS build) |

## TODO Issue Sync

A daily GitHub Action scans tracked files for `TODO`, `FIXME`, and `HACK` comments and syncs them to GitHub issues. Issues are labeled `todo` and `auto-generated`, assigned to `ThyDrSlen`, and closed automatically when the TODO is removed. The workflow can also be run manually via `workflow_dispatch`.

## Monitoring

### GitHub Actions
- View workflow runs: `https://github.com/[owner]/[repo]/actions`
- Check job logs and status
- Monitor build artifacts

### EAS Build
- View builds: `https://expo.dev/accounts/[username]/projects/[project]/builds`
- Monitor build status and logs
- Download build artifacts

### Supabase
- Monitor database deployments
- Check migration status
- View project logs

## Troubleshooting

### Common Issues

1. **Build Failures**
   - Check EAS build logs
   - Verify environment variables
   - Ensure dependencies are up to date

2. **Database Migration Failures**
   - Check Supabase project references
   - Verify access tokens
   - Review migration files

3. **Secret Issues**
   - Verify all required secrets are set
   - Check secret names match exactly
   - Ensure tokens have proper permissions

### Debug Commands

```bash
# Check EAS configuration
npx eas build --platform all --profile preview --dry-run

# Verify Supabase connection
npx supabase status

# Test local build
bun run android
bun run ios
```

## Performance Optimization

- **Caching**: Dependencies are cached between runs
- **Parallel Jobs**: Jobs run in parallel where possible
- **Conditional Execution**: Jobs only run when needed
- **Resource Optimization**: Uses appropriate runner sizes

## Security Features

- **Secret Scanning**: TruffleHog scans for exposed secrets
- **Dependency Auditing**: Regular security audits
- **Environment Protection**: Production requires approval
- **Token Rotation**: Regular token updates recommended

## Best Practices

1. **Branch Strategy**
   - Use `main` for production
   - Use `develop` for staging
   - Create feature branches for development

2. **Commit Messages**
   - Use conventional commits
   - Be descriptive and clear
   - Reference issues when applicable

3. **Testing**
   - Write tests for new features
   - Test locally before pushing
   - Use preview builds for testing

4. **Monitoring**
   - Check workflow status regularly
   - Monitor build success rates
   - Review security scan results

## Support

For issues with the CI/CD pipeline:

1. Check the GitHub Actions logs
2. Review the EAS build logs
3. Verify all secrets and environments are set
4. Check the Supabase project status
5. Review this documentation

---

*This CI/CD pipeline is designed to provide reliable, automated deployments while maintaining code quality and security.*
