import type { ModelProviderInstanceLike } from '../agent/types.js';
import type { ModelProviderDescription } from '../apps/types.js';

type ProviderRecord = ModelProviderInstanceLike & {
  description?: string;
  supportsVision?: boolean;
  supportsTools?: boolean;
};

function describeProvider(provider: ProviderRecord): ModelProviderDescription {
  return {
    id: provider.id,
    description: provider.description ?? '',
    defaultModel: provider.defaultModel ?? null,
    supportsStreaming: typeof provider.stream === 'function',
    supportsVision: provider.supportsVision ?? false,
    supportsTools: provider.supportsTools ?? false,
  };
}

export class ModelProviderRegistry {
  #providers = new Map<string, ProviderRecord>();

  register(provider: ProviderRecord): ProviderRecord {
    if (!provider?.id) {
      throw new Error('Model providers must expose an id.');
    }

    if (typeof provider.stream !== 'function' && typeof provider.generate !== 'function') {
      throw new Error('Model providers must expose stream() or generate().');
    }

    this.#providers.set(provider.id, provider);
    return provider;
  }

  get(providerId: string): ProviderRecord | null {
    return this.#providers.get(providerId) ?? null;
  }

  list(): ModelProviderDescription[] {
    return Array.from(this.#providers.values())
      .map((provider) => describeProvider(provider))
      .sort((left, right) => left.id.localeCompare(right.id));
  }
}
