import { useSessionTelemetryBinder } from '@/features/form-tracking/hooks/use-session-telemetry-binder';

export function SessionTelemetryBinder(): null {
  useSessionTelemetryBinder();
  return null;
}
