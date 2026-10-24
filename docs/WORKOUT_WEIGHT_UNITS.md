# Workout weight contract

## Canonical storage: pounds (lb)

`workouts.weight`, `workout_session_sets.planned_weight`,
`workout_session_sets.actual_weight`, and template `target_weight` are pounds.
The user's kg/lbs preference changes input and presentation, not persistence.
`null`/missing means unspecified; `0` is an explicit zero external load.

Evidence from existing writers/readers (not a new database migration):
- Native legacy Add Workout used a pounds-labeled wheel and saved its raw number.
- Web quick-log form labels its raw input `Weight (lbs)`.
- Session SetRow labeled raw input `Lb`; template builder labels its input `lb`.
- The session runner copies template/planned/actual weights without conversion.
- Migration 029 copies legacy `w.weight` to session `actual_weight` unchanged.
- Web session details explicitly label stored weights `lbs`.
- Numeric schema columns have no per-row unit/provenance discriminator.

## Boundaries

- `lib/workouts/weight.ts` converts pounds to preferred display units and preferred
  input units back to pounds, using 2.20462 pounds per kilogram.
- Native quick log and session SetRow use `WorkoutWeightInput`. Valid decimal
  edits write canonical pounds immediately, including zero; blank is unspecified.
  Decimal commas are accepted. Invalid/negative input is rejected.
- Quick log now uses a decimal keypad rather than snapping weight to five-pound
  wheel increments. Sets/reps retain their existing wheels.
- Canonical drafts survive preference changes, including asynchronous preference
  hydration. Unit switches re-render the value without writing rounded text back.
- Quick-log cards, detail alerts and shared summaries convert the value and label
  together. Presentation rounds to at most two decimal places; persistence does not.
- Existing session-history conversion already divides pounds to kg before calling
  `UnitsContext.convertWeight`; it remains correct (one-decimal display).
- Template builder and web inputs remain explicitly pounds-only; they are not
  relabeled with the mobile preference.
- **Do not change `UnitsContext.convertWeight` to accept pounds.** It accepts kg
  for HealthKit body mass and its other existing consumers. Workout loads and body
  mass have different persisted contracts.

## Historical ambiguity / deliberately excluded

No data, migrations, native code, environment or dependencies are changed.
Old rows have no unit metadata. External imports, older clients or manual writes
could have stored kg, but magnitude alone cannot distinguish those rows safely.
This implementation interprets existing rows according to the evidenced pounds
contract; it does not guess, bulk-convert or claim historical provenance is known.
Repairing known kg rows requires source/version evidence and an explicitly scoped
migration or user-confirmed correction. Raw session exports retain their existing
schema and canonical numeric values.

## Verification

Jest screen regressions cover kg quick-log save, a unit switch before save, explicit
zero, card/detail/share conversion, session planned/actual loads, decimal input and
switches while focused. Existing UnitsContext and session-history tests protect
HealthKit's kg conversion and the existing pounds-to-display history boundary.
