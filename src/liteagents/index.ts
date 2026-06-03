import { LiteAgentsStore, DEFAULT_DIR_NAME } from './store.js';
import { ORCHESTRATOR_APP_ID } from '../apps/system/orchestrator-app.js';
import type { AgentsRuntime } from '../runtime/runtime.js';
import type { LoadedAgent } from './store.js';
import type { ProtocolRecord, ProtocolValue, SignalLike } from '../agent/types.js';

/** A request, declared in `nlo.md`, to spawn a child agent on startup. */
export interface SpawnDirective {
  name: string;
  role?: string;
  system?: string;
  nlo?: string;
  installedApps?: string[];
}

/** A request, declared in `nlo.md`, for a recurring runtime heartbeat alarm. */
export interface HeartbeatDirective {
  intervalMs: number;
  payload?: ProtocolRecord;
}

export interface Orchestration {
  spawn: SpawnDirective[];
  heartbeat: HeartbeatDirective | null;
  installedApps: string[];
}

/** Minimal interval abstraction so heartbeats are easy to drive in tests. */
export interface IntervalHandle {
  clear: () => void;
}

export type IntervalScheduler = (callback: () => void, intervalMs: number) => IntervalHandle;

export interface LoadLiteAgentsOptions {
  /** Project root that contains the `.liteagents/` directory. Defaults to `process.cwd()`. */
  rootDir?: string;
  /** Directory name to load. Defaults to `.liteagents`. */
  dirName?: string;
  /** When no agents exist on disk, scaffold a default `main` agent. Defaults to `true`. */
  scaffoldIfEmpty?: boolean;
  /** Start heartbeat timers immediately. Defaults to `true`. */
  startHeartbeat?: boolean;
  /** Inject a custom interval scheduler (used by tests). */
  scheduleInterval?: IntervalScheduler;
}

export interface LiteAgentsHandle {
  store: LiteAgentsStore;
  rootDir: string;
  /** Names of every agent created in the runtime. */
  agentNames: string[];
  /** Map of parent agent name to the child agent names it spawned. */
  spawned: Record<string, string[]>;
  /** Names of agents wired to a recurring heartbeat. */
  heartbeatAgents: string[];
  /** Deliver a single heartbeat alarm to an agent (used by tests). */
  triggerHeartbeat: (name: string) => SignalLike | null;
  /** Stop all heartbeat timers. */
  stop: () => void;
}

const HEARTBEAT_TYPE = 'heartbeat';

function defaultScheduleInterval(callback: () => void, intervalMs: number): IntervalHandle {
  const handle = setInterval(callback, intervalMs);
  handle.unref?.();
  return { clear: () => clearInterval(handle) };
}

function asRecord(value: ProtocolValue | undefined): ProtocolRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as ProtocolRecord) : null;
}

