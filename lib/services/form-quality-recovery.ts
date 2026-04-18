import type { FormTrackingFault } from './form-tracking-fault-reporter';

export type DrillCategory = 'mobility' | 'activation' | 'technique' | 'strength';

export interface Drill {
  id: string;
  title: string;
  category: DrillCategory;
  durationSec: number;
  steps: string[];
  why: string;
  targetFaults: string[];
}

export interface FaultSummary {
  faultCode: string;
  faultDisplayName?: string;
  count: number;
  maxSeverity: 1 | 2 | 3;
}

export interface DrillPrescription {
  drill: Drill;
  reason: string;
  priority: number;
  targetFaults: FaultSummary[];
}

const DRILLS: Drill[] = [
  {
    id: 'ankle-mobility-wall-dorsi',
    title: 'Wall-assisted ankle dorsiflexion',
    category: 'mobility',
    durationSec: 120,
    steps: [
      'Face a wall with toe 4–6 inches away.',
      'Drive knee forward toward the wall without lifting heel.',
      '10 slow reps per side, pausing at end range 2 seconds.',
    ],
    why: 'Restricted ankles force knees to cave or torso to pitch forward on squats.',
    targetFaults: ['shallow_depth', 'forward_lean', 'knee_valgus'],
  },
  {
    id: 'knee-valgus-band-activation',
    title: 'Banded glute-med activation',
    category: 'activation',
    durationSec: 90,
    steps: [
      'Loop band above knees, quarter-squat stance.',
      '15 side-steps each direction pushing knees out against band.',
      'Follow with 10 bodyweight squats driving knees out.',
    ],
    why: 'Wakes up glute medius so knees stay stacked over toes under load.',
    targetFaults: ['knee_valgus', 'hip_shift'],
  },
  {
    id: 'tempo-squat-320',
    title: 'Tempo squat — 3s down, 2s pause, 0 up',
    category: 'technique',
    durationSec: 180,
    steps: [
      'Empty bar or bodyweight.',
      '3 seconds to bottom, 2-second pause below parallel, drive up.',
      '3 sets × 5 reps. Eyes forward, chest tall.',
    ],
    why: 'Slower descent trains depth awareness and kills the rush past parallel.',
    targetFaults: ['shallow_depth', 'fast_rep', 'forward_lean'],
  },
  {
    id: 'hip-hinge-dowel',
    title: 'Dowel hip-hinge drill',
    category: 'technique',
    durationSec: 120,
    steps: [
      'Hold a dowel against back (head, thoracic, sacrum touching).',
      'Hinge at hips keeping all three contact points.',
      '3 sets × 8 reps; feel hamstring stretch not lumbar flex.',
    ],
    why: 'Teaches neutral spine at the bottom of a deadlift to prevent rounding.',
    targetFaults: ['rounded_back', 'hips_rise_first'],
  },
  {
    id: 'deadlift-pause-knee',
    title: 'Paused deadlift at the knee',
    category: 'technique',
    durationSec: 180,
    steps: [
      'Lift off the floor, pause 2 seconds at knee level.',
      'Hold tight lats, chest up.',
      '3 sets × 3 reps at 50–60% of working weight.',
    ],
    why: 'Forces hips + shoulders to rise together instead of shooting hips up first.',
    targetFaults: ['hips_rise_first', 'rounded_back'],
  },
  {
    id: 'scap-pull-hang',
    title: 'Scapular pull-up from dead hang',
    category: 'activation',
    durationSec: 90,
    steps: [
      'Full dead hang, arms locked.',
      'Pull shoulder blades down + back without bending elbows.',
      '3 sets × 8 reps; 2-second hold at the top.',
    ],
    why: 'Trains the lat engagement that precedes a clean pull-up and fixes elevated shoulders.',
    targetFaults: ['shoulder_elevation', 'incomplete_rom', 'incomplete_extension'],
  },
  {
    id: 'band-pullup-rom',
    title: 'Full-ROM banded pull-up',
    category: 'strength',
    durationSec: 180,
    steps: [
      'Loop band from bar; step in for assistance.',
      'Chin clears the bar at top, arms fully extended at bottom.',
      '3 sets × 6 reps; pause 1 second at top and bottom.',
    ],
    why: 'Lets you own both end-ranges without swinging or cutting reps short.',
    targetFaults: ['incomplete_rom', 'incomplete_extension', 'fast_descent'],
  },
  {
    id: 'bench-pause-1s',
    title: '1-second paused bench press',
    category: 'technique',
    durationSec: 180,
    steps: [
      'Lower bar to chest under control.',
      'Pause 1 second on the chest before pressing.',
      '3 sets × 5 reps at 60–70% 1RM, tucked elbows ~45°.',
    ],
    why: 'Kills the bounce and retrains elbow path so you stop flaring.',
    targetFaults: ['elbow_flare', 'incomplete_lockout', 'fast_rep'],
  },
  {
    id: 'pushup-hollow-body',
    title: 'Hollow-body push-up hold',
    category: 'activation',
    durationSec: 60,
    steps: [
      'Plank position, squeeze glutes + quads, ribs down.',
      'Hold 20 seconds × 3 sets.',
      'Add a slow push-up every other round (4-sec lower).',
    ],
    why: 'Locks the midline so hips stop sagging and cadence slows.',
    targetFaults: ['hip_sag', 'fast_rep'],
  },
  {
    id: 'single-arm-row',
    title: 'Single-arm dumbbell row',
    category: 'strength',
    durationSec: 180,
    steps: [
      'Hinge to ~45°, support with free hand.',
      '3 sets × 10 reps per side, focus on weaker side first.',
      'Let the weaker side set the rep count.',
    ],
    why: 'Isolates left/right so the strong side stops carrying the pull.',
    targetFaults: ['asymmetric_pull', 'asymmetric_press'],
  },
  {
    id: 'eccentric-pullup',
    title: 'Eccentric-only pull-up (5s down)',
    category: 'strength',
    durationSec: 180,
    steps: [
      'Jump or step to chin-over-bar.',
      'Lower for 5 full seconds until arms locked.',
      '3 sets × 4 reps. Rest as needed between reps.',
    ],
    why: 'Builds the control that a fast, swinging descent skips.',
    targetFaults: ['fast_descent'],
  },
  {
    id: 'glute-bridge-iso',
    title: 'Glute-bridge iso-hold',
    category: 'activation',
    durationSec: 90,
    steps: [
      'Lying supine, feet flat, knees bent.',
      'Drive through heels to full hip extension, hold 30 seconds.',
      '3 rounds; squeeze glutes at the top.',
    ],
    why: 'Reinforces lockout — especially for deadlifts and squats that cut short.',
    targetFaults: ['incomplete_lockout', 'hips_rise_first'],
  },
  {
    id: 'split-squat-unilateral',
    title: 'Rear-foot-elevated split squat',
    category: 'strength',
    durationSec: 240,
    steps: [
      'Rear foot on bench, front knee tracks over toe.',
      '3 sets × 8 reps per side, start with weaker side.',
      'Match reps to the weaker side.',
    ],
    why: 'Fixes side-to-side imbalances that drive hip shift under the bar.',
    targetFaults: ['hip_shift', 'asymmetric_press', 'asymmetric_pull'],
  },
  {
    id: 'thoracic-extension-foam',
    title: 'Foam-roller thoracic extensions',
    category: 'mobility',
    durationSec: 120,
    steps: [
      'Roller under mid-back, hands behind head.',
      'Extend over roller 10 times at each segment.',
      'Move roller 1 inch higher each set; 3 positions.',
    ],
    why: 'Opens the upper back so bar path stays vertical and chest stays up.',
    targetFaults: ['forward_lean', 'rounded_back', 'shoulder_elevation'],
  },
  {
    id: 'generic-video-review',
    title: 'Film a set and self-review',
    category: 'technique',
    durationSec: 300,
    steps: [
      'Record your next working set from the side.',
      'Watch at 0.5× speed and mark the rep where form broke down.',
      'Drop 10% for the next session and re-film to compare.',
    ],
    why: 'Outside view catches what proprioception misses, especially on new faults.',
    targetFaults: [],
  },
];

