import { useMemo } from 'react';
import {
  buildCoachSessionSignals,
  type BuildCoachSessionSignalsOptions,
  type CoachSessionSignals,
} from '@/lib/services/coach-session-signals';
import type { RepQualityLog } from '@/lib/services/rep-quality-log';
import { useRepQualityLog } from './use-rep-quality-log';

export interface UseCoachSessionSignalsOptions extends BuildCoachSessionSignalsOptions {
  log?: RepQualityLog;
}

/**
 * Build coach session signals from a rep-quality log. Re-memoizes whenever
 * the log emits or any option changes. Suitable for feeding into a coach
 * prompt pipeline.
 */
export function useCoachSessionSignals(
  options: UseCoachSessionSignalsOptions = {}
): CoachSessionSignals {
  const { entries } = useRepQualityLog({ log: options.log, sessionId: options.sessionId });

  return useMemo(
    () =>
      buildCoachSessionSignals(entries, {
        sessionId: options.sessionId,
        windowSize: options.windowSize,
        topFaultCount: options.topFaultCount,
        trendThreshold: options.trendThreshold,
      }),
    [
      entries,
      options.sessionId,
      options.windowSize,
      options.topFaultCount,
      options.trendThreshold,
    ]
  );
}