function asString(value: ProtocolValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asStringArray(value: ProtocolValue | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function parseSpawnDirective(value: ProtocolValue): SpawnDirective | null {
  if (typeof value === 'string') {
    return { name: value };
  }

  const record = asRecord(value);
  const name = asString(record?.name);
  if (!record || !name) {
    return null;
  }

  return {
    name,
    role: asString(record.role),
    system: asString(record.system),
    nlo: asString(record.nlo),
    installedApps: asStringArray(record.installedApps),
  };
}

function parseHeartbeat(value: ProtocolValue | undefined): HeartbeatDirective | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const intervalMs = record.intervalMs;
  if (typeof intervalMs !== 'number' || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    return null;
  }

  return {
    intervalMs,
    payload: asRecord(record.payload) ?? undefined,
  };
}

/** Normalize the raw `nlo.md` frontmatter into a typed orchestration plan. */
export function parseOrchestration(frontmatter: ProtocolRecord): Orchestration {
  const spawnRaw = Array.isArray(frontmatter.spawn) ? frontmatter.spawn : [];
  const spawn = spawnRaw
    .map((entry) => parseSpawnDirective(entry))
    .filter((entry): entry is SpawnDirective => entry !== null);

  return {
    spawn,
    heartbeat: parseHeartbeat(frontmatter.heartbeat),
    installedApps: asStringArray(frontmatter.installedApps),
  };
}

function defaultMainAgent(): { orchestration: ProtocolRecord; nlo: string; system: string; memory: string } {
  return {
    orchestration: {
      spawn: [
        { name: 'review', role: 'review', system: 'You review the output of other agents and flag issues.' },
        { name: 'tool-call-check', role: 'tool-call-check', system: 'You validate tool calls before they run.' },
      ],
      heartbeat: { intervalMs: 10_000 },
    },
    nlo: [
      '# Main agent',
      '',
      'On startup, create a `review` agent and a `tool-call-check` agent, then rely on a',
      'runtime heartbeat alarm every 10 seconds to stay alive and coordinate work.',
    ].join('\n'),
    system: 'You are the main orchestrator agent for this project.',
    memory: '# Memory\n\n(Long-term notes accumulate here.)',
  };
}

/**
 * Boot a runtime from a project's `.liteagents/` directory.
 *
 * This implements the minimal NLO orchestration: each on-disk agent is created,
 * its `nlo.md` `spawn` directives create child agents (scaffolding their static
 * description when missing), and `heartbeat` directives wire a recurring
 * runtime-delivered alarm.
 */
export async function loadLiteAgents(
  runtime: AgentsRuntime,
  options: LoadLiteAgentsOptions = {},
): Promise<LiteAgentsHandle> {
  const {
    rootDir = process.cwd(),
    dirName = DEFAULT_DIR_NAME,
    scaffoldIfEmpty = true,
    startHeartbeat = true,
    scheduleInterval = defaultScheduleInterval,
  } = options;

  const store = new LiteAgentsStore(rootDir, dirName);

  let diskAgents = await store.readAgents();
  if (diskAgents.length === 0 && scaffoldIfEmpty) {
    await store.writeAgent('main', defaultMainAgent());
    diskAgents = await store.readAgents();
  }

  const created = new Set<string>();
  const spawned: Record<string, string[]> = {};
  const heartbeatAgents: string[] = [];
  const intervals: IntervalHandle[] = [];

  const ensureAgent = async (name: string, installedApps: string[]): Promise<void> => {
    if (created.has(name)) {
      return;
    }
    await runtime.createAgent({
      id: name,
      installedApps: Array.from(new Set([ORCHESTRATOR_APP_ID, ...installedApps])),
    });
    created.add(name);
  };

  const deliverHeartbeat = (name: string, payload: ProtocolRecord | undefined): SignalLike | null => {
    if (!runtime.getAgent(name)) {
      return null;
    }
    return runtime.ingestEvent({
      to: name,
      type: HEARTBEAT_TYPE,
      targetAppId: ORCHESTRATOR_APP_ID,
      payload: payload ?? null,
    });
  };

  // First create every agent that already exists on disk.
  for (const agent of diskAgents) {
    const orchestration = parseOrchestration(agent.orchestration);
    await ensureAgent(agent.name, orchestration.installedApps);
  }

  // Then process each agent's orchestration directives.
  for (const agent of diskAgents) {
    const orchestration = parseOrchestration(agent.orchestration);

    for (const directive of orchestration.spawn) {
      if (!created.has(directive.name) && !await store.hasAgent(directive.name)) {
        await store.writeAgent(directive.name, {
          orchestration: {},
          nlo: directive.nlo ?? `# ${directive.name}\n\nSpawned by \`${agent.name}\`.`,
          system: directive.system ?? `You are the ${directive.role ?? directive.name} agent.`,
          memory: '# Memory\n',
        });
      }
      await ensureAgent(directive.name, directive.installedApps ?? []);
      (spawned[agent.name] ??= []).push(directive.name);
    }

    if (orchestration.heartbeat) {
      const { intervalMs, payload } = orchestration.heartbeat;
      heartbeatAgents.push(agent.name);
      if (startHeartbeat) {
        intervals.push(scheduleInterval(() => {
          deliverHeartbeat(agent.name, payload);
        }, intervalMs));
      }
    }
  }

  return {
    store,
    rootDir: store.rootDir,
    agentNames: Array.from(created).sort(),
    spawned,
    heartbeatAgents,
    triggerHeartbeat: (name: string) => deliverHeartbeat(name, undefined),
    stop: () => {
      for (const interval of intervals) {
        interval.clear();
      }
      intervals.length = 0;
    },
  };
}

// Re-export so the loaded helpers are easy to consume alongside the loader.
export type { LoadedAgent };
