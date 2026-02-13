export type FusionMode = 'full' | 'degraded' | 'unsupported';

export type WatchAvailabilityState =
  | 'unavailable'
  | 'paired_only'
  | 'installed_not_reachable'
  | 'ready';

export interface WatchAvailabilityInput {
  paired: boolean;
  installed: boolean;
  reachable: boolean;
}

export interface WatchAvailability {
  state: WatchAvailabilityState;
  reasons: string[];
}

export interface CapabilityInput {
  cameraAnchorAvailable: boolean;
  headphoneMotionAvailable: boolean;
  watch: WatchAvailabilityInput;
}

export interface CapabilityResult {
  mode: FusionMode;
  fallbackModeEnabled: boolean;
  reasons: string[];
  watchState: WatchAvailabilityState;
}

export function deriveWatchAvailability(input: WatchAvailabilityInput): WatchAvailability {
  if (!input.paired) {
    return { state: 'unavailable', reasons: ['watch_not_paired'] };
  }

  if (!input.installed) {
    return { state: 'paired_only', reasons: ['watch_app_not_installed'] };
  }

  if (!input.reachable) {
    return { state: 'installed_not_reachable', reasons: ['watch_not_reachable'] };
  }

  return { state: 'ready', reasons: [] };
}

export function evaluateFusionCapabilities(input: CapabilityInput): CapabilityResult {
  const reasons: string[] = [];
  const watchAvailability = deriveWatchAvailability(input.watch);

  if (!input.cameraAnchorAvailable) {
    reasons.push('camera_anchor_unavailable');
  }

  if (!input.headphoneMotionAvailable) {
    reasons.push('headphone_motion_unavailable');
  }

  reasons.push(...watchAvailability.reasons);

  let mode: FusionMode;
  if (!input.cameraAnchorAvailable) {
    mode = 'unsupported';
  } else if (reasons.length > 0) {
    mode = 'degraded';
  } else {
    mode = 'full';
  }

  return {
    mode,
    fallbackModeEnabled: mode !== 'full',
    reasons,
    watchState: watchAvailability.state,
  };
}
