import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  AgentsRuntime,
  LiteAgentsStore,
  loadLiteAgents,
  parseMarkdown,
  parseOrchestration,
  registerBuiltinApps,
  stringifyMarkdown,
} from '../src/index.js';

async function makeWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'liteagents-test-'));
}

test('parseMarkdown extracts JSON frontmatter and body', () => {
  const source = '---\n{ "spawn": [{ "name": "review" }] }\n---\n\n# Title\n\nBody text.';
  const { frontmatter, body } = parseMarkdown(source);

  assert.deepEqual(frontmatter, { spawn: [{ name: 'review' }] });
  assert.equal(body, '# Title\n\nBody text.');
});

test('parseMarkdown handles documents without frontmatter', () => {
  const { frontmatter, body } = parseMarkdown('# Just a body');
  assert.deepEqual(frontmatter, {});
  assert.equal(body, '# Just a body');
});

test('stringifyMarkdown round-trips frontmatter and body', () => {
  const md = stringifyMarkdown({ frontmatter: { heartbeat: { intervalMs: 10_000 } }, body: '# Main' });
  const parsed = parseMarkdown(md);
  assert.deepEqual(parsed.frontmatter, { heartbeat: { intervalMs: 10_000 } });
  assert.equal(parsed.body, '# Main');
});

test('parseOrchestration normalizes spawn and heartbeat directives', () => {
  const orchestration = parseOrchestration({
    spawn: ['plain', { name: 'review', role: 'review' }, { role: 'no-name' }],
    heartbeat: { intervalMs: 10_000 },
    installedApps: ['system.todo'],
  });

  assert.deepEqual(orchestration.spawn, [
    { name: 'plain' },
    { name: 'review', role: 'review', system: undefined, nlo: undefined, installedApps: [] },
  ]);
  assert.deepEqual(orchestration.heartbeat, { intervalMs: 10_000, payload: undefined });
  assert.deepEqual(orchestration.installedApps, ['system.todo']);
});

test('loadLiteAgents scaffolds a default main agent and spawns children', async () => {
  const workspace = await makeWorkspace();
  try {
    const runtime = registerBuiltinApps(new AgentsRuntime());
    const handle = await loadLiteAgents(runtime, { rootDir: workspace, startHeartbeat: false });

    assert.deepEqual(handle.agentNames, ['main', 'review', 'tool-call-check']);
    assert.deepEqual(handle.spawned.main.sort(), ['review', 'tool-call-check']);
    assert.deepEqual(handle.heartbeatAgents, ['main']);

    // The spawned agents were persisted as static NLO descriptions.
    const store = new LiteAgentsStore(workspace);
    assert.deepEqual((await store.listAgentNames()).sort(), ['main', 'review', 'tool-call-check']);
    const review = await store.readAgent('review');
    assert.match(review.system, /review/i);

    handle.stop();
    runtime.dispose();
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('loadLiteAgents delivers heartbeat alarms to the main agent', async () => {
  const workspace = await makeWorkspace();
  try {
    const runtime = registerBuiltinApps(new AgentsRuntime());
    const handle = await loadLiteAgents(runtime, { rootDir: workspace, startHeartbeat: false });

    handle.triggerHeartbeat('main');
    handle.triggerHeartbeat('main');
    await runtime.whenIdle();

    const memory = runtime.getAgent('main')!.snapshotMemory();
    assert.equal(memory.agent['orchestrator:heartbeatCount'], 2);
    assert.equal((memory.agent['orchestrator:lastHeartbeat'] as { count: number }).count, 2);

    handle.stop();
    runtime.dispose();
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('loadLiteAgents drives heartbeats through an injected interval scheduler', async () => {
  const workspace = await makeWorkspace();
  try {
    const runtime = registerBuiltinApps(new AgentsRuntime());
    let tick: (() => void) | null = null;

    const handle = await loadLiteAgents(runtime, {
      rootDir: workspace,
      scheduleInterval: (callback) => {
        tick = callback;
        return { clear: () => { tick = null; } };
      },
    });

    assert.equal(typeof tick, 'function');
    tick!();
    await runtime.whenIdle();

    const memory = runtime.getAgent('main')!.snapshotMemory();
    assert.equal(memory.agent['orchestrator:heartbeatCount'], 1);

    handle.stop();
    assert.equal(tick, null);
    runtime.dispose();
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('loadLiteAgents loads an existing on-disk agent definition', async () => {
  const workspace = await makeWorkspace();
  try {
    const store = new LiteAgentsStore(workspace);
    await store.writeAgent('main', {
      orchestration: { spawn: [{ name: 'review', role: 'review' }], heartbeat: { intervalMs: 5_000 } },
      nlo: '# Custom main',
      system: 'Custom system rules.',
      memory: '# Memory',
    });

    const runtime = registerBuiltinApps(new AgentsRuntime());
    const handle = await loadLiteAgents(runtime, { rootDir: workspace, startHeartbeat: false, scaffoldIfEmpty: false });

    assert.deepEqual(handle.agentNames, ['main', 'review']);
    assert.deepEqual(handle.spawned.main, ['review']);

    const reloaded = await store.readAgent('main');
    assert.equal(reloaded.system, 'Custom system rules.');
    assert.equal(reloaded.nlo, '# Custom main');

    handle.stop();
    runtime.dispose();
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
