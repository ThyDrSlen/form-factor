# Testing Guide

This document covers testing strategies and commands for the Form Factor project.

## Test Types

### 1. Unit Tests (Jest)

Unit tests verify individual components and functions in isolation.

```bash
# Run all unit tests
bun run test

# Run with watch mode
bun run test:watch

# Run with coverage
bun run test:coverage
```

### 2. E2E Tests (Playwright)

E2E tests verify complete user flows in a real browser environment.

#### Running E2E Tests Locally

```bash
# Run all E2E tests
bun run test:e2e

# Run with interactive UI mode
bun run test:e2e:ui

# Show HTML report
bun run test:e2e:report
```

#### Running E2E Tests in Docker

```bash
# Build and run tests in container
bun run test:e2e:docker

# Or manually with docker-compose
docker-compose up --build e2e
```

The Docker setup ensures consistent test environments across different machines.

## Test Structure

```
tests/
├── e2e/                      # Playwright E2E tests
│   ├── fixtures/
│   │   └── base.ts          # Base test fixture
│   ├── utils/
│   │   └── test-helpers.ts  # Common utilities
│   ├── smoke.spec.ts        # Basic smoke tests
│   ├── navigation.spec.ts   # Navigation tests
│   ├── critical-flows.spec.ts # User flow tests
│   └── auth.flow.spec.ts    # Authentication tests
└── unit/                    # Jest unit tests
```

## Writing E2E Tests

### Basic Test Structure

```typescript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should do something', async ({ page }) => {
    await expect(page.getByText('Expected Text')).toBeVisible();
  });
});
```

### Using Test Helpers

```typescript
import { waitForAppLoad, checkForConsoleErrors } from './utils/test-helpers';

test('example with helpers', async ({ page }) => {
  await page.goto('/');
  await waitForAppLoad(page);
  
  const errors = await checkForConsoleErrors(page);
  expect(errors).toHaveLength(0);
});
```

## Configuration

### Playwright Config

The main configuration is in `etc/playwright.config.ts`:
- Base URL: http://localhost:8081
- Browser: Chromium
- Screenshots: On failure only
- Traces: On first retry

### Environment Variables

- `BASE_URL`: Override the test target URL
- `CI`: Set to `true` in CI environments (enables retries, disables UI)

## Best Practices

1. **Use explicit waits**: Don't rely on arbitrary timeouts
2. **Test user flows**: Focus on what users actually do
3. **Avoid test interdependence**: Each test should be independent
4. **Use data-testid**: Prefer semantic selectors over CSS classes
5. **Clean up state**: Reset state in beforeEach hooks

## Debugging Failed Tests

### Local Debugging

1. Run with UI mode: `bun run test:e2e:ui`
2. Check screenshots in `test-results/screenshots/`
3. View HTML report: `bun run test:e2e:report`
4. Check console errors in test output

### CI Debugging

1. Download artifacts from GitHub Actions
2. Check `playwright-report/` for HTML results
3. Review `test-results/` for screenshots and traces

## CI/CD Integration

E2E tests run automatically on:
- Pull requests to `main`
- Pushes to `main` and `develop`

Tests are configured to:
- Retry failed tests twice in CI
- Upload artifacts (screenshots, reports) on failure
- Run in parallel locally, sequentially in CI

## Troubleshooting

### Tests pass locally but fail in CI

- Check for timing issues (add explicit waits)
- Verify all dependencies are installed
- Check BASE_URL is accessible in CI

### Browser launch fails

```bash
# Reinstall Playwright browsers
bunx playwright install chromium
```

### Docker tests timeout

- Ensure the app is accessible at `host.docker.internal:8081`
- Check Docker network settings
- Verify Docker image builds successfully
