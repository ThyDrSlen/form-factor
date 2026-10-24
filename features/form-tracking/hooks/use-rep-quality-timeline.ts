import { useMemo } from 'react';
import {
  buildRepQualityTimeline,
  type BuildTimelineOptions,
  type RepQualityTimeline,
} from '@/lib/services/rep-quality-timeline';
import type { RepQualityLog } from '@/lib/services/rep-quality-log';
import { useRepQualityLog } from './use-rep-quality-log';

export interface UseRepQualityTimelineOptions extends BuildTimelineOptions {
  log?: RepQualityLog;
  sessionId?: string;
}

/**
 * Build a timeline from a rep-quality log for the given session. Re-memoizes
 * whenever the log emits or any option changes.
 */
export function useRepQualityTimeline(
  options: UseRepQualityTimelineOptions = {}
): RepQualityTimeline {
  const { entries } = useRepQualityLog({ log: options.log, sessionId: options.sessionId });

  return useMemo(
    () =>
      buildRepQualityTimeline(entries, {
        sessionId: options.sessionId,
        lowConfidenceThreshold: options.lowConfidenceThreshold,
        highConfidenceFqi: options.highConfidenceFqi,
      }),
    [entries, options.sessionId, options.lowConfidenceThreshold, options.highConfidenceFqi]
  );
}
