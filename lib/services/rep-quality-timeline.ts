/**
 * Rep Quality Timeline
 *
 * Pure aggregator that turns a flat list of `RepQualityEntry` values into a
 * timeline of segments and a summary block for rendering in the post-session
 * modal (or piping to the coach as context).
 */

import type { RepQualityEntry } from './rep-quality-log';

export type TimelineSegmentType =
  | 'rep'
  | 'fault'
  | 'tracking-loss'
  | 'low-confidence'
  | 'high-confidence';

export interface TimelineSegment {
  type: TimelineSegmentType;
  repIndex?: number;
  ts: string;
  fqi?: number | null;
  faults?: string[];
  message: string;
}

export interface TimelineSummary {
  totalReps: number;
  avgFqi: number | null;
  medianFqi: number | null;
  faultCounts: Record<string, number>;
  occludedReps: number;
  lowConfidenceReps: number;
  bestRepIndex: number | null;
  worstRepIndex: number | null;
  bestFqi: number | null;
  worstFqi: number | null;
}

export interface RepQualityTimeline {
  sessionId: string | null;
  startTs: string | null;
  endTs: string | null;
  segments: TimelineSegment[];
  summary: TimelineSummary;
}

export interface BuildTimelineOptions {
  /**
   * Confidence threshold below which a rep is flagged with a
   * `low-confidence` segment. Default: 0.4.
   */
  lowConfidenceThreshold?: number;
  /**
   * FQI threshold above which a rep gets a `high-confidence` celebratory
   * segment. Default: 90.
   */
  highConfidenceFqi?: number;
}

const DEFAULT_LOW_CONFIDENCE = 0.4;
const DEFAULT_HIGH_FQI = 90;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return Math.round(sorted[mid]);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((a, b) => a + b, 0);
  return Math.round(total / values.length);
}

function buildSummary(entries: RepQualityEntry[]): TimelineSummary {
  const fqis = entries
    .map((e) => e.fqi)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

  const faultCounts: Record<string, number> = {};
  let occludedReps = 0;
  let lowConfidenceReps = 0;
  let bestRepIndex: number | null = null;
  let worstRepIndex: number | null = null;
  let bestFqi: number | null = null;
  let worstFqi: number | null = null;

  for (const entry of entries) {
    for (const fault of entry.faults) {
      faultCounts[fault] = (faultCounts[fault] ?? 0) + 1;
    }
    if (entry.occluded) occludedReps++;
    if (typeof entry.minJointConfidence === 'number' && entry.minJointConfidence < DEFAULT_LOW_CONFIDENCE) {
      lowConfidenceReps++;
    }
    if (typeof entry.fqi === 'number' && Number.isFinite(entry.fqi)) {
      if (bestFqi === null || entry.fqi > bestFqi) {
        bestFqi = entry.fqi;
        bestRepIndex = entry.repIndex;
      }
      if (worstFqi === null || entry.fqi < worstFqi) {
        worstFqi = entry.fqi;
        worstRepIndex = entry.repIndex;
      }
    }
  }

  return {
    totalReps: entries.length,
    avgFqi: mean(fqis),
    medianFqi: median(fqis),
    faultCounts,
    occludedReps,
    lowConfidenceReps,
    bestRepIndex,
    worstRepIndex,
    bestFqi,
    worstFqi,
  };
}

function repSegment(entry: RepQualityEntry): TimelineSegment {
  const parts: string[] = [`Rep ${entry.repIndex}`];
  if (typeof entry.fqi === 'number') {
    parts.push(`FQI ${entry.fqi}`);
  }
  return {
    type: 'rep',
    repIndex: entry.repIndex,
    ts: entry.ts,
    fqi: entry.fqi,
    faults: [...entry.faults],
    message: parts.join(' · '),
  };
}

