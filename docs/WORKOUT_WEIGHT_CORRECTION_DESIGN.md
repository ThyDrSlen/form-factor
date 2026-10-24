# Historical workout-load correction: proposed decision record

Status: proposal, not approved and not implemented. Tracks FOR-8. No production rows were inspected or changed. This record authorizes neither a migration nor a correction UI.

## Evidence boundary

Inspection baseline: Git HEAD `65eb3922ca4adbaa2576faae72aa1472b040eedc`, plus the intentionally dirty working tree. Current source references below describe that working tree, not a released binary. Historical citations are specific inspected snapshots; commit dates do not establish installation dates or which writer created a production row. No affected-row count is known.

Current workout-load storage uses pounds; HealthKit body mass uses kilograms. A display preference is not source provenance. Keep every uncertain historical value unchanged. Do not infer a unit from magnitude, exercise, user locale, present preference, or matching values in another table.

## Writer and propagation matrix

| Path | Observed contract and transformation | Evidence and confidence | Remaining uncertainty |
| --- | --- | --- | --- |
| Historical native quick log | Pounds-labelled wheel; positive raw value submitted unchanged; zero became unspecified | `bf339c8b` (2026-03-18), `app/(modals)/add-workout.tsx:211,287-292`; `9559dd21` (2026-04-29), same path `:274,359-366`. Strong source evidence for those snapshots | Not proof of every older revision, release, or record; unspecified historical values cannot be reconstructed as zero |
| Current native quick log | Preferred-unit input becomes canonical pounds; context forwards `newWorkout.weight` | `docs/WORKOUT_WEIGHT_UNITS.md:21-35`, `features/workouts/components/WorkoutWeightInput.tsx`, `features/workouts/contexts/WorkoutsContext.tsx:188-192`, `lib/workouts/weight.ts`. Current source contract, with FOR-5 verifying behavior | Current implementation does not establish old row provenance |
| Web quick log at HEAD, before FOR-13 | UI labels input `Weight (lbs)`; server parses the raw value into session-set `actual_weight` without conversion | `apps/web/app/(app)/workouts/add/page.tsx:197`; HEAD `apps/web/lib/actions.ts:66-119`. Strong source evidence | Historical action uses `parseFloat(...) \|\| 0`, conflating blank/invalid values with zero; no old row is corrected by changing the writer |
| Web quick log after local FOR-13 fix | Pounds-only server input preserves null/zero/decimal values and rejects malformed or nonfinite loads before writes | Current `apps/web/lib/actions.ts`, `tests/unit/web/workout-actions-weight.test.ts`; 18 tests pass after RED reproduction, web no-emit types and scoped lint pass | Local uncommitted fix, not deployed; default UI input remains explicit zero; no historical correction or unit-preference UI added |
| Template builder | Explicit `lb` input parsed into `target_weight`, saved unchanged | `bebf40e8` (2026-04-20), `app/(modals)/template-builder.tsx:265,498-513`; current file retains this path. Strong source evidence | No original-input-unit metadata; copied/generated templates need independent origin evidence |
| Session materialization/copy | Template `target_weight` is copied into planned and actual loads; actual-versus-planned fallback uses nullish selection | `lib/stores/session-runner.ts`, template materialization assignments to `planned_weight`/`actual_weight`, copy paths and `completeSet`. Source evidence of propagation, not original units | A template's uncertainty propagates; current auth work may shift line numbers |
| Server legacy migration 029 | Copies `workouts.weight` directly to session `actual_weight`; reuses workout ID as session ID | `d62a2bf5` (2026-02-14), `supabase/migrations/029_migrate_legacy_workouts.sql:12-28,49-71`; current SQL agrees. Strong evidence of unchanged numeric copy | Migration does not establish whether source number was pounds; no proof it ran for a specific row |
| Local legacy migration | `w.weight ?? null` copied unchanged; generated set ID, session notes `__legacy_migration__` | `lib/services/database/local-db.ts:1540-1596`. Source evidence; no execution during this audit | Marker and ID linkage are candidate lineage evidence, not proof of source units or permission to update both records |
| Local storage/history | REAL load columns; history selects actual load unchanged | `lib/services/database/local-db.ts:319,381-384`; `lib/services/workout-session-history.ts:34,58`. Source evidence | Schema has no per-load unit provenance; history rendering cannot repair it |
| Sync | Legacy payload forwards weight; structured set/template allowlists include numeric load fields, without source-unit discriminator | `lib/services/database/sync-service.ts:693,1065,1549`; `lib/services/database/generic-sync.ts:651-677`. Source evidence of transport contract | Current sync is not a correction-specific conflict/operation protocol |
| External/manual import | Unknown | No dedicated workout/session/template import API was located by scoped searches of `lib`; not an exhaustive audit of external writers | Manual SQL, import scripts, old clients and deployed versions are unverified. Require actual source evidence before eligibility |

