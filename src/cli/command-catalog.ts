export interface CliCommandDefinition {
  name: string;
  aliases?: string[];
  args?: string;
  summary?: string;
}

export const CLI_COMMANDS = [
  { name: 'help', summary: 'Show the command reference' },
  { name: 'list', aliases: ['agents'], summary: 'List created agents' },
  { name: 'create', args: '<agentId> [appId ...]', summary: 'Create a new agent' },
  { name: 'inspect', args: '<agentId>', summary: 'Inspect an agent' },
  { name: 'memory', args: '<agentId>', summary: 'Inspect agent memory' },
  { name: 'registry', summary: 'List available app definitions' },
  { name: 'apps', args: '<agentId>', summary: 'List apps installed on an agent' },
  { name: 'install', args: '<agentId> <appId>', summary: 'Install an app on an agent' },
  { name: 'event', args: '<agentId> <type> [jsonPayload] [--app <appId>]', summary: 'Send an event into the runtime' },
  { name: 'message', args: '<from> <to> <type> [jsonPayload] [--app <appId>]', summary: 'Send an agent-to-agent message' },
  { name: 'wait', summary: 'Wait until the runtime is idle' },
  { name: 'exit', aliases: ['quit'], summary: 'Exit the console' },
] as const satisfies readonly CliCommandDefinition[];

export type CliCommandName = (typeof CLI_COMMANDS)[number]['name'];

function stripCommandPrefix(input: string): string {
  return input.startsWith('/') ? input.slice(1) : input;
}

function expandCommandNames(definition: CliCommandDefinition): string[] {
  return [definition.name, ...(definition.aliases ?? [])];
}

const COMMAND_LOOKUP = new Map(
  CLI_COMMANDS.flatMap((definition) =>
    expandCommandNames(definition).map((name) => [name, definition] as const)),
);

export const SLASH_COMMANDS = CLI_COMMANDS.flatMap((definition) => expandCommandNames(definition));

export function resolveCliCommand(input: string): CliCommandDefinition | null {
  const normalized = stripCommandPrefix(input.trim());
  if (!normalized) {
    return null;
  }

  return COMMAND_LOOKUP.get(normalized) ?? null;
}

export function formatCliCommandUsage(command: CliCommandDefinition | CliCommandName | string): string {
  const definition = typeof command === 'string'
    ? resolveCliCommand(command)
    : command;
  const fallback = stripCommandPrefix(typeof command === 'string' ? command : command.name);

  if (!definition) {
    return `/${fallback}`;
  }

  const names = expandCommandNames(definition).map((name) => `/${name}`).join(' | ');
  return definition.args ? `${names} ${definition.args}` : names;
}

export function buildCliHelpText(): string {
  const commandLines = CLI_COMMANDS
    .map((definition) => {
      const usage = formatCliCommandUsage(definition);
      return definition.summary
        ? `  ${usage}\n      ${definition.summary}`
        : `  ${usage}`;
    })
    .join('\n');

  return `agents runtime console

Chat:
  - Plain text is broadcast to all created agents.
  - Replies from each agent are rendered in the content area.

Slash commands:
${commandLines}

Notes:
  - The CLI bootstraps a default assistant agent so plain text can go straight into a conversation.
  - New agents created from the generic controller still default to domain.echo when no app is given.
  - In the Ink UI, use the mouse wheel or PgUp/PgDn to scroll the history area.
  - JSON payloads should be quoted when they contain spaces.
  - Press Tab to complete slash commands.
`;
}
