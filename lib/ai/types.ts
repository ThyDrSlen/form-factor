/**
 * Model-provider contract. Feature code asks for a task to be done; it never
 * names a vendor or model. Any backend that can turn chat messages into text
 * — a cloud edge function, an on-device runtime, a cache — implements this.
 */

export type ModelRole = 'system' | 'user' | 'assistant';

export interface ModelMessage {
  role: ModelRole;
  content: string;
}

/**
 * What a provider can do. The router only sends a request to providers that
 * declare every capability the request requires.
 * - `stream`: native incremental output (others are adapted to one chunk)
 * - `vision`: accepts an image attachment
 * - `json`: can be asked for strict JSON output
 */
export type ModelCapability = 'stream' | 'vision' | 'json';

export type ModelProviderKind = 'cloud' | 'on-device';

export interface ModelRequest {
  messages: ModelMessage[];
  /** Opaque, provider-specific prompt context (e.g. the coach context object). */
  context?: unknown;
  /** Optional model override; providers that do not support it ignore it. */
  model?: string;
  /** Coarse task label for telemetry and routing policy. */
  taskKind?: string;
  signal?: AbortSignal;
}

export interface ModelResult {
  text: string;
  providerId: string;
  /** Model identifier reported by the backend, when known. */
  model?: string;
  /** Where the text came from, when the backend reports it. */
  source?: 'remote' | 'local' | 'cache';
  /** Untouched backend payload for callers that need extra fields. */
  raw?: unknown;
}

export interface ModelProvider {
  /** Stable identifier used in config and preferences, e.g. `openai`, `gemma-cloud`. */
  readonly id: string;
  readonly label: string;
  readonly kind: ModelProviderKind;
  readonly capabilities: readonly ModelCapability[];
  /** Cheap readiness check (model downloaded, runtime linked, etc.). */
  isAvailable(): boolean | Promise<boolean>;
  generate(request: ModelRequest): Promise<ModelResult>;
  /** Present only when the backend streams natively. */
  stream?(request: ModelRequest, onChunk: (delta: string) => void): Promise<ModelResult>;
}