`docs/WORKOUT_DOMAIN.md` and the current FOR-8 description state the current pounds contract. Historical ambiguity concerns provenance, not the current declared unit.

## Proposed first release and approval questions

Recommended conservative scope, pending Fabrizio's approval:

1. Selected completed structured-session **actual loads only**, with known ownership and specific evidence of kilogram-origin input. Keep planned loads, templates, quick logs, derived duplicates and body mass out of the first write path.
2. Require source/version/import evidence tied to the selected record. User attestation can be recorded but is not sufficient by default. Unknown records remain view-only. Whether attestation alone may authorize a single-record correction is an explicit product decision.
3. Permit an offline read-only preview with a clear stale-data warning; require online authoritative ownership and conflict validation for confirmation. Never queue an offline correction to apply later.
4. Correct one selected record or an explicitly enumerated atomic selection, never all similar records. Do not automatically propagate a correction across migration-linked quick logs/session rows. Surface the possible linkage and require a separate approved policy.
5. Fail closed on any conflict. Do not use last-write-wins. Undo is a new, validated operation, not deletion of audit history.

Approver: not yet recorded. Approval must resolve record types, evidence threshold, online/offline policy and linked-record handling before implementation. FOR-7 auth-lifetime safeguards and a correction-specific server conflict protocol are prerequisites, not satisfied merely by this document.

## Proposed record contract (not existing schema)

A correction operation would contain:

- Stable operation ID, initiating owner and authenticated lifetime; supported entity kind, record ID, field name and resolved ownership chain.
- Exact original stored number or null and authoritative revision; evidence kind/reference, original claimed unit and explicit user acknowledgment.
- Exact new canonical pounds, conversion rule/version, confirmation time and actor. Store original and result, not only a conversion factor or display string.
- Commit outcome/revision and optional `reversesOperationId`; append-only audit linkage and uniqueness for owner plus operation ID.

A database transaction must compare owner, record identity, field value and revision, then atomically write the correction plus audit/idempotency result. `updated_at` timestamps alone are insufficient if same-timestamp edits are possible; choose a server-maintained revision/CAS contract before implementation. Child set ownership must be resolved through exercise/session, not trusted from client input. Do not add this schema as part of FOR-8's design deliverable.

## State and failure semantics

Preview: read the selected owned record and source evidence, retain raw original/revision, calculate a proposed result, and show original raw value, claimed source unit, canonical pounds and preferred display separately. No writes, sync work, hidden normalization or current-preference-based guessing. Null remains unspecified; explicit zero remains zero. Nonfinite/negative values are ineligible, not silently clamped.

Cancel: destroy the local preview and any consent. Zero writes. Changing record, owner or evidence invalidates confirmation; changing display units only reformats the preview.

Confirm: explicitly acknowledge kilogram origin and exact selection; bind a synchronous in-flight guard and durable operation ID to that preview. Validate initiating auth lifetime before requests and before publication. A→B→A invalidates an A preview despite matching final account ID. Never retarget it to the new session/account.