const DRILL_BY_ID = new Map(DRILLS.map((d) => [d.id, d]));
const DRILLS_BY_FAULT = new Map<string, Drill[]>();
for (const d of DRILLS) {
  for (const fc of d.targetFaults) {
    const arr = DRILLS_BY_FAULT.get(fc) ?? [];
    arr.push(d);
    DRILLS_BY_FAULT.set(fc, arr);
  }
}

export function getDrillById(id: string): Drill | null {
  return DRILL_BY_ID.get(id) ?? null;
}

export function getAllDrills(): Drill[] {
  return DRILLS.slice();
}

function summarizeFaults(faults: FormTrackingFault[]): FaultSummary[] {
  const byCode = new Map<string, FaultSummary>();
  for (const f of faults) {
    const existing = byCode.get(f.faultCode);
    if (existing) {
      existing.count += 1;
      if (f.severity > existing.maxSeverity) existing.maxSeverity = f.severity;
      if (f.faultDisplayName && !existing.faultDisplayName) {
        existing.faultDisplayName = f.faultDisplayName;
      }
    } else {
      byCode.set(f.faultCode, {
        faultCode: f.faultCode,
        faultDisplayName: f.faultDisplayName,
        count: 1,
        maxSeverity: f.severity,
      });
    }
  }
  return Array.from(byCode.values());
}

