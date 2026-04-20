/**
 * Coach Fallback Responses
 *
 * Offline / rate-limited / server-error paths used to surface a generic
 * "Coach failed to respond" toast. This service returns short, contextually
 * useful text so the user always gets something actionable — tuned so it
 * feels like the coach is still present, just briefly constrained.
 */

export type FallbackReason =
  | 'offline'
  | 'rate-limited'
  | 'server-error'
  | 'timeout';

export interface FallbackContext {
  reason: FallbackReason;
  /** Latest FQI 0-100, when available. */
  latestFqi?: number | null;
  /** Fault IDs seen in the last few reps, most recent first. */
  recentFaults?: string[];
  /** Exercise being performed. */
  exercise?: string | null;
}

export interface FallbackResponse {
  message: string;
  severity: 'info' | 'warning';
  retryable: boolean;
}

const REASON_INTROS: Record<FallbackReason, string> = {
  offline: "You're offline, so I can't pull a fresh coach response.",
  'rate-limited': "Coach is catching up after a burst of requests.",
  'server-error': "The coach service hit a hiccup.",
  timeout: "Coach took too long to respond.",
};

const FQI_GUIDANCE_HIGH = 'That last rep looked clean — keep the tempo and stack another.';
const FQI_GUIDANCE_MID = 'Dial tempo back a notch and focus on a full range of motion.';
const FQI_GUIDANCE_LOW = 'Form dipped. Reset, breathe, and start the next rep slow and deliberate.';

function fqiGuidance(latestFqi: number): string {
  if (latestFqi >= 85) return FQI_GUIDANCE_HIGH;
  if (latestFqi >= 65) return FQI_GUIDANCE_MID;
  return FQI_GUIDANCE_LOW;
}

function faultGuidance(recentFaults: string[], exercise?: string | null): string | null {
  if (recentFaults.length === 0) return null;
  const top = recentFaults[0];
  const human = top
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
  if (exercise) {
    return `Recent "${human}" on ${exercise} — watch it on the next rep.`;
  }
  return `Recent "${human}" — watch it on the next rep.`;
}

export function getFallbackCoachResponse(ctx: FallbackContext): FallbackResponse {
  const intro = REASON_INTROS[ctx.reason];
  const tips: string[] = [];

  if (typeof ctx.latestFqi === 'number' && Number.isFinite(ctx.latestFqi)) {
    tips.push(fqiGuidance(ctx.latestFqi));
  }

  const faultTip = faultGuidance(ctx.recentFaults ?? [], ctx.exercise ?? null);
  if (faultTip) tips.push(faultTip);

  const retryHint = ctx.reason === 'offline'
    ? "I'll sync up once you're back online."
    : "Tap the coach again in a moment to retry.";

  const body = tips.length > 0
    ? `${intro} ${tips.join(' ')} ${retryHint}`
    : `${intro} ${retryHint}`;

  return {
    message: body.trim(),
    severity: ctx.reason === 'rate-limited' ? 'info' : 'warning',
    retryable: ctx.reason !== 'offline',
  };
}

/**
 * Rank the available fallback reasons so the UI can pick the highest-priority
 * one when multiple signals are in flight (e.g., offline AND rate-limited).
 */
export function prioritizeFallbackReasons(reasons: FallbackReason[]): FallbackReason | null {
  if (reasons.length === 0) return null;
  const priority: Record<FallbackReason, number> = {
    offline: 4,
    'server-error': 3,
    timeout: 2,
    'rate-limited': 1,
  };
  return [...reasons].sort((a, b) => priority[b] - priority[a])[0];
}