Commit: authoritative transaction checks ownership/revision/value and uniqueness, converts from original kilograms once using the versioned rule, writes canonical pounds and audit atomically. A successful commit before a later account transition remains committed; suppress stale local publication rather than pretending it rolled back. A timeout means unknown outcome: query the same operation ID before allowing another submission. Repeated same-ID submissions return the committed result; changed payload with the same ID is rejected.

Retry ordering: authenticate and authorize access to the operation, then compare its immutable request payload. A matching committed operation-ID replay returns its recorded result before applying fresh-operation revision/already-corrected checks. A changed payload with the same ID is rejected. This must not expose another owner's operation or authorize a new write.

Conflict/reconnect: for a fresh operation, reject missing, deleted, unowned, revised or already-corrected records. Refresh and rebuild an explicit preview; never silently rebase consent. Existing generic sync must not overwrite the confirmed correction with an older offline value. This requires a designed server revision/tombstone interaction before enabling writes, not just a new local queue item.

Undo: resolve the original operation and its exact recorded preimage. Permit restoration only if current owner, value and revision still match the original correction's resulting state and no reversal exists. Restore the stored original, not division of rounded display text. Later edits, deletion or ownership loss block undo and require explicit conflict resolution. A reversal itself has a durable unique operation ID and audit row.

Export/history: unchanged until a separately versioned compatibility decision. Do not retrofit provenance into old exports by assertion. Derived volume/charts may change after an approved correction; identify the originating operation. Never touch HealthKit body mass.

## Fixture-driven acceptance plan (not executed product tests)

Use isolated owned synthetic rows, no production data. Arithmetic below was computed locally with the existing factor 2.20462. Future tests must specify an explicit floating-point tolerance rather than use display rounding.

| Fixture | Input/evidence | Expected proposed behavior |
| --- | --- | --- |
| Pounds | raw 20, specific pounds provenance | No conversion, remains 20 lb |
| Kilograms | raw 20, specific kg-origin evidence | Eligible preview of 44.0924 lb; no write until explicit confirmation |
| Unknown | raw 20, no provenance | Ineligible, unchanged despite same magnitude as above |
| Preference only | raw 20, current preference kg | Ineligible; preference is not evidence |
| Null | raw null | Unspecified, no numeric conversion |
| Explicit zero | raw 0, kg-origin evidence | Remains exactly 0, never replaced by planned load; no needless numeric correction |
| Decimal | raw 12.375, kg-origin evidence | Proposed 27.2821725 lb, no persistence rounding |
| Invalid | NaN, infinity, negative, malformed number | Reject without writes |
| Cancel | eligible preview then cancel | Original row/audit/sync unchanged |
| Repeat | confirm same operation twice; timeout then retry same ID | One correction/audit result, never multiply again |
| Payload collision | same operation ID, changed record/value | Reject |
| Concurrent edit | revision changes after preview, including same numeric value | Reject stale consent, no overwrite |
| Undo | original successful correction with unchanged resulting revision | Exact preimage restored once; audit retained |
| Undo conflict | subsequent edit, deletion, second undo | Reject; do not approximate inverse |
| Offline | offline preview or network loss during confirmation | Preview only or unknown outcome requiring operation lookup; no delayed queue replay |
| Account lifetime | A→B, A→sign-out, A→B→A while preview/request pending | No cross-account write/publication; legitimate prior commit remains auditable |
| Linked copy | quick log and migration-derived session share origin | No automatic two-record correction or deduplication |
| Body mass | HealthKit kg sample beside workout fixture | Unchanged |

Future verification must exercise the real transaction and sync conflict path, not only a pure arithmetic helper. Tests of the current workout inputs are baseline contract evidence, not evidence that this proposed correction flow exists. Device UI acceptance belongs to a later explicitly authorized implementation.

## Next gate

Review the four product decisions above with Fabrizio. Once approved, create bounded implementation tasks for server revision/idempotency, owner/lifetime integration, explicit preview UI and sync/undo conflict tests. Until then there is no correction endpoint, UI, migration, background conversion or authorization to change historical data.
