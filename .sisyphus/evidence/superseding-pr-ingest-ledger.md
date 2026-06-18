# Superseding PR Ingest Ledger

- Branch: `review/supersede-sweep-611-616-621`
- Ingest method: deterministic `GIT_MASTER=1 git cherry-pick -x` from frozen source SHAs
- Frozen SHA stability re-check: passed for remaining PRs `#617`, `#616`, `#611`
- Outcome: every frozen commit from `#618`, `#619`, `#621`, `#620`, `#617`, `#616`, and `#611` was cherry-picked; no duplicate skips were needed

## PR #618 — `fix(coach): harden edge function with rate limiting, timeout, model validation, and type safety`

- Frozen head SHA: `9c8c7d11ab565bfef32719a05b36a13ae21a314f`
- Merge-base: `83e11b2e1702902040db55f8d0ae074167ee3773`

| Source commit | New branch commit | Status | Conflict files | Resolution summary |
| --- | --- | --- | --- | --- |
| `9c8c7d11ab565bfef32719a05b36a13ae21a314f` | `1fbeb547e9a04f1ccd901f1b342ae9335eba1259` | picked (conflicted) | `supabase/functions/coach/index.ts` | Kept existing rollout/model-dispatch, injection-hardening, and Supabase-auth flow while merging validation helper import plus stronger upstream response parsing/type checks from the frozen PR. |

## PR #619 — `feat(coach): add workout context and eval coverage`

- Frozen head SHA: `6e18f16855b0be01be0ed3bbd5bb2dcc6bfbbb3f`
- Merge-base: `92ca594f2a64ae2ca3cf52f587fbfe63bcd9bf12`

| Source commit | New branch commit | Status | Conflict files | Resolution summary |
| --- | --- | --- | --- | --- |
| `3b32cc9e9b52f14fd740b9c323ad50194f16cfa4` | `3115639313b9cbedb2ab5d65ed0b31ff2c2118b2` | picked (conflicted) | `lib/services/coach-service.ts`, `tests/unit/services/coach-service.test.ts` | Combined local workout-context enrichment with the existing memory-clause, provider-routing, and cost-tracking pipeline; preserved new workout-context tests alongside existing coverage. |
| `6e18f16855b0be01be0ed3bbd5bb2dcc6bfbbb3f` | `7f940db40ea559f4cab216b80952bccc89803bb3` | picked (conflicted) | `tests/unit/services/coach-service.test.ts` | Kept previously merged coach-service behavior and updated the test expectation to the expanded five-workout/best-performance heuristic from the frozen PR. Reconciled the stale main-branch persistence-retry expectation to the merged no-retry logging behavior. |

## PR #621 — `fix(notify): harden edge function validation and token-only rate limiting`

- Frozen head SHA: `44d1cdb2b501e18e08156a26b7ac53663dbbd3fb`
- Merge-base: `83e11b2e1702902040db55f8d0ae074167ee3773`

| Source commit | New branch commit | Status | Conflict files | Resolution summary |
| --- | --- | --- | --- | --- |
| `ebc8128ea22331e5c87c1ec54d9cce3c4f4ddea5` | `f82c743980a2cceb8470f1b12efacce8af38e612` | picked (conflicted) | `supabase/functions/notify/index.ts` | Preserved the existing 4 KB payload-size guard and merged in the new validation helper + per-recipient rate-limit enforcement from the frozen PR. |
| `44d1cdb2b501e18e08156a26b7ac53663dbbd3fb` | `80cace5129d289f517f8bb3bec7c5211422b38c7` | picked (conflicted) | `supabase/functions/notify/index.ts` | Preserved the payload-size guard while switching rate-limit application from user IDs to derived token-or-user keys for token-only sends. |

## PR #620 — `feat(notifications): add deep linking, categories, and token refresh`

- Frozen head SHA: `e3463320891c7c841144e6459df97d810cd8525a`
- Merge-base: `9559dd21df5a72eb0bdda9ae0f50c34975fe3998`

