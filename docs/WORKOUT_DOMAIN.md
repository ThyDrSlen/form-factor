# Workout domain and user-facing language

## Canonical hierarchy

A **workout session** is one training visit. The UI calls this a **workout**. A session contains ordered **session exercises**, each of which contains **sets**.

```text
WorkoutSession (one visit)
  └─ SessionExercise (one movement occurrence in that visit)
       ├─ exercise_id → Exercise (reusable catalog definition)
       └─ WorkoutSessionSet (one planned/performed effort)
```

- `workout_sessions`: identity, user ownership, start/end, name, goal and notes for the visit.
- `exercises`: reusable movement metadata. Bench press in two visits refers to the same catalog exercise but different session-exercise records.
- `workout_session_exercises`: the occurrence and ordering of a catalog exercise within a session. Sets belong to this occurrence, not directly to the catalog exercise.
- `workout_session_sets`: planned and actual reps, duration and load; set type; completion and rest metadata.
- Templates prescribe future activity. Materializing a template creates session-specific records; a template is not evidence of completed work.

## Planned versus performed

A planned set does not count as completed until `completed_at` is present. On explicit completion, the runner commits the displayed planned reps/time/load when the corresponding actual value is null. An explicitly entered zero is preserved, not replaced by the plan. Missing actual and planned values remain missing, not fabricated zero values.

Completion writes actual values and completion metadata in the same SQLite UPDATE. TUT and the `set_completed` event use the resolved actual values. A rejected database write must not mark the set completed in in-memory state.

Historical counts exclude soft-deleted rows and unfinished sets. A completed exercise count means an occurrence with at least one completed set, not merely an exercise added to the plan. An ended session may legitimately contain no completed sets and must be displayed honestly.

## Read models and ownership

`lib/services/workout-session-history.ts` provides completed session summaries and details. Native SQLite persists a nullable `workout_sessions.user_id`; initialization adds the column to older databases without assigning owners to legacy rows. Summary and detail queries filter by the requested owner, exclude deleted and unfinished sessions, and do not require a server ownership allowlist. Known-owned local sessions can therefore be read offline; rows with unknown ownership remain unclaimed and inaccessible through these owner-scoped queries. These predicates do not establish complete account-switch safety across asynchronous mutations, sync or other data domains; those boundaries need their own guards and verification. Unsupported web storage is explicit; it must not masquerade as an empty mobile history.

The legacy `workouts` table represents quick logs, not these structured session records. Keep those entries visibly separate until there is an explicit migration or deduplicated projection. Never create an unlinked duplicate quick log merely to make a completed session appear in a legacy list. Dashboard consumers still using the legacy context require deliberate integration; a new history screen alone does not fix those consumers.

Workout loads use canonical pounds in quick logs, session planned/actual sets and template targets. Native quick-log and set inputs use `WorkoutWeightInput` to convert kg edits to pounds; changing the display preference does not write converted or rounded values back. Blank means unspecified and explicit zero remains zero. Workout display helpers convert the value and unit label together, while `UnitsContext.convertWeight` continues to accept kilograms for HealthKit body mass. Template and web inputs remain explicitly pounds-only. See [Workout weight contract](WORKOUT_WEIGHT_UNITS.md) for the conversion and rounding boundaries. Historical rows still lack per-row provenance: do not guess their original units, bulk-convert them, or relabel raw values as another unit. Historical correction policy is separate from the current input/storage contract.

## Flow vocabulary

- **Start workout**: create a new session when none is active.
- **Resume workout**: reopen the existing session without creating another.
- **Add exercise**: add a session-exercise occurrence.
- **Log set / Complete set**: record an effort.
- **Finish workout**: persist the end of the visit, then offer review of the saved session.
- **Workout history**: completed visits and their actual completed exercises/sets.
- **Quick log**: explicitly separate historical entry.

Do not call an individual bench-press occurrence a separate workout. Do not infer a post-workout summary from an active session after the runner has cleared it; load by saved session ID or retain a completed snapshot.

## Form tracking is a separate identity domain

A form scan is measurement data, not automatically a workout session. Current scan IDs and runner IDs are independently generated. Passing a runner ID to form-recovery lookup does not establish an association.

A future scan integration needs an explicit association to the relevant workout session, session exercise and, when known, set, while retaining the scan's own identity. Until that persistence and ingestion path is implemented and verified, workout history must show recorded workout details instead of promising linked form recovery. No scan linkage migration is implied by this document.

## Verification boundaries

Store and history regression tests establish targeted persistence/read-model behavior. They do not establish Supabase round-trip sync, native ARKit ingestion, HealthKit correctness, or device-level visual quality. Those require separate integration/device verification.
