# Fault Synthesis Report — static fallback

Deterministic output of `staticFallbackExplainer` across every plausible co-occurrence cluster derived from the glossary's `relatedFaults` graph.

Regenerate with `bun scripts/synthesis-report.ts`. Do not hand-edit. When the Edge Function is live, a Gemma column will land next to each static synthesis for side-by-side review.

- Glossary source: **hand-authored** (schema v1, generated 2026-04-17T00:00:00.000Z)
- Entries: **39**
- Clusters evaluated: **31**

## benchpress

### 1. `asymmetric_press + elbow_flare`

> Uneven press and elbow flare often cluster together. Swap 1 session/month to dumbbell bench to force per-side balance.

- **Primary fault:** `asymmetric_press`
- **Root-cause hint:** —
- **Confidence:** 35%

### 2. `shallow_depth + asymmetric_press`

> Shallow depth and uneven press often cluster together. Pause 1 second at the chest on every rep.

- **Primary fault:** `shallow_depth`
- **Root-cause hint:** —
- **Confidence:** 35%

## dead_hang

### 1. `bent_arms + shrugged_shoulders`

> Bent arms and shrugged shoulders often cluster together. Lower hang duration and prioritize fully extended arms.

- **Primary fault:** `bent_arms`
- **Root-cause hint:** —
- **Confidence:** 35%

## deadlift

### 1. `asymmetric_pull + rounded_back`

> Uneven pull and rounded back often cluster together. Add single-leg RDLs to find and strengthen the weaker side.

- **Primary fault:** `asymmetric_pull`
- **Root-cause hint:** —
- **Confidence:** 35%

### 2. `rounded_back + hips_rise_first`

> Rounded back and hips rise first often cluster together. Deload 30% and rebuild the hinge pattern before chasing numbers.

- **Primary fault:** `rounded_back`
- **Root-cause hint:** —
- **Confidence:** 35%

## farmers_walk

### 1. `lateral_lean + asymmetric_shoulders`

> Lateral lean and uneven shoulders often cluster together. Brace the side where weight is pulling you toward.

- **Primary fault:** `lateral_lean`
- **Root-cause hint:** —
- **Confidence:** 35%

### 2. `shoulder_shrug + asymmetric_shoulders`

> Shrugged shoulders and uneven shoulders often cluster together. Depress shoulders actively — think 'long neck, shoulders down'.

- **Primary fault:** `shoulder_shrug`
- **Root-cause hint:** —
- **Confidence:** 35%

### 3. `forward_lean + lateral_lean`

> Forward lean and lateral lean often cluster together. Brace core before picking up the weights.

- **Primary fault:** `forward_lean`
- **Root-cause hint:** —
- **Confidence:** 35%

### 4. `asymmetric_shoulders + lateral_lean + shoulder_shrug`

> Uneven shoulders, lateral lean, and shrugged shoulders often cluster together. Film from directly behind to see it.

- **Primary fault:** `asymmetric_shoulders`
- **Root-cause hint:** —
- **Confidence:** 35%

## pullup

### 1. `fast_descent + incomplete_extension`

> Fast descent and short extension (dead hang) often cluster together. Count 3 seconds down on every rep.

- **Primary fault:** `fast_descent`
- **Root-cause hint:** —
- **Confidence:** 35%

### 2. `incomplete_rom + incomplete_extension`

> Incomplete range and short extension (dead hang) often cluster together. Use a resistance band for assistance until chin-over is automatic.

- **Primary fault:** `incomplete_rom`
- **Root-cause hint:** —
- **Confidence:** 35%

### 3. `incomplete_rom + shoulder_elevation`

> Incomplete range and shrugged shoulders often cluster together. Use a resistance band for assistance until chin-over is automatic.

- **Primary fault:** `incomplete_rom`
- **Root-cause hint:** —
- **Confidence:** 35%

### 4. `incomplete_rom + incomplete_extension + shoulder_elevation`

> Incomplete range, short extension (dead hang), and shrugged shoulders often cluster together. Use a resistance band for assistance until chin-over is automatic.

- **Primary fault:** `incomplete_rom`
- **Root-cause hint:** —
- **Confidence:** 35%

## pushup

### 1. `elbow_flare + asymmetric_press`

> Elbow flare and uneven press often cluster together. Cue: 'tuck elbows toward ribs' on the descent.

- **Primary fault:** `elbow_flare`
- **Root-cause hint:** —
- **Confidence:** 35%

### 2. `asymmetric_press + hip_sag`

> Uneven press and hips sagging often cluster together. Switch to alternating one-arm or elevated pushups to force the weak side to work.

- **Primary fault:** `asymmetric_press`
- **Root-cause hint:** —
- **Confidence:** 35%

