# Backstage Setup Instructions

## Prerequisites

1. Install Node 18 (Backstage requires Node 18):
   ```bash
   brew install node@18
   # Or use nvm: nvm install 18 && nvm use 18
   ```

2. Enable Yarn:
   ```bash
   corepack enable
   ```

3. Create GitHub Personal Access Token:
   - Go to https://github.com/settings/tokens
   - Generate new token (classic) with `repo` and `workflow` scopes
   - Save it as `GITHUB_TOKEN`

## Create Backstage App

```bash
cd ~/Projects
npx @backstage/create-app@latest --path backstage-form-factor
```

When prompted:
- App name: `backstage-form-factor`
- Database: SQLite (default)

## Configure Backstage

After creation, follow the steps in `CONFIG.md` to configure GitHub integration, TechDocs, and plugins.
