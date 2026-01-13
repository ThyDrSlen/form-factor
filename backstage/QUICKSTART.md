# Backstage POC Quick Start Guide

This guide will get your Backstage developer portal running in ~30 minutes.

## Prerequisites Checklist

- [ ] Node 18 installed (`brew install node@18` or `nvm install 18`)
- [ ] Yarn enabled (`corepack enable`)
- [ ] GitHub Personal Access Token with `repo` and `workflow` scopes
- [ ] Python 3 with pip (`pip3 install mkdocs mkdocs-techdocs-core`)

## Step 1: Create Backstage App (5 min)

```bash
cd ~/Projects
npx @backstage/create-app@latest --path backstage-form-factor
```

When prompted:
- App name: `backstage-form-factor`
- Database: SQLite (default, press Enter)

## Step 2: Configure GitHub Integration (5 min)

1. Create `.env` file in `~/Projects/backstage-form-factor/`:
   ```bash
   cd ~/Projects/backstage-form-factor
   echo "GITHUB_TOKEN=ghp_xxxxx" > .env
   ```
   Replace `ghp_xxxxx` with your GitHub PAT.

2. Edit `app-config.yaml` and add these sections (see `app-config-example.yaml` for reference):

   ```yaml
   integrations:
     github:
       - host: github.com
         token: ${GITHUB_TOKEN}
   
   catalog:
     locations:
       - type: url
         target: https://github.com/ThyDrSlen/form-factor/blob/main/catalog-info.yaml
       - type: url
         target: https://github.com/ThyDrSlen/form-factor/blob/main/backstage/templates/supabase-edge-function/template.yaml
         rules:
           - allow: [Template]
   
   techdocs:
     builder: local
     generator:
       runIn: local
     publisher:
       type: local
   ```

## Step 3: Install Plugins (5 min)

```bash
cd ~/Projects/backstage-form-factor

# TechDocs backend
yarn add --cwd packages/backend @backstage/plugin-techdocs-backend

# GitHub Actions
yarn add --cwd packages/app @backstage/plugin-github-actions
yarn add --cwd packages/backend @backstage/plugin-github-actions-backend

# Python dependencies for TechDocs
pip3 install mkdocs mkdocs-techdocs-core
```

## Step 4: Wire GitHub Actions Plugin (5 min)

Edit `packages/app/src/components/catalog/EntityPage.tsx`:

1. Add import at the top:
   ```typescript
   import { EntityGithubActionsContent, isGithubActionsAvailable } from '@backstage/plugin-github-actions';
   ```

2. Find the `cicdContent` variable and replace with:
   ```typescript
   const cicdContent = (
     <EntitySwitch>
       <EntitySwitch.Case if={isGithubActionsAvailable}>
         <EntityGithubActionsContent />
       </EntitySwitch.Case>
     </EntitySwitch>
   );
   ```

3. Verify `cicdContent` is included in the entity page layout (should already be there).

See `entity-page-patch.tsx` for reference.

## Step 5: Start Backstage (10 min)

```bash
cd ~/Projects/backstage-form-factor
export GITHUB_TOKEN=ghp_xxxxx  # If not in .env
yarn dev
```

Wait for both frontend and backend to start, then open http://localhost:3000

## Step 6: Verify Setup

### Catalog
1. Navigate to http://localhost:3000/catalog
2. You should see 5 entities:
   - form-factor-app
   - form-factor-backend
   - coach-edge-function
   - notify-edge-function
   - arkit-body-tracker

### TechDocs
1. Click on "form-factor-app" entity
2. Click "Docs" tab
3. You should see rendered documentation from `docs/index.md`

### Scaffolder
1. Navigate to http://localhost:3000/create
2. You should see "Create Supabase Edge Function" template
3. Click it to see the form

### CI/CD
1. Go to any entity page (e.g., form-factor-app)
2. Click "CI/CD" tab
3. You should see GitHub Actions workflow runs

## Troubleshooting

### "Failed to fetch" errors
- Check `GITHUB_TOKEN` is set correctly
- Verify token has `repo` and `workflow` scopes
- Restart Backstage backend

### TechDocs not showing
- Run `npx @techdocs/cli generate --source-dir . --output-dir ./site` in Form Factor repo to test mkdocs.yml
- Check `mkdocs.yml` syntax is correct
- Verify `docs/index.md` exists

### Catalog entities not appearing
- Check `app-config.yaml` catalog locations are correct
- Click "Refresh" on entity page
- Check backend logs for ingestion errors

### Template not appearing
- Verify template.yaml is in correct location
- Check catalog location includes `rules: - allow: [Template]`
- Restart Backstage backend

## Screenshots to Capture

1. **Catalog Overview** (`/catalog`)
   - All 5 entities visible with types and tags

2. **TechDocs Page** (`/docs/default/component/form-factor-app`)
   - Rendered markdown with navigation sidebar

3. **Scaffolder Template** (`/create/templates/default/supabase-edge-function`)
   - Form with name, description, requiresAuth toggle

## Next Steps

- Customize entity metadata in `catalog-info.yaml`
- Add more TechDocs pages
- Create additional scaffolder templates
- Configure authentication (optional, for production)
