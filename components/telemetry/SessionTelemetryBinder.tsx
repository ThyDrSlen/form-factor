import { useSessionTelemetryBinder } from '@/hooks/use-session-telemetry-binder';

export function SessionTelemetryBinder(): null {
  useSessionTelemetryBinder();
  return null;
}
