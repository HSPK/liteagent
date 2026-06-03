import { access, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { parseMarkdown, stringifyMarkdown } from './markdown.js';
import type { ProtocolRecord } from '../agent/types.js';

export const DEFAULT_DIR_NAME = '.liteagents';

const AGENT_FILES = {
  nlo: 'nlo.md',
  system: 'system.md',
  memory: 'memory.md',
} as const;

export interface AgentDocument {
  /** Orchestration directives parsed from the `nlo.md` frontmatter. */
  orchestration: ProtocolRecord;
  /** High-level natural-language guidance from the `nlo.md` body. */
  nlo: string;
  /** Lowest-level rules from `system.md`. */
  system: string;
  /** Long-term, human-readable memory from `memory.md`. */
  memory: string;
}

export interface LoadedAgent extends AgentDocument {
  /** Folder name, used as the agent name. */
  name: string;
  /** Absolute path to the agent folder. */
  dir: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readFileOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, content, 'utf8');
  await rename(tempPath, path);
}

/**
 * Provides typed access to the `.liteagents/` project directory, which holds
 * the static NLO description of every agent plus runtime session state.
 */
export class LiteAgentsStore {
  readonly rootDir: string;
  readonly agentsDir: string;
  readonly sessionsDir: string;

  constructor(rootDir: string, dirName: string = DEFAULT_DIR_NAME) {
    this.rootDir = join(rootDir, dirName);
    this.agentsDir = join(this.rootDir, 'agents');
    this.sessionsDir = join(this.rootDir, 'sessions');
  }

  agentDir(name: string): string {
    return join(this.agentsDir, name);
  }

  async hasAgent(name: string): Promise<boolean> {
    return exists(this.agentDir(name));
  }

  /** List the agent names that already exist on disk. */
  async listAgentNames(): Promise<string[]> {
    if (!await exists(this.agentsDir)) {
      return [];
    }

    const entries = await readdir(this.agentsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  }

  /** Read a single agent's static NLO description from disk. */
  async readAgent(name: string): Promise<LoadedAgent> {
    const dir = this.agentDir(name);
    const [nloRaw, system, memory] = await Promise.all([
      readFileOrEmpty(join(dir, AGENT_FILES.nlo)),
      readFileOrEmpty(join(dir, AGENT_FILES.system)),
      readFileOrEmpty(join(dir, AGENT_FILES.memory)),
    ]);

    const parsedNlo = parseMarkdown(nloRaw);
    const parsedSystem = parseMarkdown(system);
    const parsedMemory = parseMarkdown(memory);

    return {
      name,
      dir,
      orchestration: parsedNlo.frontmatter,
      nlo: parsedNlo.body,
      system: parsedSystem.body,
      memory: parsedMemory.body,
    };
  }

  /** Read every agent defined on disk. */
  async readAgents(): Promise<LoadedAgent[]> {
    const names = await this.listAgentNames();
    return Promise.all(names.map((name) => this.readAgent(name)));
  }

  /** Write (or scaffold) an agent's static NLO description. */
  async writeAgent(name: string, document: Partial<AgentDocument>): Promise<void> {
    const dir = this.agentDir(name);
    await mkdir(dir, { recursive: true });

    const nlo = stringifyMarkdown({
      frontmatter: document.orchestration ?? {},
      body: document.nlo ?? '',
    });
    const system = stringifyMarkdown({ body: document.system ?? '' });
    const memory = stringifyMarkdown({ body: document.memory ?? '' });

    await Promise.all([
      writeFileAtomic(join(dir, AGENT_FILES.nlo), nlo),
      writeFileAtomic(join(dir, AGENT_FILES.system), system),
      writeFileAtomic(join(dir, AGENT_FILES.memory), memory),
    ]);
  }

  /** Persist runtime session state as JSON under `sessions/`. */
  async writeSession(sessionId: string, fileName: string, value: unknown): Promise<void> {
    const path = join(this.sessionsDir, sessionId, fileName);
    await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
  }
}
