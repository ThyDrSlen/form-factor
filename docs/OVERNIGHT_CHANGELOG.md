# Overnight Changelog

Tracks work done in headless `claude -p` overnight runs that needs
follow-up from a human — particularly deferred dependencies, skipped
native work, or changes that require a dev-client rebuild.

---

## 2026-04-15 — Gemma on-device coach scaffold (issue #415)

**Deferred dep:** `react-native-executorch`

**Why deferred:**
- Overnight rules prohibit adding new runtime dependencies without human
  review, and ExecuTorch requires a dev-client rebuild (changes to `ios/`
  and `android/` native projects) that overnight mode cannot exercise.
- The native module also needs on-device verification on at least one
  physical iPhone 14 Pro / A16-class device before it can ship.

**What landed tonight (safe, no native changes):**
- `docs/gemma-integration.md` — full feasibility writeup (stack, numbers,
  licensing, risks, rollout plan).
- `lib/services/coach-local.ts` — provider stub that mirrors the
  `sendCoachPrompt` interface and throws `COACH_LOCAL_NOT_AVAILABLE`.
  All `react-native-executorch` integration points are marked with
  `TODO(#415-followup)`.
- `lib/services/coach-service.ts` — dispatcher that honours
  `EXPO_PUBLIC_COACH_LOCAL === '1'`, tries local first, falls back to
  cloud on the sentinel error. Flag defaults off → cloud behavior is
  unchanged.
- `tests/unit/services/coach-local.test.ts` — covers stub error shape
  and dispatcher fallback path.

**Follow-up work (daytime PRs):**
1. `bun add react-native-executorch` + `bun run prebuild` + dev-client
   rebuild. Verify `useLLM` boots on an iPhone 14 Pro dev device.
2. Wire Expo Background Assets to download the Gemma 3 270M INT4 `.pte`
   bundle. Opt-in, Wi-Fi-only, resumable.
3. Replace `COACH_LOCAL_NOT_AVAILABLE` in `coach-local.ts` with a real
   `generate()` call. Keep the error shape — cloud fallback must still
   work if the model fails to load.
4. Benchmark on target devices: throughput, TTFT, battery, thermal.
5. Ship behind the flag to TestFlight beta, then default-on for A16+.

**Verification done in this PR:**
- `bun run lint` — clean (2 unrelated pre-existing warnings in
  `app/(modals)/template-builder.tsx`).
- `bun run check:types` — clean.
- Unit tests for `coach-local` and existing `coach-service` tests pass.
