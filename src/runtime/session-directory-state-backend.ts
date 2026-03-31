import { access, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AgentStateSnapshot, ProtocolRecord } from '../agent/types.js';
import type { RuntimeSnapshot } from './types.js';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tempPath, path);
}

function sortAgentSnapshots(snapshot: RuntimeSnapshot = { version: 1, agents: [] }): AgentStateSnapshot[] {
  return snapshot.agents.slice().sort((left, right) => left.agentId.localeCompare(right.agentId));
}

export class SessionDirectoryStateBackend {
  sessionDir: string;
  runtimeConfig: ProtocolRecord;

  constructor(sessionDir: string, { runtimeConfig = {} }: { runtimeConfig?: ProtocolRecord } = {}) {
    this.sessionDir = sessionDir;
    this.runtimeConfig = structuredClone(runtimeConfig);
  }

  async save(snapshot: RuntimeSnapshot): Promise<void> {
    const runtimeDir = join(this.sessionDir, 'runtime');
    const agentsDir = join(this.sessionDir, 'agents');
    const agentSnapshots = sortAgentSnapshots(snapshot);

    await mkdir(runtimeDir, { recursive: true });
    await mkdir(agentsDir, { recursive: true });

    await writeJsonAtomic(join(runtimeDir, 'state.json'), snapshot);
    await writeJsonAtomic(join(runtimeDir, 'config.json'), {
      version: 1,
      updatedAt: Date.now(),
      agentIds: agentSnapshots.map((agent) => agent.agentId),
      ...this.runtimeConfig,
    });

    const activeAgentFiles = new Set();
    for (const agentSnapshot of agentSnapshots) {
      const fileName = `${agentSnapshot.agentId}.json`;
      activeAgentFiles.add(fileName);
      await writeJsonAtomic(join(agentsDir, fileName), agentSnapshot);
    }

    const existingAgentFiles = await readdir(agentsDir).catch(() => [] as string[]);
    await Promise.all(existingAgentFiles
      .filter((fileName) => fileName.endsWith('.json') && !activeAgentFiles.has(fileName))
      .map((fileName) => unlink(join(agentsDir, fileName)).catch(() => {})));
  }

  async load(): Promise<RuntimeSnapshot> {
    const statePath = join(this.sessionDir, 'runtime', 'state.json');
    if (!await exists(statePath)) {
      return {
        version: 1,
        createdAt: Date.now(),
        agents: [],
      };
    }

    const raw = await readFile(statePath, 'utf8');
    return JSON.parse(raw) as RuntimeSnapshot;
  }
}
