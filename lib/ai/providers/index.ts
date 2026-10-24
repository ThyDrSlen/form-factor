import { registerProvider } from '../registry';
import { createEdgeChatProvider, type EdgeChatConfig } from './edge-chat-provider';

/** OpenAI-backed `coach` edge function — the shipped default. */
export const OPENAI_EDGE: EdgeChatConfig = {
  id: 'openai',
  label: 'OpenAI',
  functionName: () => (process.env.EXPO_PUBLIC_COACH_FUNCTION || 'coach').trim(),
  errorPrefix: 'COACH',
  displayName: 'Coach',
  apiKeyName: 'OPENAI_API_KEY',
  rateLimitInPayload: true,
};

/** `coach-gemma` edge function → Google Generative Language API (Gemma 3 family). */
export const GEMMA_CLOUD_EDGE: EdgeChatConfig = {
  id: 'gemma-cloud',
  label: 'Gemma (cloud)',
  functionName: () => (process.env.EXPO_PUBLIC_COACH_GEMMA_FUNCTION || 'coach-gemma').trim(),
  errorPrefix: 'COACH_GEMMA',
  displayName: 'Gemma coach',
  apiKeyName: 'GEMINI_API_KEY',
  capabilities: ['vision'],
};

export const BUILTIN_EDGE_PROVIDERS: readonly EdgeChatConfig[] = [OPENAI_EDGE, GEMMA_CLOUD_EDGE];

let registered = false;

/** Idempotent; called by the coach layer before routing. */
export function ensureBuiltinProviders(): void {
  if (registered) return;
  registered = true;
  for (const config of BUILTIN_EDGE_PROVIDERS) registerProvider(createEdgeChatProvider(config));
}

/** Test-only: allow a fresh registration after `__resetRegistryForTests()`. */
export function __resetBuiltinProvidersForTests(): void {
  registered = false;
}
