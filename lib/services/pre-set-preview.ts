/**
 * Pre-set stance preview (issue #460)
 *
 * Given a snapshot of the user's current stance (frame + joint angles),
 * asks the coach whether the setup looks safe and correct for the
 * upcoming exercise. Attempts Gemma (on-device) first when enabled,
 * falls back to OpenAI via the existing coach Edge Function when Gemma
 * is unavailable or errors out.
 */

import { warnWithTs } from '@/lib/logger';
import type { FrameSnapshot, JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import { sendCoachPrompt, type CoachMessage } from './coach-service';
import { sendCoachGemmaPrompt } from './coach-gemma-service';
import { assertUnderWeeklyCap } from './coach-cost-guard';
import { recordCoachUsage } from './coach-cost-tracker';
import { hardenAgainstInjection } from './coach-injection-hardener';

export type PreSetPreviewProvider = 'gemma' | 'openai';

export interface PreSetPreviewResult {
  verdict: string;
  isFormGood: boolean;
  provider: PreSetPreviewProvider;
}

const GEMMA_PROVIDER_ENV = 'EXPO_PUBLIC_COACH_CLOUD_PROVIDER';
const MAX_VERDICT_LENGTH = 160;

export const PRE_SET_PREVIEW_TASK_KIND = 'form_check' as const;

function recordPreSetUsage(provider: 'gemma_cloud' | 'openai'): void {
  void recordCoachUsage({
    provider,
    taskKind: PRE_SET_PREVIEW_TASK_KIND,
    tokensIn: 0,
    tokensOut: 0,
  }).catch((err) => {
    warnWithTs('[pre-set-preview] recordCoachUsage failed', err);
  });
}

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
  const looksGood = /^✓|\bgood\b/i.test(trimmed);
  const looksWarning = /^⚠|\bwarn|\bincorrect|\bunsafe/i.test(trimmed);
  return {
    verdict: trimmed,
    isFormGood: looksGood && !looksWarning,
  };
}

function isGemmaEnabled(): boolean {
  // Evaluated at call-time so tests can mutate process.env between cases.
  return process.env[GEMMA_PROVIDER_ENV] === 'gemma';
}

async function callGemma(prompt: string): Promise<string> {
  // Harden the prompt before dispatch so adversarial exercise names cannot
  // smuggle prompt-break tokens into the Gemma system message.
  const hardened = hardenAgainstInjection(prompt, { maxLength: 1000 });
  const messages: CoachMessage[] = [{ role: 'user', content: hardened }];
  const reply = await sendCoachGemmaPrompt(messages, {
    focus: 'pre-set-stance-preview-gemma',
  });
  return reply.content;
}

async function callOpenAI(prompt: string): Promise<string> {
  // Same hardening as the Gemma path — defense in depth against injected
  // exercise names / angle text before the prompt reaches the cloud model.
  const hardened = hardenAgainstInjection(prompt, { maxLength: 1000 });
  const messages: CoachMessage[] = [{ role: 'user', content: hardened }];
  const reply = await sendCoachPrompt(messages, {
    focus: 'pre-set-stance-preview',
  });
  return reply.content;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function checkPreSetStance(
  snapshot: FrameSnapshot,
  exerciseName: string,
  jointAngles: JointAngles
): Promise<PreSetPreviewResult> {
  const serialized = serializeJointAnglesForPrompt(jointAngles);
  const prompt = buildPreSetPrompt(exerciseName, serialized);

  if (isGemmaEnabled()) {
    let capExceeded = false;
    try {
      await assertUnderWeeklyCap('gemma_cloud');
    } catch (err) {
      capExceeded = true;
      warnWithTs('[pre-set-preview] weekly Gemma cap hit, using OpenAI', err);
    }

    if (!capExceeded) {
      try {
        const reply = await callGemma(prompt);
        const interpreted = interpretVerdict(reply);
        recordPreSetUsage('gemma_cloud');
        return { ...interpreted, provider: 'gemma' };
      } catch {
        // Fall through to OpenAI — Gemma path is best-effort.
      }
    }
  }

  const reply = await callOpenAI(prompt);
  const interpreted = interpretVerdict(reply);
  recordPreSetUsage('openai');
  return { ...interpreted, provider: 'openai' };
}