| Source commit | New branch commit | Status | Conflict files | Resolution summary |
| --- | --- | --- | --- | --- |
| `6312a04af9d7e722c56487610870edcf91671ca8` | `7762003f5ba3a88e2787e7fac4641e86884f3c46` | picked | — | Cherry-picked cleanly. |
| `d6b823a770daf607f2a12f59ca583a5f8dccd01d` | `bd92b68e0bd7ad88564c322e2faf045fe659c9e1` | picked | — | Cherry-picked cleanly. |
| `e3463320891c7c841144e6459df97d810cd8525a` | `16b9b13dd90354c5c628668c4af981f0dec12b97` | picked | — | Cherry-picked cleanly. |

## PR #617 — `feat(notifications): add workout preference types and retryable settings state`

- Frozen head SHA: `775991beacea45d5faaa64b724f40e4f34a52fa5`
- Merge-base: `9559dd21df5a72eb0bdda9ae0f50c34975fe3998`

| Source commit | New branch commit | Status | Conflict files | Resolution summary |
| --- | --- | --- | --- | --- |
| `14faf2783163e682ff45e8bb45510d3d239d0c5c` | `739165e3351845082fcf380c1b56f8daf04f615a` | picked | — | Cherry-picked cleanly. |
| `2643a3b2f7bcd56391b5d30cec38910025edddf2` | `d31cf86118e6aa0a2701e8d5c7308f631171c0a2` | picked | — | Cherry-picked cleanly. |
| `a582ec9214754e9b91ee0780a16b97eb362d6c34` | `10a5839688db1e0a9e6e47050268ffa6ea034688` | picked | — | Cherry-picked cleanly. |
| `775991beacea45d5faaa64b724f40e4f34a52fa5` | `f348419e024e00aae18b60a2a2204410832ee36a` | picked | — | Cherry-picked cleanly. |

## PR #616 — `feat(progressive-overload): add history queries, structured PR detection, and suggestions`

- Frozen head SHA: `802526be2c22411693b327fc02c03de245494670`
- Merge-base: `9559dd21df5a72eb0bdda9ae0f50c34975fe3998`

| Source commit | New branch commit | Status | Conflict files | Resolution summary |
| --- | --- | --- | --- | --- |
| `fb5ad398e1e4020a70a9ea3f2d04a0a73d9d34fe` | `06aa3e255bde3a8a4b07b13f929ec46a2d5487b5` | picked | — | Cherry-picked cleanly. |
| `f2af77ac97ac208921619067872f32c64a916133` | `e17ad067b7554fb2c7fd1dc1e825b0a193c61d10` | picked | — | Cherry-picked cleanly. |
| `62e1b9560556b68d7b361b45d7bdff809caaaad3` | `caafa8d245085fa73c7ddac66c702a6491d3d39b` | picked | — | Cherry-picked cleanly. |
| `0ee79694a096e918ac933dadd401f35648d4adea` | `d4e41ef5f05c9b2d6d7795c07b23d09477fb1434` | picked | — | Cherry-picked cleanly. |
| `802526be2c22411693b327fc02c03de245494670` | `14698d3c9e74197c774edda92e0002a0cb6d6352` | picked | — | Cherry-picked cleanly. |

## PR #611 — `docs(readme): update project status after wave merge`

- Frozen head SHA: `e5a864e53a01eb97f54d7ea4e78e1c44a3a0173f`
- Merge-base: `9559dd21df5a72eb0bdda9ae0f50c34975fe3998`

| Source commit | New branch commit | Status | Conflict files | Resolution summary |
| --- | --- | --- | --- | --- |
| `e5a864e53a01eb97f54d7ea4e78e1c44a3a0173f` | `45fb73a1a58d9c02e94e0b7f7551a6a8b3bc1cf6` | picked | — | Cherry-picked cleanly. |
