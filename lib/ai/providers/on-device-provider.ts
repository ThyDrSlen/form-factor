import { createError } from '@/lib/services/ErrorHandler';
import { registerProvider } from '../registry';
import type { ModelCapability, ModelMessage, ModelProvider } from '../types';

/**
 * What an on-device runtime must implement to serve requests: llama.rn (any
 * GGUF small model — Gemma 3n, Qwen, Llama, Phi), Apple Foundation Models,
 * MediaPipe LLM Inference, ExecuTorch, … Nothing is linked yet; a runtime
 * package calls `registerOnDeviceRuntime()` once its native module and
 * weights are ready, and the router starts considering it.
 */
export interface OnDeviceRuntime {
  /** Provider id used in `EXPO_PUBLIC_AI_PROVIDERS`, e.g. `on-device`, `apple-foundation`. */
  id: string;
  label: string;
  /** Model identifier reported with each reply, e.g. `gemma-3n-e2b-q4`. */
  model: string;
  capabilities?: readonly ModelCapability[];
  /** True once the native module is linked and weights are loaded. */
  isReady(): boolean | Promise<boolean>;
  generate(messages: ModelMessage[], opts: { signal?: AbortSignal; maxTokens?: number }): Promise<string>;
  stream?(
    messages: ModelMessage[],
    onChunk: (delta: string) => void,
    opts: { signal?: AbortSignal; maxTokens?: number },
  ): Promise<string>;
}

export function createOnDeviceProvider(runtime: OnDeviceRuntime): ModelProvider {
  const finish = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      throw createError('ml', 'AI_ON_DEVICE_EMPTY', `${runtime.label} returned no text`, { retryable: true });
    }
    return { text: trimmed, providerId: runtime.id, model: runtime.model, source: 'local' as const };
  };
  return {
    id: runtime.id,
    label: runtime.label,
    kind: 'on-device',
    capabilities: runtime.capabilities ?? [],
    isAvailable: () => runtime.isReady(),
    generate: async (request) => finish(await runtime.generate(request.messages, { signal: request.signal })),
    stream: runtime.stream
      ? async (request, onChunk) => finish(await runtime.stream!(request.messages, onChunk, { signal: request.signal }))
      : undefined,
  };
}

/** Registers the runtime as a provider. Returns an unregister function. */
export function registerOnDeviceRuntime(runtime: OnDeviceRuntime): () => void {
  return registerProvider(createOnDeviceProvider(runtime));
}
