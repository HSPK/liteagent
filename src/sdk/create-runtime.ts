import { join } from 'node:path';

import { registerBuiltinApps } from '../apps/builtin.js';
import { JsonlFileObservabilityBackend } from '../kernel/observability/jsonl-file-observability-backend.js';
import { createOpenAICompatibleProvider } from '../models/openai-compatible-provider.js';
import { AgentsRuntime } from '../runtime/runtime.js';
import { SessionDirectoryStateBackend } from '../runtime/session-directory-state-backend.js';
import type { ProtocolRecord } from '../agent/types.js';
import type { AppDefinition } from '../apps/types.js';

type AgentsRuntimeOptions = NonNullable<ConstructorParameters<typeof AgentsRuntime>[0]>;

export interface CreateRuntimeOptions extends AgentsRuntimeOptions {
  builtinApps?: boolean;
  appDefinitions?: AppDefinition[];
  sessionDir?: string | null;
  runtimeConfig?: ProtocolRecord;
  registerOpenAIProvider?: boolean;
}

export function createRuntime({
  builtinApps = true,
  appDefinitions = [],
  sessionDir = null,
  runtimeConfig = {},
  registerOpenAIProvider = false,
  ...options
}: CreateRuntimeOptions = {}): AgentsRuntime {
  const resolvedOptions: AgentsRuntimeOptions = { ...options };

  if (sessionDir) {
    resolvedOptions.stateBackend ??= new SessionDirectoryStateBackend(sessionDir, {
      runtimeConfig,
    });
    resolvedOptions.observabilityBackend ??= new JsonlFileObservabilityBackend(join(sessionDir, 'runtime', 'events.jsonl'));
  }

  const runtime = new AgentsRuntime(resolvedOptions);

  if (builtinApps) {
    registerBuiltinApps(runtime);
  }

  for (const definition of appDefinitions) {
    runtime.registerApp(definition);
  }

  if (registerOpenAIProvider && process.env.OPENAI_API_KEY && !runtime.getModelProvider('openai')) {
    runtime.registerModelProvider(createOpenAICompatibleProvider({
      defaultModel: process.env.OPENAI_MODEL ?? null,
    }));
  }

  return runtime;
}
