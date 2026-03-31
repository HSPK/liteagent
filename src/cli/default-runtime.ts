import { homedir } from 'node:os';
import { join } from 'node:path';

import { createRuntime } from '../sdk/create-runtime.js';
import { createDefaultRuntimeTools } from '../runtime/default-runtime-tools.js';
import type { ProtocolRecord } from '../agent/types.js';

export const DEFAULT_ASSISTANT_AGENT_ID = 'assistant';
export const DEFAULT_ASSISTANT_APPS = [
  'domain.assistant',
  'system.app-manager',
  'system.planner',
  'system.todo',
];

/** @returns {string} */
export function defaultCliSessionDir() {
  return join(homedir(), '.agents');
}

export interface CreateCliRuntimeOptions {
  sessionDir?: string;
  workspaceDir?: string;
}

export function createCliRuntime({
  sessionDir = defaultCliSessionDir(),
  workspaceDir = process.cwd(),
}: CreateCliRuntimeOptions = {}) {
  const defaultTools = createDefaultRuntimeTools({ workspaceDir });
  const runtimeConfig: ProtocolRecord = {
    mode: 'cli',
    workspaceDir,
    defaultAssistantId: DEFAULT_ASSISTANT_AGENT_ID,
    defaultInstalledApps: DEFAULT_ASSISTANT_APPS,
    defaultToolNames: defaultTools.map((tool) => tool.name),
  };

  return createRuntime({
    sessionDir,
    registerOpenAIProvider: true,
    defaultInstalledApps: DEFAULT_ASSISTANT_APPS,
    defaultTools,
    runtimeConfig,
  });
}