function faultSegment(entry: RepQualityEntry): TimelineSegment {
  const faultLabel = entry.faults.length === 1
    ? entry.faults[0]
    : `${entry.faults.length} faults`;
  return {
    type: 'fault',
    repIndex: entry.repIndex,
    ts: entry.ts,
    fqi: entry.fqi,
    faults: [...entry.faults],
    message: `Rep ${entry.repIndex} · ${faultLabel}`,
  };
}

function trackingLossSegment(entry: RepQualityEntry): TimelineSegment {
  return {
    type: 'tracking-loss',
    repIndex: entry.repIndex,
    ts: entry.ts,
    message: `Rep ${entry.repIndex} · tracking lost`,
  };
}

function lowConfidenceSegment(entry: RepQualityEntry, threshold: number): TimelineSegment {
  const confidence = typeof entry.minJointConfidence === 'number'
    ? entry.minJointConfidence
    : threshold;
  const joint = entry.minConfidenceJoint ? ` · ${entry.minConfidenceJoint}` : '';
  return {
    type: 'low-confidence',
    repIndex: entry.repIndex,
    ts: entry.ts,
    message: `Rep ${entry.repIndex} · low confidence (${Math.round(confidence * 100)}%)${joint}`,
  };
}

function highConfidenceSegment(entry: RepQualityEntry): TimelineSegment {
  return {
    type: 'high-confidence',
    repIndex: entry.repIndex,
    ts: entry.ts,
    fqi: entry.fqi,
    message: `Rep ${entry.repIndex} · clean rep (FQI ${entry.fqi})`,
  };
}

export function buildRepQualityTimeline(
  entries: RepQualityEntry[],
  options: BuildTimelineOptions & { sessionId?: string } = {}
): RepQualityTimeline {
  const lowConfidenceThreshold = options.lowConfidenceThreshold ?? DEFAULT_LOW_CONFIDENCE;
  const highFqi = options.highConfidenceFqi ?? DEFAULT_HIGH_FQI;

  const filtered = options.sessionId
    ? entries.filter((e) => e.sessionId === options.sessionId)
    : entries;

  const sorted = [...filtered].sort((a, b) => {
    if (a.ts !== b.ts) return a.ts.localeCompare(b.ts);
    return a.repIndex - b.repIndex;
  });

  const segments: TimelineSegment[] = [];
  for (const entry of sorted) {
    segments.push(repSegment(entry));
    if (entry.occluded) {
      segments.push(trackingLossSegment(entry));
    }
    if (entry.faults.length > 0) {
      segments.push(faultSegment(entry));
    }
    if (
      typeof entry.minJointConfidence === 'number' &&
      entry.minJointConfidence < lowConfidenceThreshold
    ) {
      segments.push(lowConfidenceSegment(entry, lowConfidenceThreshold));
    }
    if (typeof entry.fqi === 'number' && entry.fqi >= highFqi && entry.faults.length === 0) {
      segments.push(highConfidenceSegment(entry));
    }
  }

  const summary = buildSummary(sorted);

  return {
    sessionId: options.sessionId ?? sorted[0]?.sessionId ?? null,
    startTs: sorted[0]?.ts ?? null,
    endTs: sorted[sorted.length - 1]?.ts ?? null,
    segments,
    summary,
  };
}

/**
 * One-line human-readable summary of a timeline suitable for a coach prompt
 * or a compact card caption.
 */
export function summarizeTimeline(timeline: RepQualityTimeline): string {
  const { summary } = timeline;
  if (summary.totalReps === 0) return 'No reps recorded.';

  const parts: string[] = [`${summary.totalReps} reps`];
  if (summary.avgFqi !== null) {
    parts.push(`avg FQI ${summary.avgFqi}`);
  }
  const topFault = Object.entries(summary.faultCounts).sort((a, b) => b[1] - a[1])[0];
  if (topFault) {
    parts.push(`top fault: ${topFault[0]} (×${topFault[1]})`);
  }
  if (summary.occludedReps > 0) {
    parts.push(`${summary.occludedReps} occluded`);
  }
  return parts.join(' · ');
}
