import { parseCommandLine } from './command-parser.js';
import { buildCliHelpText, resolveCliCommand } from './command-catalog.js';
import { normalizeSlashCommand } from './slash-commands.js';
import type {
  CliEntry,
  ConsoleReply,
  RuntimeControllerCommandResult,
  RuntimeControllerLike,
} from './types.js';

export const HELP_TEXT = buildCliHelpText();
export const WELCOME_TEXT = 'Agents CLI ready.\nChat below, or type /help for commands.';

export function isExitInput(line: string): boolean {
  return resolveCliCommand(line)?.name === 'exit';
}

export function formatResult(result: RuntimeControllerCommandResult): string {
  if (
    result
    && typeof result === 'object'
    && 'type' in result
    && result.type === 'help'
  ) {
    return HELP_TEXT;
  }

  if (typeof result === 'string') {
    return result;
  }

  return JSON.stringify(result, null, 2);
}

export function formatReply(reply: ConsoleReply): string {
  if (reply.result && typeof reply.result === 'object' && 'text' in reply.result) {
    return String(reply.result.text);
  }

  if (typeof reply.result === 'string') {
    return reply.result;
  }

  if (reply.result === null) {
    return '(no reply)';
  }

  return JSON.stringify(reply.result, null, 2);
}

export function createPromptEntry(line: string): CliEntry {
  return line.startsWith('/')
    ? { kind: 'command', text: line }
    : { kind: 'user', author: 'You', text: line };
}

export function formatEntryText(entry: CliEntry): string {
  if (!entry.author) {
    return entry.text;
  }

  const lines = String(entry.text).split('\n');
  return lines
    .map((line, index) => (index === 0 ? `${entry.author}: ${line}` : line))
    .join('\n');
}

export function flattenEntries(entries: CliEntry[]): CliEntry[] {
  return entries.flatMap((entry) =>
    formatEntryText(entry).split('\n').map((line) => ({
      kind: entry.kind,
      text: line,
    })),
  );
}

export async function executeConsoleInput(controller: RuntimeControllerLike, line: string): Promise<CliEntry[]> {
  if (line.startsWith('/')) {
    const parsed = parseCommandLine(normalizeSlashCommand(line));
    if (!parsed) {
      return [];
    }

    const result = await controller.execute(parsed);
    return [{ kind: 'system', text: formatResult(result) }];
  }

  const chat = typeof controller.chatText === 'function'
    ? await controller.chatText(line)
    : await controller.broadcastText(line);
  if (chat.replies.length === 0) {
    return [{ kind: 'system', text: 'System: no agents available.' }];
  }

  const renderedReplies = chat.replies.filter((reply) => !reply.renderedBySubscription);
  if (renderedReplies.length === 0 && chat.replies.length > 0) {
    return [];
  }

  return renderedReplies.map((reply) => ({
    kind: 'agent',
    author: reply.agentId,
    text: formatReply(reply),
  }));
}
