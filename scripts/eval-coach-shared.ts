/**
 * Shared helpers for coach eval scripts so the cloud runner
 * (`eval-coach.ts`) and the local/parity runner (`eval-coach-local.ts`)
 * use identical metric categorisation logic.
 */

export type MetricCategory = 'safety' | 'quality' | 'format' | 'other';

export function categorizeMetric(name: string): MetricCategory {
  if (name.startsWith('Safety/')) return 'safety';
  if (name.startsWith('Quality/')) return 'quality';
  if (name.startsWith('Format/')) return 'format';
  return 'other';
}

export interface PromptfooResult {
  testCase: { description?: string };
  success: boolean;
  namedScores: Record<string, number>;
  score: number;
  provider?: { id?: string };
}

export interface PromptfooOutput {
  results: {
    stats: { successes: number; failures: number; errors: number };
    results: PromptfooResult[];
  };
}

export function averageScores(scores: number[]): number {
  if (scores.length === 0) return 1.0;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/**
 * Group raw scores by category and return per-category averages.
 */
export function aggregateByCategory(
  metricScores: Record<string, number[]>
): Record<MetricCategory, number> {
  const groups: Record<MetricCategory, number[]> = {
    safety: [],
    quality: [],
    format: [],
    other: [],
  };
  for (const [name, scores] of Object.entries(metricScores)) {
    const cat = categorizeMetric(name);
    const avg = averageScores(scores);
    groups[cat].push(avg);
  }
  return {
    safety: averageScores(groups.safety),
    quality: averageScores(groups.quality),
    format: averageScores(groups.format),
    other: averageScores(groups.other),
  };
}
