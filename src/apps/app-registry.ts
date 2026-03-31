import type { AppDefinition, AppDefinitionSummary, AppLike } from './types.js';

export class AppRegistry {
  #definitions = new Map<string, AppDefinition>();

  register(definition: AppDefinition): AppDefinition {
    if (!definition?.manifest?.id || typeof definition.create !== 'function') {
      throw new Error('App definitions must expose manifest.id and create().');
    }

    this.#definitions.set(definition.manifest.id, definition);
    return definition;
  }

  get(appId: string): AppDefinition | null {
    return this.#definitions.get(appId) ?? null;
  }

  create(appId: string): AppLike {
    const definition = this.get(appId);

    if (!definition) {
      throw new Error(`Unknown app definition: ${appId}`);
    }

    return definition.create();
  }

  list(): AppDefinitionSummary[] {
    return Array.from(this.#definitions.values())
      .map((definition) => ({
        manifest: structuredClone(definition.manifest),
        provenance: definition.provenance ?? 'local',
      }))
      .sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));
  }
}
