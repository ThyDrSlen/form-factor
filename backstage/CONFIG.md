# Backstage Configuration Steps

## 1. Configure GitHub Integration

Edit `~/Projects/backstage-form-factor/app-config.yaml`:

Add to `integrations` section:
```yaml
integrations:
  github:
    - host: github.com
      token: ${GITHUB_TOKEN}
```

Create `~/Projects/backstage-form-factor/.env`:
```bash
GITHUB_TOKEN=ghp_xxxxx  # Your GitHub PAT
```

## 2. Register Catalog Location

In `app-config.yaml`, add to `catalog.locations`:
```yaml
catalog:
  locations:
    - type: url
      target: https://github.com/ThyDrSlen/form-factor/blob/main/catalog-info.yaml
    - type: url
      target: https://github.com/ThyDrSlen/form-factor/blob/main/backstage/templates/supabase-edge-function/template.yaml
      rules:
        - allow: [Template]
```

## 3. Enable TechDocs

Add to `app-config.yaml`:
```yaml
techdocs:
  builder: local
  generator:
    runIn: local
  publisher:
    type: local
```

Install TechDocs dependencies:
```bash
cd ~/Projects/backstage-form-factor
yarn add --cwd packages/backend @backstage/plugin-techdocs-backend
pip3 install mkdocs mkdocs-techdocs-core
```

## 4. Install GitHub Actions Plugin

```bash
cd ~/Projects/backstage-form-factor
yarn add --cwd packages/app @backstage/plugin-github-actions
yarn add --cwd packages/backend @backstage/plugin-github-actions-backend
```

## 5. Wire GitHub Actions to Entity Pages

Edit `packages/app/src/components/catalog/EntityPage.tsx`:

Add import:
```typescript
import { EntityGithubActionsContent, isGithubActionsAvailable } from '@backstage/plugin-github-actions';
```

Find the `cicdContent` section and add:
```typescript
const cicdContent = (
  <EntitySwitch>
    <EntitySwitch.Case if={isGithubActionsAvailable}>
      <EntityGithubActionsContent />
    </EntitySwitch.Case>
  </EntitySwitch>
);
```

Make sure `cicdContent` is included in the entity page layout.

## 6. Start Backstage

```bash
cd ~/Projects/backstage-form-factor
export GITHUB_TOKEN=ghp_xxxxx
yarn dev
```

Open http://localhost:3000
