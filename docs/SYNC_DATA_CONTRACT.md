# Sync data contract

Native storage uses SQLite. Web storage currently supports the legacy food, workout, health-metric and nutrition-goal models in localStorage; workout-session storage remains native-only. `supportsWorkoutSync` prevents the web sync service from invoking SQLite-only uploads, downloads or realtime subscriptions. Web storage failures propagate, and failed queue acknowledgements restore the prior localStorage values.

`lib/services/database/sync-types.ts` owns the queue table names and operations for both storage implementations. `WORKOUT_SYNC_CONFIGS` defines remote columns, ownership, boolean conversion and event serialization. Both initial workout uploads and queued retries call `syncWorkoutRowToSupabase`.

- Exercises use `created_by`; only workout templates and sessions have `user_id`. Child rows inherit access through their parent relationships.
- Offline system exercises use temporary `seed-*` IDs. Before uploading sessions, match each seed by name and category to exactly one server catalog entry. Update template/session exercise references and retire the seed and its retry inside a local transaction. Missing or ambiguous matches fail without deleting the offline data.
- Session events have `created_at`, not `updated_at`. Their payload is JSON text locally and JSONB remotely. Retries ignore duplicate event IDs rather than update an append-only event.
- Queued workout retries read the current local row, skip already-synced rows, and use the same last-write-wins behavior as initial uploads. A newer server row is applied locally.
- Permission failures retain local data and schedule retries. Explicit account-mismatch cleanup remains separate.
- Downloads fetch pages in primary-key order. A missing row in a listing is not a deletion signal: changed permissions or concurrent writes can also hide rows. Explicit realtime deletes and acknowledged local tombstones handle deletion. Deletions missed while offline need a future server tombstone protocol.

The checked-in Supabase migrations (026–028) are the schema reference. These changes do not apply remote migrations, verify the deployed database, or recover records that older clients already deleted. Verify the catalog and exercise/session permissions against the target environment before claiming an end-to-end deployment check.
