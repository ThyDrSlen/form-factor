# Tracking quality module

This module centralizes tracking-quality tuning constants, filters, occlusion and cue-hysteresis helpers, and the subject/human validation guards.

## Exports

- Config constants in `config.ts`:
  - `EMA_ALPHA_COORD`, `EMA_ALPHA_ANGLE`
  - `MAX_PX_PER_FRAME`
  - `SHOW_N_FRAMES`, `HIDE_N_FRAMES`, `HOLD_FRAMES`
  - `N_CONSEC_FRAMES`, `REP_DETECTOR_THRESHOLDS`
  - `CONFIDENCE_TIER_THRESHOLDS`
- Guard helpers in `index.ts`: `readTrackingGuardsFlag()`, `createTrackingGuards()`

## Integration

`scan-arkit.tsx` smooths joint angles with `processRealtimeAngles` from `lib/pose/realtime-form-engine.ts` in every build. There is no separate legacy/new pipeline switch. Validate tuning changes with `bun run test` and `bun run eval:pullup-tracking`.

## Release-candidate defaults

- `EMA_ALPHA_COORD=0.35`, `EMA_ALPHA_ANGLE=0.24`, `MAX_PX_PER_FRAME=36`
- `SHOW_N_FRAMES=2`, `HIDE_N_FRAMES=3`, `HOLD_FRAMES=4`
- `N_CONSEC_FRAMES=3`
- `REP_DETECTOR_THRESHOLDS`:
  - `liftStartDelta=0.05`, `liftTopDelta=0.14`, `liftTopExitDelta=0.11`, `liftBottomDelta=0.03`
  - `elbowEngageDeg=140`, `elbowTopDeg=90`, `elbowBottomDeg=150`
- `CONFIDENCE_TIER_THRESHOLDS={ low: 0.3, medium: 0.6 }`

Detailed tuning rationale and before/after metrics are captured in `.sisyphus/plans/pullup-tracking-tuning.md`.
