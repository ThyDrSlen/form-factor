/**
 * ar-overlays-v2-flag
 *
 * Master feature flag for the AR overlay + form-tracking resilience
 * package introduced in #445 (W3-A + W3-D). When off, none of the new
 * resilience hooks or SVG overlays (JointArcOverlay, CueArrowOverlay,
 * ROMProgressBar, FaultHighlight, FramingGuide) render in the scan
 * screen and the subject-identity / permission / AppState / thermal
 * hooks stay idle. This keeps revert a one-line change.
 *
 * Parsing:
 * - `EXPO_PUBLIC_AR_OVERLAYS_V2=on`  → enabled
 * - `EXPO_PUBLIC_AR_OVERLAYS_V2=off` → disabled
 * - unset / anything else            → disabled (fail safe)
 *
 * Intentionally strict string matching so the knob is unambiguous — only
 * the literal `'on'` value flips it on.
 */

const FLAG_ENV_VAR = 'EXPO_PUBLIC_AR_OVERLAYS_V2';

export function isAROverlaysV2Enabled(): boolean {
  const raw = process.env[FLAG_ENV_VAR];
  if (typeof raw !== 'string') return false;
  return raw === 'on';
}
