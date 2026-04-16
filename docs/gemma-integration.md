# Gemma On-Device Coach — Integration Feasibility

**Status:** Research complete. Scaffold in this PR. Full integration tracked in follow-up.
**Last updated:** 2026-04-15
**Related issue:** [#415](https://github.com/ThyDrSlen/form-factor/issues/415)

---

## 1. Why on-device?

The current AI coach (`lib/services/coach-service.ts`) invokes a Supabase Edge Function
(`supabase/functions/coach/`) that relays prompts to a cloud LLM. This path has three
chronic problems during live workouts:

1. **Latency** — network round-trip + cloud inference adds 1–3s to every reply.
   Users drop their phone, start a set, and the coach arrives mid-rep.
2. **Offline failure** — gyms and outdoor training regularly have no signal.
   The current path simply errors (`COACH_INVOKE_FAILED`).
3. **Unit economics** — every rep-cue prompt costs tokens. Scaling hot-takes
   during sets is expensive.

An on-device small model changes the primitives: sub-second time-to-first-token,
zero network dependency, and effectively free per-token cost after weights are
downloaded once.

## 2. Recommended stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Model | **Gemma 3 270M-it, INT4 QAT** | ~240–300 MB on disk, fits <300 MB RAM, instruction-tuned variant already exists. |
| Runtime | **`react-native-executorch`** (Software Mansion) | Expo-compatible, `useLLM` hook, ships Llama/Qwen/SmolLM examples. Active maintenance. |
| Fallback runtime | `llama.rn` (mybigday) | If we can't export the model to `.pte` format, `.gguf` is broadly supported. |
| Distribution | Expo Background Assets, Wi-Fi only, user opt-in | 300 MB is too large to bundle; must be lazy. |
| Licensing | Gemma 4 Apache 2.0 preferred, Gemma 3 under Google's Gemma Terms | Surface LICENSE in Settings → Legal. |
| Upgrade path | Gemma 4 E2B | Richer post-session summaries once 270M ships. |

## 3. Expected numbers (iPhone 14 Pro, ANE)

| Metric | Target | Source |
|--------|--------|--------|
| Throughput | 30–50 tok/s | ExecuTorch Gemma 3 270M INT4 benchmarks |
| Time-to-first-token | < 300 ms | ExecuTorch warm-cache, ANE-resident |
| 150-token reply | ~3–4 s | Derived from throughput |
| Battery | ~0.75% per 25 conversations | Google Pixel 9 Pro Tensor G4 — ANE should match |
| Disk | 240–300 MB | INT4 QAT weights + tokenizer |
| RAM peak | < 300 MB | Held in ANE/GPU pool, not app heap |

These are targets, not measurements. Validation is part of the follow-up PR.

## 4. Licensing

- **Gemma 3 / Gemma 4** ship under the [Gemma Terms of Use](https://ai.google.dev/gemma/terms).
  Commercial redistribution is allowed with prominent attribution.
- **Gemma 4 E2B (if we upgrade)** is Apache 2.0 — the easier path.
- Action items before shipping:
  - [ ] Add Gemma LICENSE text to Settings → Legal.
  - [ ] Include the "Built with Gemma" attribution string where required.
  - [ ] Document the model version + quantization in the release notes on first
        ship so users can audit.

## 5. Risks and mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Thermal: ARKit body-tracking + LLM decode on the same device | High | Only invoke Gemma **post-set** during rest, never mid-rep. Gate on thermal state via `DeviceThermalState`. |
| Quality ceiling: 270M loses to Claude/GPT on free-form dialog | Medium | Keep cloud path as fallback for long-form chat; reserve on-device for short, structured cues. |
| 300 MB first-launch download | Medium | Opt-in after onboarding. Wi-Fi-only gate. Show a progress indicator. Never auto-download on cellular. |
| Weight export / `.pte` conversion fails | Low-Medium | `llama.rn` with `.gguf` is the documented fallback. |
| Dev-client rebuild required for ExecuTorch native module | Low | Expected — document in follow-up PR release plan. |
| Model drift: Google retracts terms or moves to non-commercial | Low | Pin model version; bundle license snapshot in-repo. |

## 6. Scope of **this** PR (the scaffold)

1. This feasibility document.
2. `lib/services/coach-local.ts` — provider stub with the same signature as
   `sendCoachPrompt`. Throws `COACH_LOCAL_NOT_AVAILABLE` until the real
   implementation lands.
3. `sendCoachPrompt` in `lib/services/coach-service.ts` now checks
   `EXPO_PUBLIC_COACH_LOCAL === '1'`. When the flag is on it tries the local
   provider first and falls back to cloud on `COACH_LOCAL_NOT_AVAILABLE`. When
   the flag is off (default), behavior is **100% unchanged**.
4. Unit tests: stub error shape + dispatcher fallback to cloud.
5. Deferred-dependency note in `docs/OVERNIGHT_CHANGELOG.md`.

## 7. Explicitly **out of scope** (follow-up work)

- Adding `react-native-executorch` as a runtime dependency (requires a
  dev-client rebuild and iOS native changes, both prohibited in overnight mode).
- Downloading Gemma weights via Expo Background Assets.
- Implementing the actual `useLLM`/`generate()` call inside `coach-local.ts`.
- A/B comparison with the cloud coach (quality + latency + battery).
- Telemetry hooks for thermal state and throttled fallbacks.

## 8. Next steps (daytime PRs)

1. **PR-1 (dev env):** Add `react-native-executorch` dep, rebuild dev client,
   verify `useLLM` boot on an iPhone 14 Pro dev device.
2. **PR-2 (asset pipeline):** Wire Expo Background Assets for the Gemma 3
   270M INT4 `.pte` bundle. Opt-in screen + Wi-Fi gate + resumable download.
3. **PR-3 (generation):** Replace the `COACH_LOCAL_NOT_AVAILABLE` stub in
   `coach-local.ts` with a real `generate()` call. Keep the error shape —
   cloud fallback should still work if the model fails to load.
4. **PR-4 (validation):** Benchmark throughput, TTFT, battery on target
   devices. Ship behind `EXPO_PUBLIC_COACH_LOCAL=1` to TestFlight beta.
5. **PR-5 (GA):** Default flag on for supported devices (A16+). Retain cloud
   fallback for older hardware and free-form long chat.

## 9. Open questions

- Do we ship the `.pte` bundle signed so we can detect weight corruption?
- Which conversation surfaces use on-device vs cloud? (Proposal: rep cues +
  short post-set summary = on-device. Free-form chat tab = cloud.)
- How do we expose the flag in the UI — hidden dev toggle, Settings entry, or
  purely env-driven for TestFlight?

## 10. References

- [Gemma models on Hugging Face](https://huggingface.co/google/gemma-3-270m)
- [react-native-executorch docs](https://docs.swmansion.com/react-native-executorch/)
- [ExecuTorch on-device LLM tutorial](https://pytorch.org/executorch/stable/llm/getting-started.html)
- [llama.rn](https://github.com/mybigday/llama.rn) — GGUF fallback runtime
- [Expo Background Assets](https://docs.expo.dev/versions/latest/sdk/background-assets/)
