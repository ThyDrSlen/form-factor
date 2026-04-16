/**
 * Fault Explainability Service
 *
 * Converts opaque fault IDs (e.g. `hips_rise_first`, `forward_lean`) into
 * natural-language rationales enriched with the per-rep angle deltas that
 * triggered the fault. This lives alongside the existing fault detectors in
 * `lib/workouts/*.ts` — those detectors emit the IDs while this service is
 * the single source of truth for human-readable explanations.
 *
 * The service is pure (no side effects, no I/O) and deterministic for a
 * given `(faultId, repContext, workoutId)` triple, which makes it safe to
 * memoise inside UI-layer hooks.
 */
import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';

// =============================================================================
// Public types
// =============================================================================

/**
 * Structured explanation payload. Consumers that just need a single string
 * can call `renderExplanation(explanation)`.
 */
export interface FaultExplanation {
  /** Fault id that triggered this explanation (e.g. `hips_rise_first`). */
  faultId: string;
  /** Human-readable workout id (e.g. `deadlift`). Empty string if unknown. */
  workoutId: string;
  /** Rep number within the set (1-indexed). */
  repNumber: number;
  /** Short title suitable for a chip/card header. */
  title: string;
  /** Full rationale (1-3 sentences) with angle deltas inlined. */
  rationale: string;
  /** Coaching cue (short, imperative). */
  cue: string;
  /** Raw numeric deltas the rationale was built from (for UI readouts). */
  metrics: Record<string, number>;
}

// =============================================================================
// Internal helpers
// =============================================================================

function avg(a: number, b: number): number {
  return (a + b) / 2;
}

/**
 * Round a degrees value to 1 decimal place. Guards against `NaN`/`Infinity`
 * so template strings never render "NaN" to the user.
 */
function fmtDeg(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Math.abs(n) >= 10 ? Math.round(n).toString() : n.toFixed(1);
}

function fmtSec(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  return `${(ms / 1000).toFixed(1)}s`;
}

function maxJoint(
  angles: JointAngles,
  left: keyof JointAngles,
  right: keyof JointAngles,
): number {
  return Math.max(angles[left], angles[right]);
}

function minJoint(
  angles: JointAngles,
  left: keyof JointAngles,
  right: keyof JointAngles,
): number {
  return Math.min(angles[left], angles[right]);
}

// =============================================================================
// Fault template registry
// =============================================================================

type ExplanationBuilder = (ctx: RepContext, workoutId: string) => FaultExplanation;

/**
 * Registry of per-fault explanation builders. Keyed by fault id; values
 * produce a fully populated `FaultExplanation` for the given rep context.
 *
 * Shared ids (e.g. `incomplete_lockout`) may dispatch on `workoutId` inside
 * the builder since the same fault often applies to different joints
 * depending on the exercise.
 */
