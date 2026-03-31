import type { ParsedCommand } from './types.js';

export function tokenizeCommandLine(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: string | null = null;
  let escape = false;

  for (const character of line.trim()) {
    if (escape) {
      current += character;
      escape = false;
      continue;
    }

    if (character === '\\') {
      escape = true;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += character;
  }

  if (quote) {
    throw new Error('Unterminated quoted string.');
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

export function parseCommandLine(line: string): ParsedCommand | null {
  const tokens = tokenizeCommandLine(line);

  if (tokens.length === 0) {
    return null;
  }

  const command = tokens.shift();
  if (!command) {
    return null;
  }
  const args: string[] = [];
  const options: ParsedCommand['options'] = {};

  while (tokens.length > 0) {
    const token = tokens.shift();
    if (token === undefined) {
      continue;
    }

    if (token === '--app') {
      options.appId = tokens.shift() ?? null;
      if (!options.appId) {
        throw new Error('Missing value for --app.');
      }
      continue;
    }

    args.push(token);
  }

  return {
    command,
    args,
    options,
  };
}
