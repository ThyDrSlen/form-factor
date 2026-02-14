# Tracking quality module

This module centralizes tracking-quality tuning constants and exposes the pipeline flag read path.

## Exports

- Config constants in `config.ts`:
  - `EMA_ALPHA_COORD`, `EMA_ALPHA_ANGLE`
  - `MAX_PX_PER_FRAME`
  - `SHOW_N_FRAMES`, `HIDE_N_FRAMES`, `HOLD_FRAMES`
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
