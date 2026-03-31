export { SLASH_COMMANDS } from './command-catalog.js';
import { SLASH_COMMANDS } from './command-catalog.js';

function longestCommonPrefix(values: string[]): string {
  if (values.length === 0) {
    return '';
  }

  let prefix = values[0];

  for (const value of values.slice(1)) {
    while (!value.startsWith(prefix) && prefix.length > 0) {
      prefix = prefix.slice(0, -1);
    }
  }

  return prefix;
}

export function normalizeSlashCommand(line: string): string {
  return line.startsWith('/') ? line.slice(1) : line;
}

export function listSlashCommandMatches(input: string): string[] {
  const raw = input.startsWith('/') ? input.slice(1) : input;
  const token = raw.split(/\s+/)[0] ?? '';

  return SLASH_COMMANDS.filter((command) => command.startsWith(token));
}

export function completeSlashCommand(input: string): { input: string; matches: string[]; completed: boolean } {
  if (!input.startsWith('/')) {
    return {
      input,
      matches: [],
      completed: false,
    };
  }

  const raw = input.slice(1);
  if (/\s/.test(raw)) {
    return {
      input,
      matches: [],
      completed: false,
    };
  }

  const matches = listSlashCommandMatches(input);
  if (matches.length === 0) {
    return {
      input,
      matches,
      completed: false,
    };
  }

  if (matches.length === 1) {
    return {
      input: `/${matches[0]} `,
      matches,
      completed: true,
    };
  }

  const prefix = longestCommonPrefix(matches);
  return {
    input: `/${prefix}`,
    matches,
    completed: prefix.length > raw.length,
  };
}
