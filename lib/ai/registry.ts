import type { ModelProvider } from './types';

/**
 * Process-wide provider registry. Built-in cloud providers register at import
 * time (see `providers/index.ts`); an on-device runtime registers itself once
 * its native module is linked. Registering an existing id replaces it.
 */
const providers = new Map<string, ModelProvider>();

export function registerProvider(provider: ModelProvider): () => void {
  providers.set(provider.id, provider);
  return () => {
    if (providers.get(provider.id) === provider) providers.delete(provider.id);
  };
}

export function getProvider(id: string): ModelProvider | undefined {
  return providers.get(id);
}

export function listProviders(): ModelProvider[] {
  return [...providers.values()];
}

/** Test-only: drop every registration. */
export function __resetRegistryForTests(): void {
  providers.clear();
}
