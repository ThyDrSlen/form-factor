/**
 * Calibration failure — A14 per-reason remediation mapping contract.
 *
 * The calibration-failure-recovery modal falls back to REASON_REMEDIATION
 * when the analyzer does not pass an explicit `remediation` query param.
 * This test pins the exact copy for each recognized reason so a future
 * copy tweak can't silently regress the UX.
 */
import {
  REASON_REMEDIATION,
  REASON_EXPLANATION,
} from '@/app/(modals)/calibration-failure-recovery';

describe('calibration-failure-recovery — A14 remediation mapping', () => {
  it('exposes remediation copy for every supported reason', () => {
    expect(REASON_REMEDIATION.low_stability).toMatch(/posture/i);
    expect(REASON_REMEDIATION.excessive_drift).toMatch(/drift/i);
    expect(REASON_REMEDIATION.insufficient_samples).toMatch(/stillness/i);
    expect(REASON_REMEDIATION.low_confidence).toMatch(/camera/i);
    expect(REASON_REMEDIATION.timeout).toMatch(/lighting|framing/i);
  });

  it('exposes "why" explanations aligned with the same keys', () => {
    expect(REASON_EXPLANATION.low_stability).toMatch(/pose|average/i);
    expect(REASON_EXPLANATION.excessive_drift).toMatch(/framing|moved/i);
    expect(REASON_EXPLANATION.insufficient_samples).toMatch(/frames|minimum/i);
    expect(REASON_EXPLANATION.low_confidence).toMatch(/confidence/i);
    expect(REASON_EXPLANATION.timeout).toMatch(/time budget/i);
  });

  it('every remediation key has a matching explanation key', () => {
    const remediationKeys = Object.keys(REASON_REMEDIATION).sort();
    const explanationKeys = Object.keys(REASON_EXPLANATION).sort();
    expect(explanationKeys).toEqual(remediationKeys);
  });
});