function faultScore(s: FaultSummary): number {
  return s.maxSeverity * 1000 + s.count;
}

export function prescribeDrills(
  faults: FormTrackingFault[],
  opts?: { maxDrills?: number; includeGenericIfEmpty?: boolean }
): DrillPrescription[] {
  const max = opts?.maxDrills ?? 5;
  const includeGeneric = opts?.includeGenericIfEmpty ?? true;
  const summaries = summarizeFaults(faults).sort((a, b) => faultScore(b) - faultScore(a));
  const chosen = new Map<string, DrillPrescription>();

  for (const summary of summaries) {
    const candidates = DRILLS_BY_FAULT.get(summary.faultCode) ?? [];
    for (const drill of candidates) {
      const existing = chosen.get(drill.id);
      if (existing) {
        if (!existing.targetFaults.some((f) => f.faultCode === summary.faultCode)) {
          existing.targetFaults.push(summary);
        }
        continue;
      }
      chosen.set(drill.id, {
        drill,
        reason: buildReason(summary, drill),
        priority: 0,
        targetFaults: [summary],
      });
      if (chosen.size >= max) break;
    }
    if (chosen.size >= max) break;
  }

  if (chosen.size === 0 && includeGeneric) {
    const generic = DRILL_BY_ID.get('generic-video-review');
    if (generic) {
      chosen.set(generic.id, {
        drill: generic,
        reason: 'No specific faults detected — use this session to build a baseline.',
        priority: 0,
        targetFaults: [],
      });
    }
  }

  const prescriptions = Array.from(chosen.values());
  prescriptions.sort((a, b) => {
    const aMax = Math.max(0, ...a.targetFaults.map(faultScore));
    const bMax = Math.max(0, ...b.targetFaults.map(faultScore));
    return bMax - aMax;
  });
  prescriptions.forEach((p, i) => {
    p.priority = i + 1;
  });
  return prescriptions;
}

function buildReason(summary: FaultSummary, drill: Drill): string {
  const name = summary.faultDisplayName ?? summary.faultCode.replace(/_/g, ' ');
  const plural = summary.count > 1 ? 'reps' : 'rep';
  const severity = summary.maxSeverity === 3 ? 'major' : summary.maxSeverity === 2 ? 'moderate' : 'minor';
  return `${summary.count} ${plural} with ${severity} ${name} — ${drill.category} work.`;
}

export const FORM_QUALITY_RECOVERY_DRILL_COUNT = DRILLS.length;
