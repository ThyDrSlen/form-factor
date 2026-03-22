# Mission: Health Dashboard That Motivates

You are working on the Form Factor iOS fitness app (Expo 54 + React Native 0.83 + React 19).

## Your Goal

Redesign the health/trends display to emphasize progress. Show weekly deltas
(steps up 12% from last week), streak counters, personal records. The dashboard should
make someone who's training consistently feel good about their progress.

## Current Health Infrastructure

### Dashboard Components
- `components/dashboard-health/DashboardHealth.tsx` — Main health dashboard widget
- `components/dashboard-health/HealthTrendsView.tsx` — Health trend visualization
- `components/activity-rings/` — Activity ring components (Apple Watch style)
- `components/weight-dashboard/` — Weight tracking dashboard

### Health Data Layer
- `contexts/HealthKitContext.tsx` — React context providing HealthKit data to the app
- `lib/services/healthkit/index.ts` — HealthKit service barrel export
- `lib/services/healthkit/health-metrics.ts` — Fetch health metrics (steps, heart rate, etc.)
- `lib/services/healthkit/health-aggregation.ts` — Aggregate health data over time periods
- `lib/services/healthkit/weight-trends.ts` — Weight trend analysis and smoothing
- `lib/services/healthkit/health-permissions.ts` — HealthKit permission management
- `lib/services/healthkit/health-bulk-sync.ts` — Bulk sync historical data to Supabase
- `lib/services/healthkit/health-supabase.ts` — Sync health data to Supabase
- `lib/services/healthkit/health-types.ts` — TypeScript types for health data
- `lib/services/healthkit/native-healthkit.ts` — Native HealthKit bridge

### Related Screens
- `app/(tabs)/index.tsx` — Home tab (likely shows dashboard summary)
- `app/(modals)/workout-insights.tsx` — Workout performance insights
- `lib/services/workout-insights.ts` — Workout insight calculations
- `lib/services/workout-insights-helpers.ts` — Helper functions for insights

### Nutrition Goals
- `contexts/NutritionGoalsContext.tsx` — User's calorie/macro goals
- `app/(onboarding)/nutrition-goals.tsx` — Goal setting during onboarding

### Workout Data
- `contexts/WorkoutsContext.tsx` — Workout history
- `lib/stores/session-runner.ts` — Active session state
- `lib/services/fqi-calculator.ts` — Form Quality Index scoring

## What To Do

### Step 1: Audit Current Dashboard
Read these files thoroughly:
- `components/dashboard-health/DashboardHealth.tsx`
- `components/dashboard-health/HealthTrendsView.tsx`
- `components/activity-rings/` (all files)
- `components/weight-dashboard/` (all files)
- `app/(tabs)/index.tsx` (home tab)
- `contexts/HealthKitContext.tsx`

Understand what data is currently displayed and how.

### Step 2: Add Weekly Progress Deltas
For each health metric (steps, calories, heart rate, weight):
- Calculate this week's average vs last week's average
- Show delta as percentage with up/down arrow and color coding:
  - Green up arrow for positive changes (more steps, more calories burned)
  - Green down arrow for weight loss (if that's the user's goal)
  - Neutral gray for < 2% change
- Display next to each metric: "Steps: 8,234 avg (+12% vs last week)"

### Step 3: Add Streak Counter
Track and display:
- **Workout streak**: consecutive days with at least one logged workout (from `WorkoutsContext`)
- **Nutrition streak**: consecutive days with food logged (from `FoodContext`)
- **Activity streak**: consecutive days hitting step goal (from `HealthKitContext`)
- Show as a prominent card with flame/fire emoji and streak count
- Historical best streak for motivation: "Current: 14 days | Best: 23 days"

### Step 4: Personal Records
From workout history in `WorkoutsContext`:
- Track PRs for key lifts (heaviest weight, most reps, best form score)
- Show recent PRs prominently: "New PR! Squat: 225 lbs (was 215)"
- Use FQI data from `lib/services/fqi-calculator.ts` for "Best Form" records

### Step 5: Progress Visualization
Improve the existing charts/graphs:
- Weekly bar chart for workout volume (sets x reps x weight)
- Trend line for body weight (using `lib/services/healthkit/weight-trends.ts`)
- Daily step count with goal line
- Make charts scannable at a glance — big numbers, clear labels

### Step 6: Motivational Elements
- Daily greeting with context: "Great morning, [name]! You're on a 7-day streak."
- Weekly summary card: "This week: 5 workouts, 42 sets, 2 new PRs"
- Show comparison to user's averages: "You're training more than your 4-week average"

## Constraints
- Package manager is `bun` (never npm/yarn/npx)
- NativeWind (Tailwind) for styling
- React Native Paper for UI components
- Moti for animations
- `react-native-chart-kit` is already installed for charting
- Run `bun run lint` and `bun run check:types` after changes
- Commit after each logical change with `feat(health): description` format
- Do NOT modify `supabase/` migrations or edge functions
- Do NOT modify `ios/` or `android/` native code
- Do NOT add new dependencies without documenting why
- Do NOT touch `.env` files
- Path alias: `@/` maps to project root
- All health data comes from HealthKit (local) or local SQLite — no extra network calls needed

## How To Verify
1. `bun run lint` must pass
2. `bun run check:types` must pass
3. `bun run test` should not regress

## Success Criteria
- A user opening the app sees their progress immediately
- Weekly deltas are visible for all key metrics
- Streak counter is prominent and motivating
- Recent PRs are celebrated visually
- The dashboard makes consistent trainers feel good about their progress
- Charts are scannable at a glance — no need to study them