const BUILDERS: Record<string, ExplanationBuilder> = {
  hips_rise_first: (ctx, workoutId) => {
    const hipChange = ctx.maxAngles.leftHip - ctx.startAngles.leftHip;
    const kneeChange = ctx.maxAngles.leftKnee - ctx.startAngles.leftKnee;
    const delta = hipChange - kneeChange;
    return {
      faultId: 'hips_rise_first',
      workoutId,
      repNumber: ctx.repNumber,
      title: 'Hips rose before the bar',
      rationale:
        `Your hips extended ${fmtDeg(hipChange)} deg while your knees ` +
        `only extended ${fmtDeg(kneeChange)} deg — a ${fmtDeg(delta)} deg ` +
        `hip-lead. This shifts the load onto the lower back instead of ` +
        `the legs.`,
      cue: 'Drive with your legs — push the floor away, keep chest and hips rising together.',
      metrics: {
        hipChangeDeg: hipChange,
        kneeChangeDeg: kneeChange,
        hipLeadDeg: delta,
      },
    };
  },

  forward_lean: (ctx, workoutId): FaultExplanation => {
    // Squat / farmers-walk both fire `forward_lean`. We dispatch by workout
    // so the rationale references the right joint delta.
    if (workoutId === 'farmers_walk') {
      const maxHip = avg(ctx.maxAngles.leftHip, ctx.maxAngles.rightHip);
      const shortfall = 180 - maxHip;
      return {
        faultId: 'forward_lean',
        workoutId,
        repNumber: ctx.repNumber,
        title: 'Trunk collapsed forward',
        rationale:
          `Hip angle never reached full extension — peaked at ` +
          `${fmtDeg(maxHip)} deg (${fmtDeg(shortfall)} deg short of upright). ` +
          `Under load this loads the low back instead of the legs.`,
        cue: 'Stand tall — brace the core, pull the ribs down, and lock out the hips.',
        metrics: {
          peakHipDeg: maxHip,
          shortfallFromUprightDeg: shortfall,
        },
      };
    }
    // Default: squat forward lean — hip much lower than knee at depth.
    const minHip = avg(ctx.minAngles.leftHip, ctx.minAngles.rightHip);
    const minKnee = avg(ctx.minAngles.leftKnee, ctx.minAngles.rightKnee);
    const gap = minKnee - minHip;
    return {
      faultId: 'forward_lean',
      workoutId,
      repNumber: ctx.repNumber,
      title: 'Chest folded over at depth',
      rationale:
        `At the bottom of the rep, hip angle (${fmtDeg(minHip)} deg) ` +
        `closed ${fmtDeg(gap)} deg further than knee angle ` +
        `(${fmtDeg(minKnee)} deg). That forward torso tilt shifts the ` +
        `bar path over the toes and offloads the quads.`,
      cue: 'Keep your chest up — sit between your knees, don\'t bow over the bar.',
      metrics: {
        minHipDeg: minHip,
        minKneeDeg: minKnee,
        leanGapDeg: gap,
      },
    };
  },

  lateral_lean: (ctx, workoutId) => {
    const hipDiff = Math.abs(ctx.minAngles.leftHip - ctx.minAngles.rightHip);
    return {
      faultId: 'lateral_lean',
      workoutId,
      repNumber: ctx.repNumber,
      title: 'Leaning to one side',
      rationale:
        `Left and right hip angles diverged by ${fmtDeg(hipDiff)} deg ` +
        `(L=${fmtDeg(ctx.minAngles.leftHip)} deg, ` +
        `R=${fmtDeg(ctx.minAngles.rightHip)} deg). The heavier side is ` +
        `compensating for the lighter one, which is an injury risk under load.`,
      cue: 'Stay centered over your hips — even weight on both feet, don\'t let one side drop.',
      metrics: {
        hipAsymmetryDeg: hipDiff,
        leftHipDeg: ctx.minAngles.leftHip,
        rightHipDeg: ctx.minAngles.rightHip,
      },
    };
  },

  incomplete_lockout: (ctx, workoutId): FaultExplanation => {
    // Dispatch by workout — different joints define lockout.
    if (workoutId === 'pushup' || workoutId === 'benchpress') {
      const endElbow = avg(ctx.endAngles.leftElbow, ctx.endAngles.rightElbow);
      const shortfall = 180 - endElbow;
      return {
        faultId: 'incomplete_lockout',
        workoutId,
        repNumber: ctx.repNumber,
        title: 'Arms didn\'t fully lock out',
        rationale:
          `Elbows finished at ${fmtDeg(endElbow)} deg ` +
          `(${fmtDeg(shortfall)} deg short of full extension). Each ` +
          `incomplete rep costs triceps work and may skew rep-count ` +
          `accuracy.`,
        cue: 'Press all the way through — finish every rep with the elbows straight.',
        metrics: {
          endElbowDeg: endElbow,
          shortfallFromLockoutDeg: shortfall,
        },
      };
    }
    if (workoutId === 'squat') {
      const endKnee = avg(ctx.endAngles.leftKnee, ctx.endAngles.rightKnee);
      const shortfall = 180 - endKnee;
      return {
        faultId: 'incomplete_lockout',
        workoutId,
        repNumber: ctx.repNumber,
        title: 'Didn\'t stand all the way up',
        rationale:
          `Knees finished at ${fmtDeg(endKnee)} deg ` +
          `(${fmtDeg(shortfall)} deg short of standing). Stand tall ` +
          `between reps so each rep is a clean one.`,
        cue: 'Drive all the way up — hips through, knees straight, then descend.',
        metrics: {
          endKneeDeg: endKnee,
          shortfallFromLockoutDeg: shortfall,
        },
      };
    }
    // deadlift / rdl default — lockout is measured at the hip.
    const maxHip = avg(ctx.maxAngles.leftHip, ctx.maxAngles.rightHip);
    const shortfall = 180 - maxHip;
    return {
      faultId: 'incomplete_lockout',
      workoutId,
      repNumber: ctx.repNumber,
      title: 'Hips never fully locked out',
      rationale:
        `Hip angle peaked at ${fmtDeg(maxHip)} deg — ${fmtDeg(shortfall)} ` +
        `deg short of full extension. Finish the pull by squeezing the ` +
        `glutes and standing tall.`,
      cue: 'Finish the rep — glutes squeezed, hips through, chest tall.',
      metrics: {
        peakHipDeg: maxHip,
        shortfallFromLockoutDeg: shortfall,
      },
    };
  },

  knee_valgus: (ctx, workoutId) => {
    const kneeDiff = Math.abs(
      ctx.minAngles.leftKnee - ctx.minAngles.rightKnee,
    );
    const dominant = ctx.minAngles.leftKnee < ctx.minAngles.rightKnee
      ? 'left'
      : 'right';
    return {
      faultId: 'knee_valgus',
      workoutId,
      repNumber: ctx.repNumber,
      title: 'Knee caving in',
      rationale:
        `Knees diverged by ${fmtDeg(kneeDiff)} deg at depth ` +
        `(L=${fmtDeg(ctx.minAngles.leftKnee)} deg, ` +
        `R=${fmtDeg(ctx.minAngles.rightKnee)} deg). The ${dominant} knee ` +
        `bent further than the other, suggesting valgus collapse — a ` +
        `common cause of knee pain.`,
      cue: 'Push your knees out over your toes — drive the floor apart.',
      metrics: {
        kneeAsymmetryDeg: kneeDiff,
        leftKneeDeg: ctx.minAngles.leftKnee,
        rightKneeDeg: ctx.minAngles.rightKnee,
      },
    };
  },

  elbow_flare: (ctx, workoutId) => {
    const maxShoulder = maxJoint(
      ctx.maxAngles,
      'leftShoulder',
      'rightShoulder',
    );
    const over = Math.max(0, maxShoulder - 120);
    return {
      faultId: 'elbow_flare',
      workoutId,
      repNumber: ctx.repNumber,
      title: 'Elbows flared out',
      rationale:
        `Shoulder abduction peaked at ${fmtDeg(maxShoulder)} deg ` +
        `(${fmtDeg(over)} deg past the 120 deg safety threshold). ` +
        `Flared elbows stress the anterior shoulder and limit how much ` +
        `the ${workoutId === 'benchpress' ? 'chest' : 'triceps'} can contribute.`,
      cue: 'Tuck your elbows to ~45 deg — think "break the bar" to engage lats.',
      metrics: {
        peakShoulderDeg: maxShoulder,
        degreesPastThreshold: over,
      },
    };
  },

  // -----------------------------------------------------------------
  // Bonus faults (not required by the acceptance criteria, but present
  // in workouts so shipping rationales avoids "unknown fault" cards).
  // -----------------------------------------------------------------

  shallow_depth: (ctx, workoutId): FaultExplanation => {
    if (workoutId === 'pushup' || workoutId === 'benchpress') {
      const minElbow = avg(ctx.minAngles.leftElbow, ctx.minAngles.rightElbow);
      const gap = Math.max(0, minElbow - 90);
      return {
        faultId: 'shallow_depth',
        workoutId,
        repNumber: ctx.repNumber,
        title: 'Not deep enough',
        rationale:
          `Minimum elbow angle was ${fmtDeg(minElbow)} deg — ${fmtDeg(gap)} ` +
          `deg shallower than the 90 deg target.`,
        cue: 'Lower all the way down until your elbows reach ~90 deg.',
        metrics: {
          minElbowDeg: minElbow,
          gapFromTargetDeg: gap,
        },
      };
    }
    const minKnee = avg(ctx.minAngles.leftKnee, ctx.minAngles.rightKnee);
    const gap = Math.max(0, minKnee - 90);
    return {
      faultId: 'shallow_depth',
      workoutId,
      repNumber: ctx.repNumber,
      title: 'Not deep enough',
      rationale:
        `Knees bent to ${fmtDeg(minKnee)} deg — ${fmtDeg(gap)} deg ` +
        `shallow of parallel. Target hip crease below the top of the knee.`,
      cue: 'Sit deeper — hip crease under the knee for a full rep.',
      metrics: {
        minKneeDeg: minKnee,
        gapFromParallelDeg: gap,
      },
    };
  },

  rounded_back: (ctx, workoutId) => {
    const maxShoulder = maxJoint(
      ctx.maxAngles,
      'leftShoulder',
      'rightShoulder',
    );
    return {
      faultId: 'rounded_back',
      workoutId,
      repNumber: ctx.repNumber,
      title: 'Back rounded under load',
      rationale:
        `Shoulder angle reached ${fmtDeg(maxShoulder)} deg, indicating ` +
        `the upper back lost its brace. Spinal flexion with weight is the ` +
        `highest-risk deadlift fault.`,
      cue: 'Chest proud, lats tight — pull the slack out before driving.',
      metrics: {
        maxShoulderDeg: maxShoulder,
      },
    };
  },

  asymmetric_pull: (ctx, workoutId) => {
    const hipDiff = Math.abs(ctx.maxAngles.leftHip - ctx.maxAngles.rightHip);
    return {
      faultId: 'asymmetric_pull',
      workoutId,
      repNumber: ctx.repNumber,
      title: 'Pulling unevenly',
      rationale:
        `Hip extension asymmetry peaked at ${fmtDeg(hipDiff)} deg. One ` +
        `side of the bar rose faster than the other.`,
      cue: 'Keep the bar level — grip even, breathe in, brace, then drive.',
      metrics: {
        hipAsymmetryDeg: hipDiff,
      },
    };
  },

  asymmetric_press: (ctx, workoutId) => {
    const elbowDiff = Math.abs(
      ctx.minAngles.leftElbow - ctx.minAngles.rightElbow,
    );
    return {
      faultId: 'asymmetric_press',
      workoutId,
      repNumber: ctx.repNumber,
      title: 'Pressing unevenly',
      rationale:
        `Elbow depth diverged by ${fmtDeg(elbowDiff)} deg between sides ` +
        `(L=${fmtDeg(ctx.minAngles.leftElbow)} deg, ` +
        `R=${fmtDeg(ctx.minAngles.rightElbow)} deg).`,
      cue: 'Press both arms together — match depth on the way down, match lockout on the way up.',
      metrics: {
        elbowAsymmetryDeg: elbowDiff,
      },
    };
  },

  hip_sag: (ctx, workoutId) => {
    const minHip = minJoint(ctx.minAngles, 'leftHip', 'rightHip');
    const sagBelowNeutral = Math.max(0, 160 - minHip);
    return {
      faultId: 'hip_sag',
      workoutId,
      repNumber: ctx.repNumber,
      title: 'Hips dropped mid-rep',
      rationale:
        `Minimum hip angle was ${fmtDeg(minHip)} deg — ${fmtDeg(sagBelowNeutral)} ` +
        `deg below a neutral plank. That breaks your rigid-body line.`,
      cue: 'Squeeze your glutes — keep your body in a straight line head to heel.',
      metrics: {
        minHipDeg: minHip,
        sagBelowNeutralDeg: sagBelowNeutral,
      },
    };
  },

  hip_shift: (ctx, workoutId) => {
    const hipDiff = Math.abs(ctx.minAngles.leftHip - ctx.minAngles.rightHip);
    const dominant = ctx.minAngles.leftHip < ctx.minAngles.rightHip
      ? 'left'
      : 'right';
    return {
      faultId: 'hip_shift',
      workoutId,
      repNumber: ctx.repNumber,
      title: 'Hips shifted sideways',
      rationale:
        `At depth your hips shifted ${fmtDeg(hipDiff)} deg toward the ` +
        `${dominant} side. Unilateral hip drop loads one knee harder ` +
        `than the other.`,
      cue: 'Stay centered — push the floor evenly with both feet.',
      metrics: {
        hipShiftDeg: hipDiff,
      },
    };
  },

  fast_rep: (ctx, workoutId) => ({
    faultId: 'fast_rep',
    workoutId,
    repNumber: ctx.repNumber,
    title: 'Too fast',
    rationale:
      `Rep lasted only ${fmtSec(ctx.durationMs)}. Under-controlled tempo ` +
      `skips time-under-tension and makes form breakdown easy to miss.`,
    cue: 'Slow the eccentric — 2-3 seconds down, then drive.',
    metrics: { durationMs: ctx.durationMs },
  }),

  fast_descent: (ctx, workoutId) => ({
    faultId: 'fast_descent',
    workoutId,
    repNumber: ctx.repNumber,
    title: 'Uncontrolled descent',
    rationale:
      `Rep completed in ${fmtSec(ctx.durationMs)} — too quick to track the ` +
      `bar path back down.`,
    cue: 'Control the eccentric — lower with intent, don\'t drop the weight.',
    metrics: { durationMs: ctx.durationMs },
  }),

  incomplete_rom: (ctx, workoutId) => {
    const minElbow = avg(ctx.minAngles.leftElbow, ctx.minAngles.rightElbow);
    return {
      faultId: 'incomplete_rom',
      workoutId,
      repNumber: ctx.repNumber,
      title: 'Short range of motion',
      rationale:
        `Elbows only reached ${fmtDeg(minElbow)} deg at the top — aim for a ` +
        `full pull so the chin clears the bar.`,
      cue: 'Pull all the way — chin over the bar, then lower with control.',
      metrics: { minElbowDeg: minElbow },
    };
  },
};

