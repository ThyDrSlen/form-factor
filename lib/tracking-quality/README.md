# Tracking quality module

This module centralizes tracking-quality tuning constants and exposes the pipeline flag read path.

## Exports

- Config constants in `config.ts`:
  - `EMA_ALPHA_COORD`, `EMA_ALPHA_ANGLE`
  - `MAX_PX_PER_FRAME`
  - `SHOW_N_FRAMES`, `HIDE_N_FRAMES`, `HOLD_FRAMES`
  - `N_CONSEC_FRAMES`, `REP_DETECTOR_THRESHOLDS`
  - `CONFIDENCE_TIER_THRESHOLDS`
- Flag helpers in `index.ts`:
  - `readUseNewTrackingPipelineFlag()`
  - `resolveTrackingPipelineMode()`
  - `getTrackingPipelineFlags()`
  - `getTrackingQualityPipeline()`

## Flag behavior

- `EXPO_PUBLIC_USE_NEW_TRACKING_PIPELINE` (preferred) or `USE_NEW_TRACKING_PIPELINE` can explicitly enable/disable the new path.
- If unset, default is `true` for dev/test (`__DEV__` or `NODE_ENV=test`) and `false` otherwise.

## Current integration

`scan-arkit.tsx` switches between legacy and new pipeline at initialization boundaries only. Legacy behavior stays unchanged when the flag is `false`.

## Rollout and rollback guide (`useNewTrackingPipeline`)

- Rollout path:
  - Set `EXPO_PUBLIC_USE_NEW_TRACKING_PIPELINE=true` (or `USE_NEW_TRACKING_PIPELINE=true`) for the target environment.
  - Keep legacy path available; no code removal is required for rollout.
  - Validate with `bun run test` and `bun run eval:pullup-tracking` before widening rollout.
- Rollback path:
  - Flip `EXPO_PUBLIC_USE_NEW_TRACKING_PIPELINE=false` (or `USE_NEW_TRACKING_PIPELINE=false`).
  - Restart/redeploy so initialization re-reads env flags.
  - `scan-arkit.tsx` resumes legacy create/process functions at init boundaries with no migration step.

## Release-candidate defaults

- `EMA_ALPHA_COORD=0.35`, `EMA_ALPHA_ANGLE=0.24`, `MAX_PX_PER_FRAME=36`
- `SHOW_N_FRAMES=2`, `HIDE_N_FRAMES=3`, `HOLD_FRAMES=4`
- `N_CONSEC_FRAMES=3`
- `REP_DETECTOR_THRESHOLDS`:
  - `liftStartDelta=0.05`, `liftTopDelta=0.14`, `liftTopExitDelta=0.11`, `liftBottomDelta=0.03`
  - `elbowEngageDeg=140`, `elbowTopDeg=90`, `elbowBottomDeg=150`
- `CONFIDENCE_TIER_THRESHOLDS={ low: 0.3, medium: 0.6 }`

Detailed tuning rationale and before/after metrics are captured in `.sisyphus/plans/pullup-tracking-tuning.md`.
