/**
 * Thermal Monitor — minimal stub
 *
 * TODO(#449): merge with PR #449 canonical implementation on land.
 *
 * The canonical service in PR #449 will subscribe to the iOS
 * `NSProcessInfo.thermalState` notification (via the resilience plumbing)
 * and an Android `BatteryManager` thermal hint. This stub is shipped
 * alongside #464 so the battery+thermal hook has a stable import path that
 * does not break the build when #449 is not yet on `main`.
 *
 * Contract (kept narrow):
 *   - `getThermalState()` → returns the current thermal bucket. Stub
 *     defaults to `'normal'` (safe — no auto-pause is triggered).
 *   - `subscribeThermalState(cb)` → noop in the stub; consumers should
 *     handle the promise of a future canonical implementation.
 */

export type ThermalState = 'normal' | 'fair' | 'serious' | 'critical';

let cachedState: ThermalState = 'normal';

/**
 * Synchronous thermal-state read. Always returns `'normal'` in the stub.
 * PR #449's implementation should keep this signature for hook safety.
 */
export function getThermalState(): ThermalState {
  return cachedState;
}

/**
 * Test-only helper to simulate a thermal-state change before #449 lands.
 * Real implementation will replace this with a NotificationCenter listener.
 */
export function __setThermalStateForTest(state: ThermalState): void {
  cachedState = state;
}

/**
 * Subscribe to thermal state changes. The stub returns a no-op unsubscribe
 * function so consumers can register/cleanup safely.
 */
export function subscribeThermalState(_cb: (state: ThermalState) => void): () => void {
  return () => {
    /* noop in stub */
  };
}
