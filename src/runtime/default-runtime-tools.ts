import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname, resolve, relative } from 'node:path';
import type { ToolDefinition, UnknownRecord } from '../agent/types.js';

const execFile = promisify(execFileCallback);

type RuntimeToolDefinition = ToolDefinition;

interface CommandExecInput {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  maxBuffer?: number;
}

interface FileReadInput {
  path: string;
  encoding?: BufferEncoding;
}

interface FileWriteInput {
  path: string;
  content: string;
  encoding?: BufferEncoding;
}

interface FileListInput {
  path?: string;
}

interface FileStatInput {
  path: string;
}

interface FetchUrlInput {
  url: string | URL;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

interface WebSearchInput {
  query: string;
  limit?: number;
}

function resolveWorkspacePath(workspaceDir: string, inputPath = '.'): string {
  const resolvedWorkspace = resolve(workspaceDir);
  const resolvedPath = resolve(resolvedWorkspace, inputPath);
  const relativePath = relative(resolvedWorkspace, resolvedPath);

  if (relativePath.startsWith('..') || relativePath.includes(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error(`Path escapes the workspace: ${inputPath}`);
  }

  return resolvedPath;
}

async function executeCommand(input: CommandExecInput, workspaceDir: string): Promise<{
  cwd: string;
  stdout: string;
  stderr: string;
}> {
  const cwd = resolveWorkspacePath(workspaceDir, input.cwd ?? '.');
  const { stdout, stderr } = await execFile('bash', ['-lc', input.command], {
    cwd,
    timeout: input.timeoutMs ?? 30_000,
    maxBuffer: input.maxBuffer ?? 1024 * 1024,
  });

  return {
    cwd,
    stdout,
    stderr,
  };
}

async function readWorkspaceFile(input: FileReadInput, workspaceDir: string): Promise<{
  path: string;
  content: string;
}> {
  const path = resolveWorkspacePath(workspaceDir, input.path);
  const content = await readFile(path, input.encoding ?? 'utf8');
  return {
    path,
    content,
  };
}

async function writeWorkspaceFile(input: FileWriteInput, workspaceDir: string): Promise<{
  path: string;
  bytesWritten: number;
}> {
  const path = resolveWorkspacePath(workspaceDir, input.path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, input.content ?? '', input.encoding ?? 'utf8');
  return {
    path,
    bytesWritten: Buffer.byteLength(input.content ?? '', input.encoding ?? 'utf8'),
  };
}

async function listWorkspaceEntries(input: FileListInput, workspaceDir: string): Promise<{
  path: string;
  entries: Array<{ name: string; type: string }>;
}> {
  const path = resolveWorkspacePath(workspaceDir, input.path ?? '.');
  const entries = await readdir(path, { withFileTypes: true });
  return {
    path,
    entries: entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory()
        ? 'directory'
        : entry.isFile()
          ? 'file'
          : entry.isSymbolicLink()
            ? 'symlink'
            : 'other',
    })),
  };
}

async function inspectWorkspacePath(input: FileStatInput, workspaceDir: string): Promise<{
  path: string;
  type: string;
  size: number;
  modifiedAt: number;
}> {
  const path = resolveWorkspacePath(workspaceDir, input.path);
  const details = await stat(path);
  return {
    path,
    type: details.isDirectory() ? 'directory' : details.isFile() ? 'file' : 'other',
    size: details.size,
    modifiedAt: details.mtimeMs,
  };
}

async function fetchUrl(
  input: FetchUrlInput,
  fetchImpl: typeof globalThis.fetch | undefined,
): Promise<{
  url: string | URL;
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  text: string;
}> {
  if (typeof fetchImpl !== 'function') {
    throw new Error('web.fetch requires a fetch implementation.');
  }

  const response = await fetchImpl(input.url, {
    method: input.method ?? 'GET',
    headers: input.headers ?? {},
    body: input.body ?? undefined,
  });
  const text = await response.text();
  return {
    url: input.url,
    status: response.status,
    ok: response.ok,
    headers: Object.fromEntries(response.headers.entries()),
    text,
  };
}

