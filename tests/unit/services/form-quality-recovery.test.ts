import {
  FORM_QUALITY_RECOVERY_DRILL_COUNT,
  getAllDrills,
  getDrillById,
  prescribeDrills,
} from '@/lib/services/form-quality-recovery';
import type { FormTrackingFault } from '@/lib/services/form-tracking-fault-reporter';

function mkFault(
  faultCode: string,
  severity: 1 | 2 | 3 = 2,
  extras: Partial<FormTrackingFault> = {}
): FormTrackingFault {
  return {
    id: `f_${faultCode}_${Math.random()}`,
    sessionId: extras.sessionId ?? 'session-1',
    exerciseId: extras.exerciseId ?? 'squat',
    faultCode,
    severity,
    timestamp: extras.timestamp ?? 1000,
    ...extras,
  };
}

describe('form-quality-recovery', () => {
  it('exposes the full drill library', () => {
    const drills = getAllDrills();
    expect(drills.length).toBe(FORM_QUALITY_RECOVERY_DRILL_COUNT);
    expect(drills.length).toBeGreaterThanOrEqual(15);
    for (const d of drills) {
      expect(d.id).toBeTruthy();
      expect(d.title).toBeTruthy();
      expect(d.steps.length).toBeGreaterThan(0);
      expect(d.durationSec).toBeGreaterThan(0);
      expect(['mobility', 'activation', 'technique', 'strength']).toContain(d.category);
    }
  });

  it('looks up drills by id', () => {
    const d = getDrillById('tempo-squat-320');
    expect(d).not.toBeNull();
    expect(d?.category).toBe('technique');
    expect(getDrillById('does-not-exist')).toBeNull();
  });

  it('returns the generic drill when no faults are provided', () => {
    const ps = prescribeDrills([]);
    expect(ps).toHaveLength(1);
    expect(ps[0].drill.id).toBe('generic-video-review');
    expect(ps[0].priority).toBe(1);
    expect(ps[0].targetFaults).toEqual([]);
  });

  it('returns no prescriptions when generic fallback is disabled', () => {
    const ps = prescribeDrills([], { includeGenericIfEmpty: false });
    expect(ps).toEqual([]);
  });

  it('prescribes drills for a known fault', () => {
    const ps = prescribeDrills([mkFault('knee_valgus', 3)]);
    expect(ps.length).toBeGreaterThan(0);
    const ids = ps.map((p) => p.drill.id);
    expect(ids).toContain('knee-valgus-band-activation');
    expect(ps[0].reason).toMatch(/major/);
  });

  it('prioritizes faults with higher severity first', () => {
    const ps = prescribeDrills([
      mkFault('shallow_depth', 1),
      mkFault('knee_valgus', 3),
    ]);
    const topDrill = ps[0].drill;
    expect(topDrill.targetFaults).toContain('knee_valgus');
    expect(ps[0].priority).toBe(1);
  });

  it('breaks ties by frequency when severity matches', () => {
    const ps = prescribeDrills([
      mkFault('shallow_depth', 2),
      mkFault('shallow_depth', 2),
      mkFault('shallow_depth', 2),
      mkFault('forward_lean', 2),
    ]);
    expect(ps[0].targetFaults[0].faultCode).toBe('shallow_depth');
    expect(ps[0].targetFaults[0].count).toBe(3);
  });

  it('caps prescriptions at maxDrills', () => {
    const ps = prescribeDrills(
      [
        mkFault('knee_valgus', 3),
        mkFault('shallow_depth', 3),
        mkFault('hips_rise_first', 3),
        mkFault('rounded_back', 3),
        mkFault('elbow_flare', 3),
        mkFault('fast_descent', 3),
        mkFault('hip_sag', 3),
      ],
      { maxDrills: 3 }
    );
    expect(ps.length).toBeLessThanOrEqual(3);
  });

  it('dedupes drills that target multiple faults', () => {
    const ps = prescribeDrills([
      mkFault('shallow_depth', 2),
      mkFault('forward_lean', 2),
    ]);
    const tempo = ps.find((p) => p.drill.id === 'tempo-squat-320');
    expect(tempo).toBeDefined();
    expect(tempo?.targetFaults.length).toBeGreaterThanOrEqual(1);
  });

  it('preserves faultDisplayName when present', () => {
    const ps = prescribeDrills([
      mkFault('knee_valgus', 2, { faultDisplayName: 'Knee Valgus (Cave-in)' }),
    ]);
    expect(ps[0].targetFaults[0].faultDisplayName).toBe('Knee Valgus (Cave-in)');
  });

  it('aggregates count + maxSeverity per fault code', () => {
    const ps = prescribeDrills([
      mkFault('knee_valgus', 1),
      mkFault('knee_valgus', 3),
      mkFault('knee_valgus', 2),
    ]);
    const summary = ps[0].targetFaults.find((s) => s.faultCode === 'knee_valgus');
    expect(summary).toBeDefined();
    expect(summary?.count).toBe(3);
    expect(summary?.maxSeverity).toBe(3);
  });

  it('assigns priority 1 to top-scored drill and higher numbers to lower-scored', () => {
    const ps = prescribeDrills([
      mkFault('knee_valgus', 3),
      mkFault('shallow_depth', 1),
    ]);
    expect(ps.length).toBeGreaterThanOrEqual(2);
    expect(ps[0].priority).toBe(1);
    if (ps[1]) expect(ps[1].priority).toBe(2);
  });

  it('reason string reflects the count + severity of the driver fault', () => {
    const ps = prescribeDrills([
      mkFault('knee_valgus', 2, { faultDisplayName: 'Knee Valgus' }),
      mkFault('knee_valgus', 2),
    ]);
    expect(ps[0].reason).toContain('2');
    expect(ps[0].reason).toMatch(/moderate/i);
  });

  it('all drill targetFaults reference known canonical fault codes', () => {
    const known = new Set([
      'shallow_depth', 'incomplete_lockout', 'knee_valgus', 'fast_rep', 'hip_shift',
      'forward_lean', 'rounded_back', 'hips_rise_first', 'asymmetric_pull',
      'asymmetric_press', 'fast_descent', 'elbow_flare', 'hip_sag',
      'incomplete_rom', 'incomplete_extension', 'shoulder_elevation',
    ]);
    for (const d of getAllDrills()) {
      for (const fc of d.targetFaults) {
        expect(known.has(fc)).toBe(true);
      }
    }
  });
});
