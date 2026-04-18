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
  "Keep knees soft but fixed — this isn't a squat.": [
    'Soft knees, fixed angle — hinge from the hips.',
    'Knees stay soft, hips do the work.',
    'Lock the knee bend — drive from the hips.',
  ],

  // ---- Pull-up ----
  'Fully extend your arms before the next rep.': [
    'Drop to full hang between reps.',
    'Straighten the arms fully at the bottom.',
    'Full extension before pulling again.',
  ],
  'Pull higher to bring your chin past the bar.': [
    'Chin clears the bar on every rep.',
    'Pull until the chin is over the bar.',
    'Higher — get the chin past the bar.',
  ],
  'Draw your shoulders down to keep your lats engaged.': [
    'Pull shoulders down away from the ears.',
    'Pack the shoulders — lats stay engaged.',
    'Shoulders down first, then pull.',
  ],
  'Strong reps — keep the descent smooth.': [
    'Strong pull, controlled descent.',
    'Own the lower — no dropping.',
    'Smooth on the way down, strong on the way up.',
  ],

  // ---- Dead hang ----
  'Straighten your arms for a true dead hang.': [
    'Arms fully extended — let the bar carry you.',
    'Relax the elbows — pure hang.',
    'Fully straight arms for a clean hang.',
  ],
  'Pack shoulders down away from your ears.': [
    'Shoulders away from the ears — pack them down.',
    'Depress the shoulders, long neck.',
    'Pull shoulders down — stop shrugging.',
  ],
  'Stay tall — breathe and hold steady.': [
    'Long body, steady breath.',
    'Hold tall, breathe through the hang.',
    'Stay long — exhale slowly.',
  ],

  // ---- Farmer's walk ----
  'Keep shoulders level — balance the load.': [
    'Level shoulders — even load side to side.',
    'Shoulders square — balance the weights.',
    'Keep both shoulders at the same height.',
  ],
  "Stay centered — don't lean to one side.": [
    'Hips centered — no side lean.',
    'Stack over the hips — stay tall.',
    'Center of mass straight — no leaning.',
  ],
  "Stand tall — don't hunch forward.": [
    'Chest up, shoulders back.',
    'Tall spine — no forward hunch.',
    'Stand proud — open the chest.',
  ],
  'Strong posture — own every step.': [
    'Proud chest, steady steps.',
    'Carry tall — step with intent.',
    'Own the walk — tight posture, each step.',
  ],
  'Brace your core, grip tight.': [
    'Tight core, crushing grip.',
    'Brace the midsection — grip the handles hard.',
    'Core locked, hands crushing the load.',
  ],

  // ---- Lat pulldown ----
  'Elbows in — drive them down, not out.': [
    'Drive elbows down and keep them tucked.',
    'Tuck the elbows and drive to the ribs.',
  ],
  'Let the arms extend fully — feel the stretch.': [
    'Full stretch at the top before pulling.',
    'Reach long at the top and feel the stretch.',
  ],
  'Smooth pull — lats lead, no swinging.': [
    'Lead with the lats, no body swing.',
    'Pull with the lats and keep the torso quiet.',
  ],

  // ---- Dumbbell curl ----
  'Stop swinging — hips stay locked.': [
    'Lock the hips and kill the swing.',
    'Still hips, strict curl.',
  ],
  'Squeeze all the way up — full biceps contraction.': [
    'Curl higher and squeeze the biceps hard.',
    'Top squeeze — crush the curl.',
  ],
  'Slow tempo — elbows pinned, control the descent.': [
    'Pin the elbows and lower with control.',
    'Keep elbows pinned and lower slower.',
  ],

  // ---- Hip thrust ----
  'Ribs down — finish with the glutes, not the lower back.': [
    'Keep ribs down and squeeze the glutes.',
    'Brace the ribs and finish with glutes.',
  ],
  'Drive higher — aim for full hip extension.': [
    'Drive through to full hip lockout.',
    'Lift higher until the hips fully lock.',
  ],
  'Controlled tempo — squeeze at the top.': [
    'Control the rep and pause at lockout.',
    'Steady rep — squeeze at the top.',
  ],

  // ---- Lunge / Bulgarian split squat ----
  'Drop deeper — front thigh parallel to the floor.': [
    'Sink deeper until the front thigh is parallel.',
    'Go lower until the front thigh is level.',
  ],
  'Ease off — keep the front knee stacked over the ankle.': [
    'Reduce the push and stack the knee.',
    'Back off and stack the knee over the ankle.',
  ],
  'Reset your stance, breathe, then repeat.': [
    'Reset the stance, breathe, then go again.',
    'Rebuild the stance, breathe, repeat.',
  ],
  'Shift weight back — keep the front shin vertical.': [
    'Sit back and keep the front shin stacked.',
    'Move back into the heel and stack the shin.',
  ],
  'Sit into the front leg — stay tall through the hips.': [
    'Load the front leg and stay tall.',
    'Sink into the front leg and keep hips tall.',
  ],

  // ---- Barbell row ----
  'Tuck elbows down — pull to the lower ribs.': [
    'Keep elbows tucked and row to the ribs.',
    'Drive elbows down and row low.',
  ],
  'Stay hinged — resist the urge to stand up.': [
    'Hold the hinge and resist standing tall.',
    'Keep the hinge and fight the urge to rise.',
  ],
  'Smooth pull — squeeze the shoulder blades at the top.': [
    'Pull smooth and pinch the shoulder blades.',
    'Row smooth and squeeze the upper back.',
  ],

  // ---- Overhead press ----
  'Ribs down — stop arching the lower back.': [
    'Stack the ribs and stop the back arch.',
    'Keep ribs tucked and press without arching.',
  ],
  'Punch through — arms straight at the top.': [
    'Punch overhead until the elbows lock.',
    'Finish tall and lock the arms overhead.',
  ],
  'Brace hard — vertical bar path, stay stacked.': [
    'Brace hard and keep the bar vertical.',
    'Stay braced and keep the bar stacked.',
  ],
};