### 3. `shallow_depth + asymmetric_press`

> Shallow depth and uneven press often cluster together. Place a foam block under your chest as a depth marker.

- **Primary fault:** `shallow_depth`
- **Root-cause hint:** —
- **Confidence:** 35%

### 4. `hip_sag + shallow_depth`

> Hips sagging and shallow depth often cluster together. Squeeze glutes and brace abs before every rep.

- **Primary fault:** `hip_sag`
- **Root-cause hint:** —
- **Confidence:** 35%

### 5. `shallow_depth + hip_sag + asymmetric_press`

> Shallow depth, hips sagging, and uneven press often cluster together. Place a foam block under your chest as a depth marker.

- **Primary fault:** `shallow_depth`
- **Root-cause hint:** —
- **Confidence:** 35%

## rdl

### 1. `asymmetric_hinge + rounded_back`

> Uneven hinge and rounded back often cluster together. Swap in single-leg RDLs for 3–4 sessions.

- **Primary fault:** `asymmetric_hinge`
- **Root-cause hint:** —
- **Confidence:** 35%

### 2. `rounded_back + knee_bend_excessive`

> Rounded back and excessive knee bend often cluster together. Stop the hinge where your spine would start to round, not where you run out of flexibility with a bend.

- **Primary fault:** `rounded_back`
- **Root-cause hint:** —
- **Confidence:** 35%

### 3. `knee_bend_excessive + shallow_hinge`

> Excessive knee bend and shallow hinge often cluster together. Start each rep with knees soft but locked in a fixed angle.

- **Primary fault:** `knee_bend_excessive`
- **Root-cause hint:** —
- **Confidence:** 35%

### 4. `rounded_back + shallow_hinge`

> Rounded back and shallow hinge often cluster together. Stop the hinge where your spine would start to round, not where you run out of flexibility with a bend.

- **Primary fault:** `rounded_back`
- **Root-cause hint:** —
- **Confidence:** 35%

### 5. `rounded_back + knee_bend_excessive + shallow_hinge`

> Rounded back, excessive knee bend, and shallow hinge often cluster together. Stop the hinge where your spine would start to round, not where you run out of flexibility with a bend.

- **Primary fault:** `rounded_back`
- **Root-cause hint:** —
- **Confidence:** 35%

## squat

### 1. `forward_lean + hip_shift`

> Excessive forward lean and hip shift often cluster together. Test ankle dorsiflexion — if it's limited, use heeled lifting shoes or a plate under the heels.

- **Primary fault:** `forward_lean`
- **Root-cause hint:** —
- **Confidence:** 35%

### 2. `shallow_depth + forward_lean`

> Shallow depth and excessive forward lean often cluster together. Warm up your hip mobility — box-assisted squats or ankle rockers for 90s before your working sets.

- **Primary fault:** `shallow_depth`
- **Root-cause hint:** —
- **Confidence:** 35%

### 3. `knee_valgus + hip_shift`

> Knees caving in and hip shift often cluster together. Add banded clamshells and side-plank hip abduction to your warmup.

- **Primary fault:** `knee_valgus`
- **Root-cause hint:** —
- **Confidence:** 35%

### 4. `shallow_depth + hip_shift`

> Shallow depth and hip shift often cluster together. Warm up your hip mobility — box-assisted squats or ankle rockers for 90s before your working sets.

- **Primary fault:** `shallow_depth`
- **Root-cause hint:** —
- **Confidence:** 35%

### 5. `knee_valgus + shallow_depth`

> Knees caving in and shallow depth often cluster together. Add banded clamshells and side-plank hip abduction to your warmup.

- **Primary fault:** `knee_valgus`
- **Root-cause hint:** —
- **Confidence:** 35%

### 6. `hip_shift + knee_valgus + forward_lean`

> Hip shift, knees caving in, and excessive forward lean often cluster together. Test single-leg strength (B-stance or split squats) to find the weaker side.

- **Primary fault:** `hip_shift`
- **Root-cause hint:** —
- **Confidence:** 35%

### 7. `shallow_depth + forward_lean + hip_shift`

> Shallow depth, excessive forward lean, and hip shift often cluster together. Warm up your hip mobility — box-assisted squats or ankle rockers for 90s before your working sets.

- **Primary fault:** `shallow_depth`
- **Root-cause hint:** —
- **Confidence:** 35%

### 8. `knee_valgus + hip_shift + shallow_depth`

> Knees caving in, hip shift, and shallow depth often cluster together. Add banded clamshells and side-plank hip abduction to your warmup.

- **Primary fault:** `knee_valgus`
- **Root-cause hint:** —
- **Confidence:** 35%