async function searchWeb(
  input: WebSearchInput,
  fetchImpl: typeof globalThis.fetch | undefined,
): Promise<{
  query: string;
  heading: string;
  abstract: string;
  abstractUrl: string;
  related: Array<{ text: string; firstUrl: string }>;
}> {
  if (typeof fetchImpl !== 'function') {
    throw new Error('web.search requires a fetch implementation.');
  }

  const query = input.query?.trim();
  if (!query) {
    throw new Error('web.search requires a query.');
  }

  const url = new URL('https://api.duckduckgo.com/');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('no_redirect', '1');
  url.searchParams.set('no_html', '1');

  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`web.search failed (${response.status})`);
  }

  const body = await response.json();
  const payload = body as UnknownRecord & {
    RelatedTopics?: unknown[];
    Heading?: string;
    AbstractText?: string;
    AbstractURL?: string;
  };
  const related = Array.isArray(payload.RelatedTopics)
    ? payload.RelatedTopics.flatMap((entry) => {
      const topicEntry = entry as UnknownRecord & { Topics?: unknown[] };
      if (Array.isArray(topicEntry.Topics)) {
        return topicEntry.Topics;
      }
      return [entry];
    })
    : [];

  return {
    query,
    heading: typeof payload.Heading === 'string' ? payload.Heading : '',
    abstract: typeof payload.AbstractText === 'string' ? payload.AbstractText : '',
    abstractUrl: typeof payload.AbstractURL === 'string' ? payload.AbstractURL : '',
    related: related
      .slice(0, input.limit ?? 5)
      .map((entry) => ({
        text: typeof (entry as UnknownRecord).Text === 'string' ? ((entry as UnknownRecord).Text as string) : '',
        firstUrl: typeof (entry as UnknownRecord).FirstURL === 'string' ? ((entry as UnknownRecord).FirstURL as string) : '',
      })),
  };
}

export function createDefaultRuntimeTools({
  workspaceDir = process.cwd(),
  fetchImpl = globalThis.fetch,
}: {
  workspaceDir?: string;
  fetchImpl?: typeof globalThis.fetch;
} = {}): RuntimeToolDefinition[] {
  return [
    {
      name: 'command.exec',
      description: 'Execute a shell command inside the runtime workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          cwd: { type: 'string' },
          timeoutMs: { type: 'number' },
        },
        required: ['command'],
        additionalProperties: false,
      },
      async execute(input) {
        return executeCommand(input as CommandExecInput, workspaceDir);
      },
    },
    {
      name: 'file.read',
      description: 'Read a text file from the runtime workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          encoding: { type: 'string' },
        },
        required: ['path'],
        additionalProperties: false,
      },
      async execute(input) {
        return readWorkspaceFile(input as FileReadInput, workspaceDir);
      },
    },
    {
      name: 'file.write',
      description: 'Write a text file inside the runtime workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
          encoding: { type: 'string' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
      async execute(input) {
        return writeWorkspaceFile(input as FileWriteInput, workspaceDir);
      },
    },
    {
      name: 'file.list',
      description: 'List files and directories inside the runtime workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        additionalProperties: false,
      },
      async execute(input) {
        return listWorkspaceEntries(input as FileListInput, workspaceDir);
      },
    },
    {
      name: 'file.stat',
      description: 'Inspect a file or directory in the runtime workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
        additionalProperties: false,
      },
      async execute(input) {
        return inspectWorkspacePath(input as FileStatInput, workspaceDir);
      },
    },
    {
      name: 'web.fetch',
      description: 'Fetch the contents of a URL over HTTP.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          method: { type: 'string' },
          headers: { type: 'object' },
          body: { type: 'string' },
        },
        required: ['url'],
        additionalProperties: false,
      },
      async execute(input) {
        return fetchUrl(input as FetchUrlInput, fetchImpl);
      },
    },
    {
      name: 'web.search',
      description: 'Run a lightweight web search using DuckDuckGo Instant Answer.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      async execute(input) {
        return searchWeb(input as WebSearchInput, fetchImpl);
      },
    },
  ];
}
