# Backstage POC for Form Factor

This directory contains all files needed to set up a Backstage developer portal for the Form Factor project.

## What's Included

### Form Factor Repo Files

- **`catalog-info.yaml`** (root): Defines 5 Backstage entities (app, backend, 2 edge functions, native module)
- **`mkdocs.yml`** (root): TechDocs configuration for rendering docs
- **`docs/index.md`**: TechDocs landing page
- **`backstage/templates/supabase-edge-function/`**: Scaffolder template for creating new edge functions

### Setup Guides

- **`QUICKSTART.md`**: Step-by-step setup guide (start here!)
- **`SETUP.md`**: Prerequisites and initial setup
- **`CONFIG.md`**: Detailed configuration steps
- **`app-config-example.yaml`**: Example configuration snippets
- **`entity-page-patch.tsx`**: Code snippet for wiring GitHub Actions plugin

## Architecture

```
Backstage App (port 3000/7007)
├── Catalog Plugin → Reads catalog-info.yaml
├── TechDocs Plugin → Builds mkdocs.yml → Serves docs/
├── Scaffolder Plugin → Executes supabase-edge-function template
└── GitHub Actions Plugin → Shows CI status from .github/workflows/
```

## Quick Start

1. Read `QUICKSTART.md` for complete setup instructions
2. Create Backstage app: `npx @backstage/create-app@latest --path backstage-form-factor`
3. Configure using `app-config-example.yaml`
4. Install plugins and wire GitHub Actions (see `QUICKSTART.md`)
5. Start: `cd ~/Projects/backstage-form-factor && yarn dev`
6. Open http://localhost:3000

## Files Created

| File | Purpose |
|------|---------|
| `catalog-info.yaml` | 5 Backstage entities with dependencies |
| `mkdocs.yml` | TechDocs site configuration |
| `docs/index.md` | TechDocs landing page |
| `backstage/templates/supabase-edge-function/template.yaml` | Scaffolder template definition |
| `backstage/templates/supabase-edge-function/skeleton/index.ts` | Generated function skeleton |

## Features Demonstrated

- ✅ **Catalog**: Browse all Form Factor components
- ✅ **TechDocs**: View rendered documentation
- ✅ **Scaffolder**: Create new Supabase edge functions
- ✅ **CI/CD**: View GitHub Actions workflow status

## Common Issues

See `QUICKSTART.md` troubleshooting section for:
- GitHub token issues
- TechDocs not building
- Catalog not refreshing
- Template actions failing
