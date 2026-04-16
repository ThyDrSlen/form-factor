/**
 * coach-cache
 *
 * Canned response cache for the coach. Serves a short, safe tip in under a
 * millisecond when the device is offline, the on-device model is still cold,
 * or we want to short-circuit network round-trips for the most common fault
 * queries.
 *
 * Design
 *   - Pure look-up, no I/O, no state between calls.
 *   - Returns null for unknown keys (no throw). The caller decides whether
 *     to fall back to the generic getOfflineFallback().
 *   - Gated on EXPO_PUBLIC_COACH_CACHE — callers read the flag themselves.
 *
 * Integration
 *   - coach-service.sendCoachPrompt() checks for a cache hit before the
 *     network call when the flag is on.
 *   - When the network fails entirely we still return the generic offline
 *     fallback so the UI never shows a raw error for the most common flows.
 */

export interface CannedTip {
  text: string;
}

/**
 * Keyed by fault id OR exercise slug. We keep both families in one map
 * because the caller may only know the exercise (e.g. first-time user
 * asks "how do I do a squat?").
 */
const TIP_LIBRARY: Record<string, string> = {
  // -------- PULLUP --------
  'pullup-kip':
    'Start from a dead hang, pull your shoulders down and back, then drive elbows to your ribs. 3 sets of 5 strict reps with a 2-minute rest.',
  'pullup-partial-rom':
    'Aim for chin over the bar and a full dead hang each rep. If you cannot yet, switch to band-assisted pulls or slow negatives for two weeks.',
  pullup:
    'Grip just outside shoulder-width, hang with shoulders engaged, and pull so your chin clears the bar. 3 sets to a few reps short of failure.',

  // -------- SQUAT --------
  'squat-knee-cave':
    'Cue "spread the floor" and push your feet outward without moving them. Warm up with banded squats and drop working weight 10% this week.',
  'squat-butt-wink':
    'Stop going past the depth where your pelvis tucks under. Box-squat just above that point for 3x6 and add hip mobility work on off days.',
  'squat-forward-lean':
    'Add front squats (3x5 at 60%) and ankle/calf mobility daily for two weeks. Drive knees forward and chest up out of the hole.',
  squat:
    'Feet shoulder-width, toes slightly out. Brace your core, squat as low as you can with a neutral back, and drive through your heels.',

  // -------- DEADLIFT --------
  'deadlift-rounded-back':
    'Before the pull, take a big belly breath and wedge between bar and floor. Drop 15% off your working weight and do 3x5 focused reps.',
  'deadlift-hip-rise-first':
    'Move the bar slightly closer to your shins and push the floor away with your legs. Add 1-inch-off-the-floor paused deadlifts, 3x5.',
  deadlift:
    'Bar over mid-foot, hips back, shoulders over or just ahead of the bar. Brace hard and stand up in one smooth motion.',

  // -------- BENCH --------
  'bench-elbow-flare':
    'Tuck elbows to about 45 degrees and stack wrists over elbows. Warm up with dumbbell bench (3x8) to groove the bar path.',
  'bench-bar-path-uneven':
    'Reset your grip so wrists are stacked over elbows. Film a side view and touch the same chest spot each rep for three warm-up sets.',
  bench:
    'Set your shoulder blades down and back, feet planted, and lower the bar with control to your sternum. Press in a slight arc back over your shoulders.',

  // -------- PUSHUP --------
  'pushup-hip-sag':
    'Squeeze your glutes and brace your core before every rep. Add 3x30-second plank holds before your push-up sets until the sag goes away.',
  'pushup-shallow-depth':
    'Lower your chest to within a fist of the ground each rep. If that is too hard, put hands on a sturdy chair and keep full range, 3x8.',
  pushup:
    'Keep a straight line from heels to head, hands under shoulders, elbows tracking at roughly 45 degrees from your torso.',

  // -------- ROW --------
  'row-elbow-flare':
    'Keep elbows close and pull to your lower ribs, not your chest. Try a chest-supported row for 3x10 to train the pattern.',
  row: 'Hinge at your hips with a flat back, pull the bar to your lower ribs, and lower with control. 3 sets of 8-10 reps.',

  // -------- GENERAL --------
  'general-rep-inconsistency':
    'Drop weight by 10% and do tempo reps (3 down, 1 pause, 1 up) for 3x6. When every rep looks the same, add weight in small increments.',
  'general-bar-speed-drop':
    'Bar speed dropping is a sign you are at or past RPE 9. Stop the set, cut 10% next time, and prioritize sleep for your next heavy day.',
};

const OFFLINE_FALLBACK: CannedTip = {
  text: "You're offline — I can't reach the live coach right now. Save your question and I'll answer as soon as you're back online.",
};

/**
 * Look up a canned tip by fault id (preferred) or exercise slug.
 * Returns null when no entry matches.
 */
export function getCachedTip(faultIdOrExercise: string): CannedTip | null {
  if (typeof faultIdOrExercise !== 'string') return null;
  const key = faultIdOrExercise.trim().toLowerCase();
  if (!key) return null;
  const text = TIP_LIBRARY[key];
  if (!text) return null;
  return { text };
}

/**
 * Generic offline fallback. Use when the user is offline and we don't have
 * a more specific cached tip.
 */
export function getOfflineFallback(): CannedTip {
  return { ...OFFLINE_FALLBACK };
}

/** Returns the full list of cached keys. Testing / tooling aid. */
export function listCachedKeys(): string[] {
  return Object.keys(TIP_LIBRARY).sort();
}