// =============================================================================
// Public API
// =============================================================================

/**
 * Generate a natural-language explanation for a detected fault.
 *
 * Returns a formatted string ready to display in a card. For richer UI
 * (metrics readouts, custom layouts), use `generateFaultExplanationDetail`
 * which returns the structured `FaultExplanation`.
 */
export function generateFaultExplanation(
  faultId: string,
  rep: RepContext,
  workoutId: string,
): string {
  const detail = generateFaultExplanationDetail(faultId, rep, workoutId);
  return renderExplanation(detail);
}

/**
 * Structured variant of `generateFaultExplanation` — returns the full
 * `FaultExplanation` object so the UI can layout title/rationale/cue
 * separately and surface raw metrics if desired.
 */
export function generateFaultExplanationDetail(
  faultId: string,
  rep: RepContext,
  workoutId: string,
): FaultExplanation {
  const builder = BUILDERS[faultId];
  if (builder) {
    return builder(rep, workoutId);
  }
  // Unknown fault — return a safe generic explanation so UI never crashes.
  return {
    faultId,
    workoutId,
    repNumber: rep.repNumber,
    title: 'Form issue detected',
    rationale:
      `A form issue ("${faultId}") was flagged on this rep, but no ` +
      `detailed rationale is available yet.`,
    cue: 'Keep an eye on your form and rewatch the set if possible.',
    metrics: {},
  };
}

/**
 * Flatten a `FaultExplanation` into a single paragraph suitable for a
 * toast or chip subtitle.
 */
export function renderExplanation(exp: FaultExplanation): string {
  return `${exp.title}. ${exp.rationale} ${exp.cue}`;
}

/**
 * List fault ids that have a dedicated explanation template. Useful for
 * admin UI / coverage reports.
 */
export function listExplainedFaultIds(): string[] {
  return Object.keys(BUILDERS).sort();
}

/**
 * True when a bespoke rationale template exists for the given fault id.
 */
export function hasExplanationFor(faultId: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUILDERS, faultId);
}
