/**
 * Authored rotation variants for high-frequency realtime cues.
 *
 * Keys MUST match the exact base strings returned by
 * `lib/workouts/*.ts > getRealtimeCues`. Mismatch = silent fallthrough
 * (the rotator returns the input unchanged), so a typo costs variety
 * but never breaks output.
 *
 * Variant authoring rules:
 *  - ≤ 3 variants per base (enough to break repetition, not so many
 *    that users lose the "oh this is the hip-sag cue" anchor).
 *  - Each variant is ≤ 8 words and action-first.
 *  - No exclamation points — the TTS reads them flat.
 */

import type { CueVariantMap } from './cue-rotator';

export const CUE_ROTATION_VARIANTS: CueVariantMap = {
  // ---- Push-up ----
  'Squeeze glutes to stop hip sag.': [
    'Squeeze glutes — keep the plank straight.',
    'Lock your glutes in, stop the hips dropping.',
    'Drive glutes tight, hold the straight line.',
  ],
  'Start from a full lockout to count clean reps.': [
    'Lock the elbows fully before the next rep.',
    'Top out each rep at full extension.',
    'Full lockout between reps for clean counts.',
  ],
  'Lower deeper until elbows hit ~90°.': [
    'Lower until elbows bend to ninety.',
    'Deeper — let the elbows hit ninety degrees.',
    'Chest closer to the floor, elbows to ninety.',
  ],
  'Smooth tempo — steady down, strong press up.': [
    'Control the descent, press hard on the way up.',
    'Steady lower, strong press — keep it smooth.',
    'Smooth down, push back up.',
  ],

  // ---- Squat ----
  'Stand all the way up between reps.': [
    'Lock out standing between every rep.',
    'Finish tall at the top of each rep.',
    'Fully stand before the next rep.',
  ],
  'Squat deeper — aim for hip crease below knees.': [
    'Go deeper — hip crease below the knees.',
    'Push the hips down past knee height.',
    'Sink lower to hit full depth.',
  ],
  'Controlled tempo — own every inch of the movement.': [
    'Control the descent — own every inch.',
    'Slow and deliberate through the full range.',
    'Steady tempo on the way down and up.',
  ],

  // ---- Deadlift ----
  'Finish each rep with full hip extension.': [
    'Lock the hips out at the top.',
    'Stand fully tall, glutes squeezed at the top.',
    'Drive the hips through to finish the rep.',
  ],
  'Push the floor away, keep your chest up.': [
    'Drive the floor down, chest stays proud.',
    'Chest up as you press the floor away.',
    'Chest tall, push through the feet.',
  ],
  'Controlled power — brace and drive.': [
    'Brace the core, drive with intent.',
    'Set the brace, then pull with power.',
    'Tight brace, smooth pull.',
  ],

  // ---- RDL ----
  'Hinge deeper — feel the hamstring stretch.': [
    'Push the hips back further for the stretch.',
    'Hinge until the hamstrings feel loaded.',
    'Deeper hinge — chase the hamstring stretch.',
  ],
  'Smooth hinge — push hips back, chest proud.': [
    'Hips back, chest up, smooth on the way down.',
    'Drive the hips back — keep the chest proud.',
    'Controlled hinge: hips back, chest forward.',
  ],
};
