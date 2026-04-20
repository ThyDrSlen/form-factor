/**
 * coach-few-shots
 *
 * Fault-indexed in-context example library. When the context enricher
 * detects a matching fault id (e.g. `squat-knee-cave`, `pullup-kip`) we
 * append 1-2 short Q/A pairs to the system prompt so Gemma stays in
 * distribution.
 *
 * Design
 *   - Pure look-up. Zero I/O. Returns an empty array for unknown faults
 *     (no throws, no warnings — callers should treat that as "no
 *     examples available").
 *   - Example answers are deliberately short (under 60 words) and
 *     match the coach style guide from PR #431 (buildPrompt): concise,
 *     actionable, safe, one to two options max.
 *   - Keys are slug-like (lowercase, hyphenated). The call site is
 *     expected to harden the fault id via coach-injection-hardener
 *     before looking it up.
 *
 * Integration site
 *   - coach-context-enricher (PR #431) detects a fault intent. When it
 *     does, append the results of getFewShotsForFault() to the system
 *     prompt as `Example Q/A:` blocks. That call-site edit lives on
 *     the PR #431 branch — this module only owns the library.
 *   - supabase/functions/coach/index.ts duplicates the minimal slug
 *     library inline since the edge function runs Deno and cannot
 *     import from @/lib.
 */

export interface FewShotExample {
  userQuestion: string;
  coachAnswer: string;
}

