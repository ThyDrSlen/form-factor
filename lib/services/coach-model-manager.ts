/**
 * coach-model-manager (stub)
 *
 * TODO(#431): Replace this stub with the full implementation from
 * feat/429-gemma-coach-v2 / PR #431. That branch introduces on-device
 * Gemma model lifecycle management (download, ready, error states). Until
 * that PR merges, this minimal stub exposes `getStatus()` so that
 * coach-dispatch and the settings UI can compile and run.
 *
 * Intentionally matches the expected shape from #431 so swap-in is trivial.
 */

export type CoachModelStatus = 'none' | 'downloading' | 'ready' | 'error';

export interface CoachModelState {
  status: CoachModelStatus;
  progress?: number; // 0..1 when downloading
  errorMessage?: string;
  modelId?: string;
}

let currentState: CoachModelState = { status: 'none' };

type Listener = (state: CoachModelState) => void;
const listeners = new Set<Listener>();

export function getStatus(): CoachModelState {
  return currentState;
}

export function isModelReady(): boolean {
  return currentState.status === 'ready';
}

/**
 * Test/dev helper — set the status and notify listeners. In the PR #431
 * implementation this will be driven by the runtime layer; here it's an
 * overt test hook.
 */
export function __setStatusForTesting(next: CoachModelState): void {
  currentState = next;
  listeners.forEach((l) => l(currentState));
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  listener(currentState);
  return () => {
    listeners.delete(listener);
  };
}

export function __resetForTesting(): void {
  currentState = { status: 'none' };
  listeners.clear();
}
