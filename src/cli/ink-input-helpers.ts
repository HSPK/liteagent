import { formatCliCommandUsage, resolveCliCommand } from './command-catalog.js';
import { listSlashCommandMatches } from './slash-commands.js';
import type { InputFrame, InputFrameRequest, InputHintOptions } from './types.js';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function normalizeTerminalInput(input: Buffer | string | null | undefined): string {
  return typeof input === 'string'
    ? input
    : Buffer.isBuffer(input)
      ? input.toString('utf8')
      : String(input ?? '');
}

export function extractMouseScrollDelta(input: Buffer | string | null | undefined, step = 3): number {
  const text = normalizeTerminalInput(input);
  const matcher = /\x1b\[<(\d+);(\d+);(\d+)([mM])/g;
  let delta = 0;
  let match = matcher.exec(text);

  while (match) {
    const code = Number(match[1]);
    if (code === 64) {
      delta += step;
    } else if (code === 65) {
      delta -= step;
    }
    match = matcher.exec(text);
  }

  return delta;
}

export function isMouseInputSequence(input: Buffer | string | null | undefined): boolean {
  return /\x1b\[<\d+;\d+;\d+[mM]/.test(normalizeTerminalInput(input));
}

export function consumeSuppressedTerminalInput(
  pendingInput: string,
  input: Buffer | string | null | undefined,
): { consumed: boolean; pendingInput: string } {
  const pending = pendingInput ?? '';
  const text = normalizeTerminalInput(input);
  if (!pending || !text) {
    return {
      consumed: false,
      pendingInput: pending,
    };
  }

  if (pending.startsWith(text)) {
    return {
      consumed: true,
      pendingInput: pending.slice(text.length),
    };
  }

  const index = pending.indexOf(text);
  if (index >= 0) {
    return {
      consumed: true,
      pendingInput: pending.slice(index + text.length),
    };
  }

  return {
    consumed: false,
    pendingInput: pending.length > 128 ? '' : pending,
  };
}

export function buildInputHint(inputBuffer: string, { busy = false }: InputHintOptions = {}): string {
  if (busy) {
    return 'waiting…';
  }

  if (inputBuffer.startsWith('/')) {
    return 'tab to complete';
  }

  return 'message or /help';
}

export function buildSlashCommandMenu(
  inputBuffer: string,
  { maxItems = 4, width = 80 }: { maxItems?: number; width?: number } = {},
): string[] {
  if (!inputBuffer.startsWith('/')) {
    return [];
  }

  const matches = listSlashCommandMatches(inputBuffer).slice(0, Math.max(1, maxItems));
  if (matches.length === 0) {
    return ['no matching command'];
  }

  return matches.map((command) => {
    const definition = resolveCliCommand(command);
    const usage = formatCliCommandUsage(definition ?? command);
    const summary = definition?.summary ? `  ${definition.summary}` : '';
    return truncateText(`${usage}${summary}`, Math.max(16, width));
  });
}

export function buildStatusLine({
  agentCount,
  registryCount,
  busy = false,
  scrollOffset = 0,
}: {
  agentCount: number;
  registryCount: number;
  busy?: boolean;
  scrollOffset?: number;
}): string {
  const state = busy
    ? '● running'
    : scrollOffset > 0
      ? `↑ +${scrollOffset} lines`
      : 'live';

  return `liteagent  ·  ${agentCount} agents  ·  ${registryCount} apps  ·  ${state}`;
}

export function buildComposerFooter({
  busy = false,
  slashMode = false,
}: {
  busy?: boolean;
  slashMode?: boolean;
} = {}): string {
  if (busy) {
    return '↑↓ scroll  ·  streaming in progress';
  }

  if (slashMode) {
    return 'enter  run  ·  tab  complete  ·  esc  clear';
  }

  return '↑↓  history  ·  tab  complete  ·  pgup/dn  scroll';
}

export function truncateText(text: string, maxWidth: number): string {
  if (maxWidth <= 0) {
    return '';
  }

  if (text.length <= maxWidth) {
    return text.padEnd(maxWidth, ' ');
  }

  if (maxWidth === 1) {
    return '…';
  }

  return `${text.slice(0, maxWidth - 1)}…`;
}

export function buildInputFrame({
  columns,
  inputBuffer,
  cursorIndex,
  cursorCharacter,
  hint,
  footerText,
  busy,
  promptLabel,
}: InputFrameRequest): InputFrame {
  const innerWidth = Math.max(16, columns);
  const top = buildRuleLine(promptLabel, innerWidth);
  const content = buildComposerViewport({
    inputBuffer,
    cursorIndex,
    cursorCharacter,
    hint,
    width: innerWidth,
  });
  const footer = truncateText(footerText, innerWidth);

  return {
    top,
    middle: content,
    bottom: footer,
  };
}

function buildComposerViewport({
  inputBuffer,
  cursorIndex,
  cursorCharacter,
  hint,
  width,
}: {
  inputBuffer: string;
  cursorIndex: number;
  cursorCharacter: string;
  hint: string;
  width: number;
}): string {
  // Show hint inline when buffer is empty; suppress when typing
  const suffix = inputBuffer.length === 0 ? `  ${hint}` : '';
  const raw = `› ${inputBuffer.slice(0, cursorIndex)}${cursorCharacter}${inputBuffer.slice(cursorIndex)}${suffix}`;

  if (raw.length <= width) {
    return raw.padEnd(width, ' ');
  }

  const cursorPosition = 2 + cursorIndex;
  const preferredStart = Math.max(0, cursorPosition - Math.floor(width * 0.6));
  const maxStart = Math.max(0, raw.length - width);
  const start = Math.min(preferredStart, maxStart);
  let slice = raw.slice(start, start + width);

  if (start > 0) {
    slice = `…${slice.slice(1)}`;
  }

  if (start + width < raw.length) {
    slice = `${slice.slice(0, -1)}…`;
  }

  return slice;
}

function buildRuleLine(label: string, width: number): string {
  if (width <= 0) {
    return '';
  }

  if (!label) {
    return '─'.repeat(width);
  }

  // lowercase label, tighter spacing
  const decorated = `─ ${label.toLowerCase()} ─`;
  if (decorated.length >= width) {
    return truncateText(decorated, width);
  }

  return `${decorated}${'─'.repeat(width - decorated.length)}`;
}