const LIBRARY: Record<string, FewShotExample[]> = {
  // -------- PULLUP FAULTS --------
  'pullup-kip': [
    {
      userQuestion: 'My pull-ups swing a lot. How do I stop kipping?',
      coachAnswer:
        'Start from a dead hang with shoulders pulled down and back. Squeeze your glutes and brace your core so your legs stay quiet. Pull with elbows driving to your ribs for 5 slow reps, rest 2 minutes, repeat for 3 sets.',
    },
    {
      userQuestion: 'Why do I swing forward on every rep?',
      coachAnswer:
        'Set a hollow body position: rib cage down, pelvis tucked, toes pointed forward. Pause 1 second at the top and lower for 3 seconds. 3 sets of 5 strict reps will train the control you need.',
    },
  ],
  'pullup-partial-rom': [
    {
      userQuestion: 'Am I going high enough on my pull-ups?',
      coachAnswer:
        'Aim to clear your chin above the bar and return to a full dead hang each rep. If you cannot get chin-over, switch to band-assisted or negatives (3 sets of 5 slow descents) for two weeks.',
    },
  ],

  // -------- SQUAT FAULTS --------
  'squat-knee-cave': [
    {
      userQuestion: 'My knees cave inward when I squat heavy. What do I do?',
      coachAnswer:
        'Cue "spread the floor" by pushing your feet outward without letting them move. Warm up with banded squats (mini band above knees, 2 sets of 12) and drop working weight by 10% this week until the cave disappears.',
    },
    {
      userQuestion: 'Knees buckle at the bottom of my squat — help?',
      coachAnswer:
        'Widen your stance slightly and turn your toes out about 15 degrees. Add pause squats (3-second pause in the hole) at 65% for 3 sets of 5 to rebuild the bottom position.',
    },
  ],
  'squat-butt-wink': [
    {
      userQuestion: 'I get butt wink at the bottom. How do I fix it?',
      coachAnswer:
        'Stop going below the point where your pelvis tucks. Squat to a box set just above that depth for 3 sets of 6. Add hip mobility work (90/90 and deep lunge stretch, 2 minutes each side) on off days.',
    },
  ],
  'squat-forward-lean': [
    {
      userQuestion: 'I lean forward a lot when I squat. Is that bad?',
      coachAnswer:
        'Some lean is normal, but a sharp forward dump usually means weak quads or an ankle restriction. Add front squats (3 sets of 5 at 60%) and calf stretches daily for two weeks.',
    },
  ],

  // -------- DEADLIFT FAULTS --------
  'deadlift-rounded-back': [
    {
      userQuestion: 'My lower back rounds when I pull. How do I lock it in?',
      coachAnswer:
        'Before the pull, take a big belly breath and wedge yourself between the bar and the floor so your lats are engaged. Drop 15% off your working weight and do 3 sets of 5 focused reps.',
    },
    {
      userQuestion: 'Back rounds on heavy singles. Should I stop?',
      coachAnswer:
        'Yes — stop the heavy work and build tension with Romanian deadlifts and paused deadlifts at 60% (4 sets of 5) for two weeks. Return to heavier pulls only when the back stays flat.',
    },
  ],
  'deadlift-hip-rise-first': [
    {
      userQuestion: 'My hips shoot up before the bar moves. What is that?',
      coachAnswer:
        'That is usually weak quads or a misplaced start position. Place the bar slightly closer to your shins and push the floor away with your legs. Add pause deadlifts 1 inch off the floor (3 sets of 5).',
    },
  ],

  // -------- BENCH PRESS FAULTS --------
  'bench-elbow-flare': [
    {
      userQuestion: 'My elbows flare way out on bench. Safer options?',
      coachAnswer:
        'Tuck your elbows to roughly 45 degrees from your torso and point your knuckles at the ceiling. Warm up with dumbbell bench (3 sets of 8) to groove the path before your working sets.',
    },
  ],
  'bench-bar-path-uneven': [
    {
      userQuestion: 'My bar wobbles on the way up. How do I make it straight?',
      coachAnswer:
        'Reset your grip so your wrists are stacked over your elbows. Use the mirror or a phone video for 3 warm-up sets of 5 at 50% and focus on touching the same spot on your chest each rep.',
    },
  ],

  // -------- PUSHUP FAULTS --------
  'pushup-hip-sag': [
    {
      userQuestion: 'My hips drop on push-ups. How do I keep a straight line?',
      coachAnswer:
        'Before you push, squeeze your glutes and brace your core like you are about to be punched. Do plank holds (3 sets of 30 seconds) before your push-up sets until the sag goes away.',
    },
    {
      userQuestion: 'Push-up hips sag halfway through the set — fix?',
      coachAnswer:
        'Drop to knee push-ups or incline push-ups for the last reps of each set to keep form clean. 3 sets of 8-12 reps with the harder variation and switch when form breaks.',
    },
  ],
  'pushup-shallow-depth': [
    {
      userQuestion: 'I only go halfway down on push-ups. Does depth matter?',
      coachAnswer:
        'Yes — bring your chest within a fist-width of the ground each rep for full range. If that is too hard, use an incline (hands on a sturdy chair) so you can hit full depth for 3 sets of 8.',
    },
  ],

  // -------- GENERAL --------
  'general-bar-speed-drop': [
    {
      userQuestion: 'My bar speed drops to a crawl by my last set. What now?',
      coachAnswer:
        'That is a sign you are at or past RPE 9 — stop the set. Cut your working weight by 10% next session or drop one set. Make sure you slept at least 7 hours before your next heavy day.',
    },
  ],
  'general-rep-inconsistency': [
    {
      userQuestion: 'Some reps look clean and others look sloppy. How to make them all good?',
      coachAnswer:
        'Drop weight by 10% and do tempo reps (3 seconds down, 1 second pause, 1 second up) for 3 sets of 6. When every rep looks the same, add weight back in 5-pound increments.',
    },
  ],
};

const DEFAULT_COUNT = 2;

/**
 * Return up to `count` few-shot examples for the given fault id.
 * Returns an empty array for unknown ids (no throw, no warn).
 */
export function getFewShotsForFault(
  faultId: string,
  count: number = DEFAULT_COUNT
): FewShotExample[] {
  if (typeof faultId !== 'string' || faultId.length === 0) return [];
  const normalized = faultId.trim().toLowerCase();
  const examples = LIBRARY[normalized];
  if (!examples) return [];
  const safeCount = Math.max(0, Math.min(count, examples.length));
  return examples.slice(0, safeCount);
}

/** Returns the full list of fault ids the library covers. Testing aid. */
export function listKnownFaultIds(): string[] {
  return Object.keys(LIBRARY).sort();
}
