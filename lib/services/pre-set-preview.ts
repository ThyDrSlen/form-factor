/**
 * Pre-set stance preview (issue #460)
 *
 * Given a snapshot of the user's current stance (frame + joint angles),
 * asks the coach whether the setup looks safe and correct for the
 * upcoming exercise. Attempts Gemma (on-device) first when enabled,
 * falls back to OpenAI via the existing coach Edge Function when Gemma
 * is unavailable or errors out.
 *
 * Cross-PR dependency stubs:
 * - TODO(#439): replace the inline serializeJointAnglesForPrompt with
 *   coach-live-snapshot.buildLiveSessionSnapshot() once #443 lands on
 *   main. For now we inline a minimal joints-to-text serializer so this
 *   PR stands on its own.
 */

import type { FrameSnapshot, JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import { sendCoachPrompt, type CoachMessage } from './coach-service';
import { sendCoachGemmaPrompt } from './coach-gemma-service';
import { isDispatchEnabled } from './coach-model-dispatch-flag';

export type PreSetPreviewProvider = 'gemma' | 'openai';

export interface PreSetPreviewResult {
  verdict: string;
  isFormGood: boolean;
  provider: PreSetPreviewProvider;
}

const GEMMA_PROVIDER_ENV = 'EXPO_PUBLIC_COACH_CLOUD_PROVIDER';
const MAX_VERDICT_LENGTH = 160;

/**
 * Inline replacement for coach-live-snapshot.buildLiveSessionSnapshot().
 * Turns the current joint angles into a compact human-readable line so
 * the coach prompt has concrete numbers to reason about without needing
 * the full snapshot protocol from #443.
 *
 * TODO(#439): delete once #443 lands on main and swap the caller to use
 * buildLiveSessionSnapshot(frame, angles).
 */
function serializeJointAnglesForPrompt(angles: JointAngles): string {
  const fmt = (n: number) => (Number.isFinite(n) ? `${Math.round(n)}°` : '--');
  return [
    `L-knee ${fmt(angles.leftKnee)}`,
    `R-knee ${fmt(angles.rightKnee)}`,
    `L-elbow ${fmt(angles.leftElbow)}`,
    `R-elbow ${fmt(angles.rightElbow)}`,
    `L-hip ${fmt(angles.leftHip)}`,
    `R-hip ${fmt(angles.rightHip)}`,
    `L-shoulder ${fmt(angles.leftShoulder)}`,
    `R-shoulder ${fmt(angles.rightShoulder)}`,
  ].join(', ');
}

export function buildPreSetPrompt(
  exerciseName: string,
  serializedAngles: string
): string {
  return (
    `You are a form coach. The user has set up for ${exerciseName}. ` +
    `Based on these joint angles: ${serializedAngles}. ` +
    `Does this stance look safe and correct? ` +
    `Reply with '✓ Good' or '⚠ ${'${specific adjustment}'}'. ` +
    `Keep reply under 20 words.`
  );
}

function interpretVerdict(raw: string): { verdict: string; isFormGood: boolean } {
  const trimmed = raw.trim().slice(0, MAX_VERDICT_LENGTH);
  // Good: leading ✓ or the literal phrase "Good" / "looks good" (case-insens.).
  const looksGood = /^✓|\bgood\b/i.test(trimmed);
  // Explicit warning marker beats a stray "good" inside a caveat string.
  const looksWarning = /^⚠|\bwarn|\bincorrect|\bunsafe/i.test(trimmed);
  return {
    verdict: trimmed,
    isFormGood: looksGood && !looksWarning,
  };
}

function isGemmaEnabled(): boolean {
  // Evaluated at call-time so tests can mutate process.env between cases.
  // Dispatch-flag gate (#536): both the env-level provider choice and the
  // global dispatch flag must be on before we try Gemma. This keeps the
  // Gemma path cleanly pausable via `EXPO_PUBLIC_COACH_DISPATCH=off` even
  // when env already points at Gemma.
  return process.env[GEMMA_PROVIDER_ENV] === 'gemma' && isDispatchEnabled();
}

async function callGemma(prompt: string): Promise<string> {
  // Direct call to the canonical Gemma service — routes through the
  // coach-gemma edge function rather than the generic `coach` function so
  // model-specific parameters and provider annotations flow through cleanly.
  const messages: CoachMessage[] = [{ role: 'user', content: prompt }];
  const reply = await sendCoachGemmaPrompt(messages, {
    focus: 'pre-set-stance-preview-gemma',
  });
  return reply.content;
}

async function callOpenAI(prompt: string): Promise<string> {
  const messages: CoachMessage[] = [{ role: 'user', content: prompt }];
  const reply = await sendCoachPrompt(messages, {
    focus: 'pre-set-stance-preview',
  });
  return reply.content;
}

/**
 * Orchestrator entry point. Accepts the current frame snapshot + joint
 * angles + exercise name; returns the coach verdict plus which provider
 * actually produced it.
 *
 * The `snapshot` argument is currently only used as a signal that the
 * caller has a live frame (we do not forward the image base64 to the
 * coach yet — that piece is blocked on #443). Keeping the param in the
 * signature now means consumer code stays stable when #443 lands.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function checkPreSetStance(
  snapshot: FrameSnapshot,
  exerciseName: string,
  jointAngles: JointAngles
): Promise<PreSetPreviewResult> {
  const serialized = serializeJointAnglesForPrompt(jointAngles);
  const prompt = buildPreSetPrompt(exerciseName, serialized);

  if (isGemmaEnabled()) {
    try {
      const reply = await callGemma(prompt);
      const interpreted = interpretVerdict(reply);
      return { ...interpreted, provider: 'gemma' };
    } catch {
      // Fall through to OpenAI — Gemma path is best-effort.
    }
  }

  const reply = await callOpenAI(prompt);
  const interpreted = interpretVerdict(reply);
  return { ...interpreted, provider: 'openai' };
}
