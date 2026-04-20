# Form Home tab (issue #470)

The **Form** tab anchors form-tracking as a primary flow. Until this PR,
ARKit scan sessions had no dedicated landing surface — the Analyze tab
went straight into live capture and Insights lived behind a modal route.

## Component tree

```
app/(tabs)/form.tsx
├── TodayFqiCard
├── WeeklyTrendChart
├── FaultHeatmapThumb → app/(modals)/fault-heatmap.tsx
├── StartSessionCta → /(tabs)/scan-arkit
├── NutritionFormCorrelationCard
└── RecoveryFormCorrelationCard
```

All cards live under `components/form-home/` — intentionally disjoint
from `components/insights/` (which is owned by #444) so neither surface
can step on the other.

## Data sources

| Surface                              | Source                                                    |
| ------------------------------------ | --------------------------------------------------------- |
| today FQI / trend / faults           | `hooks/use-form-home-data.ts`                             |
| nutrition / recovery correlations    | `hooks/use-nutrition-form-insights.ts`                    |
| food entries                         | `contexts/FoodContext.tsx`                                |
| health metrics series                | `contexts/HealthKitContext.tsx`                           |
| session FQI averages                 | Supabase `session_metrics` + `reps` tables                |

Both hooks keep their results in a module-level cache (60s for form-home
data, 1h for nutrition insights). A 250ms debounce guards against rapid
re-mount cycles when users bounce between tabs.

## Correlation math

Both correlators return Pearson r, linear slope, R², sample count, and a
significance tag per feature. Features are windowed so the math stays
grounded in cause-proximate data:

- `correlateNutritionWithForm`: windows meals +/- N hours around session
  start (default N=3). Features: total protein / carbs / calories in
  window, minutes-since-last-meal.
- `correlateRecoveryWithForm`: joins session day with recovery records.
  Sleep defaults to the **night before** the session; HRV and resting
  heart rate default to the **session day** itself.

### Sample-size thresholds

| Tag      | Minimum n | Minimum |r| |
| -------- | --------- | ----------- |
| `low`    | any       | any         |
| `medium` | 5         | 0.30        |
| `high`   | 10        | 0.50        |

The `<5` guard is why correlation cards render a gentle "log a few more"
empty state rather than a flat line at zero.

## Privacy

- Both correlators are **pure TypeScript**. No PII or raw session data
  leaves the device — the correlations are computed on-device from data
  the user already loaded via existing contexts.
- No new Supabase tables, RLS policies, or migrations. The hook uses
  the same `session_metrics` + `reps` tables that `workout-insights.ts`
  already consumes.

## Cross-PR stubs

This PR intentionally stops at user-facing surfaces; deeper hooks to
write or persist results are left as stubs that follow-up PRs can pick
up:

- **Sleep series**: `HealthKitContext` does not yet surface a sleep
  duration series. `toRecoveryData()` currently feeds only walking HR
  average as a resting-HR proxy; sleep/HRV slots are wired but null.
- **Fault heatmap modal data**: the expanded modal at
  `app/(modals)/fault-heatmap.tsx` renders the same component as the
  thumb but with a placeholder `cells` array. A follow-up can plumb
  `useFormHomeData` through route params or a lightweight context so
  the modal shares the tab's in-memory state.
- **Form-home → coach hand-off**: the per-insight "Learn more" modal
  currently lists all insights; a follow-up could wire a "Ask coach
  about this" button that feeds the insight into the coach service
  with pre-populated context.
