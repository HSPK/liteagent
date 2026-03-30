import { createElement as h, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdin, useStdout } from 'ink';

import { createId } from '../utils/id.js';
import { useCommandHistory } from './hooks/use-command-history.js';
import { useCommandInput } from './hooks/use-command-input.js';
import { useScroll } from './hooks/use-scroll.js';
import {
  buildComposerFooter,
  buildInputFrame,
  buildInputHint,
  buildSlashCommandMenu,
  buildStatusLine,
  clamp,
  isMouseInputSequence,
} from './ink-input-helpers.js';
import { buildTranscriptLines } from './transcript-layout.js';
import {
  WELCOME_TEXT,
  createPromptEntry,
  executeConsoleInput,
  isExitInput,
} from './ui-helpers.js';
import type { CliEntry, CliEntryPatch, RuntimeControllerLike } from './types.js';

interface InkKeyLike {
  ctrl?: boolean;
  meta?: boolean;
  escape?: boolean;
  return?: boolean;
  backspace?: boolean;
  delete?: boolean;
  tab?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  pageUp?: boolean;
  pageDown?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  home?: boolean;
  end?: boolean;
}

function kindColor(kind: string): string {
  switch (kind) {
    case 'user':    return 'cyan';
    case 'agent':   return 'green';
    case 'error':   return 'red';
    case 'command': return 'yellow';
    default:        return 'white';
  }
}

function kindDim(kind: string): boolean {
  return kind === 'system';
}

function toCliEntry(entry: CliEntryPatch): CliEntry | null {
  if (!entry.kind || typeof entry.text !== 'string') {
    return null;
  }

  return {
    kind: entry.kind,
    text: entry.text,
    author: entry.author,
    entryKey: entry.entryKey,
    replaceKey: entry.replaceKey,
    removeKey: entry.removeKey,
  };
}

export function InkRuntimeApp({ controller }: { controller: RuntimeControllerLike }) {
  const { exit } = useApp();
  const { stdin } = useStdin();
  const { stdout } = useStdout();
  const [entries, setEntries] = useState<CliEntry[]>([{ kind: 'system', text: WELCOME_TEXT }]);
  const [busy, setBusy] = useState(false);
  const conversationIdRef = useRef(createId('cli'));

  const commandInput = useCommandInput();
  const commandHistory = useCommandHistory();
  const scroll = useScroll(stdin, stdout);

  const columns = stdout.columns ?? 80;
  const rows = stdout.rows ?? 24;
  const headerHeight = 2;
  const suggestionHeight = 3;
  const composerHeight = 3;
  const historyHeight = Math.max(1, rows - headerHeight - suggestionHeight - composerHeight);

  // Keep fresh refs for values needed inside the subscription callback
  const columnsRef = useRef(columns);
  const historyHeightRef = useRef(historyHeight);
  columnsRef.current = columns;
  historyHeightRef.current = historyHeight;

  const commandSuggestions = useMemo(() => {
    if (commandInput.buffer.startsWith('/')) {
      return buildSlashCommandMenu(commandInput.buffer, {
        width: Math.max(24, columns),
        maxItems: suggestionHeight,
      });
    }

    if (busy) {
      return [
        'Streaming and runtime events continue to update above.',
        'Use PgUp/PgDn or the mouse wheel to inspect earlier output.',
      ];
    }

    return [
      'Chat mode sends plain text to the assistant.',
      'Slash commands inspect agents, memory, events, and routing state.',
    ];
  }, [busy, columns, commandInput.buffer]);
  const panelLines = Array.from({ length: suggestionHeight }, (_, index) => commandSuggestions[index] ?? '');

  const transcriptView = useMemo(() => buildTranscriptLines(entries, {
    width: Math.max(16, columns),
    height: historyHeight,
    scrollOffset: scroll.scrollOffset,
  }), [columns, entries, historyHeight, scroll.scrollOffset]);
  const boundedScrollOffset = clamp(scroll.scrollOffset, 0, transcriptView.maxScrollOffset);
  const visibleEntries = transcriptView.lines;
  const agentCount = controller.runtime.listAgents().length;
  const registryCount = controller.runtime.appRegistry.list().length;

  // Use a ref so the subscription callback always calls the latest appendEntries
  const appendEntriesRef = useRef<(patches: CliEntryPatch[]) => void>(() => {});

  useEffect(() => controller.subscribeEntries((patches) => {
    appendEntriesRef.current(patches);
  }), [controller]);

  useInput((input: string, key: InkKeyLike) => {
    if (key.ctrl && input === 'c') {
      exit();
      return;
    }

    const suppressed = scroll.consumeSuppressed(input);
    if (suppressed.consumed) {
      return;
    }

    if (isMouseInputSequence(input)) {
      return;
    }

    if (key.escape) {
      commandInput.clear();
      return;
    }

    if (input.includes('\r') || input.includes('\n')) {
      if (!busy) void processCompositeInput(input);
      return;
    }

    if (key.return) {
      if (!busy) void submitLine(commandInput.buffer);
      return;
    }

    if (key.backspace) { commandInput.backspace(); return; }
    if (key.delete)    { commandInput.deleteFwd(); return; }
    if (key.tab)       { commandInput.complete(); return; }

    if (key.upArrow && !busy) {
      const value = commandHistory.navigate(-1);
      if (value !== null) commandInput.setValue(value);
      else commandInput.clear();
      return;
    }

    if (key.downArrow && !busy) {
      const value = commandHistory.navigate(1);
      if (value !== null) commandInput.setValue(value);
      else commandInput.clear();
      return;
    }

    if (key.pageUp)    { scroll.scrollBy(Math.max(1, Math.floor(rows / 2)));  return; }
    if (key.pageDown)  { scroll.scrollBy(-Math.max(1, Math.floor(rows / 2))); return; }
    if (key.leftArrow) { commandInput.moveCursor('left');  return; }
    if (key.rightArrow){ commandInput.moveCursor('right'); return; }
    if (key.home)      { commandInput.moveCursor('home');  return; }
    if (key.end)       { commandInput.moveCursor('end');   return; }

    if (!key.ctrl && !key.meta && input) {
      commandInput.insert(input);
    }
  });

  async function submitLine(rawLine: string): Promise<void> {
    const line = rawLine.trim();
    if (!line) return;

    commandInput.clear();
    commandHistory.push(line);
    commandHistory.reset();

    if (isExitInput(line)) {
      exit();
      return;
    }

    appendEntries([createPromptEntry(line)]);

    if (!line.startsWith('/')) {
      const submission = await controller.submitText(line, {
        conversationId: conversationIdRef.current,
      });
      if ((submission.handles ?? []).length === 0) {
        appendEntries([{ kind: 'system', text: 'System: no agents available.' }]);
      }
      return;
    }

    setBusy(true);
    try {
      const resultEntries = await executeConsoleInput(controller, line);
      appendEntries(resultEntries);
    } catch (error) {
      appendEntries([{
        kind: 'error',
        author: 'Error',
        text: error instanceof Error ? error.message : String(error),
      }]);
    } finally {
      setBusy(false);
    }
  }

  async function processCompositeInput(rawInput: string): Promise<void> {
    const normalized = rawInput.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    let workingBuffer = commandInput.buffer;
    let workingCursor = commandInput.cursorIndex;

    for (const character of normalized) {
      if (character === '\n') {
        const line = workingBuffer;
        workingBuffer = '';
        workingCursor = 0;
        commandInput.clear();
        await submitLine(line);
        continue;
      }
      workingBuffer = `${workingBuffer.slice(0, workingCursor)}${character}${workingBuffer.slice(workingCursor)}`;
      workingCursor += character.length;
    }

    commandInput.setValue(workingBuffer);
  }

  function appendEntries(patches: CliEntryPatch[]): void {
    if (!patches?.length) return;

    const shouldFollow = scroll.scrollOffsetRef.current === 0;
    let lineDelta = 0;

    setEntries((prev) => {
      const prevLines = buildTranscriptLines(prev, {
        width: Math.max(16, columnsRef.current),
        height: historyHeightRef.current,
        scrollOffset: 0,
      }).totalLines;

      let next = [...prev];
      for (const entry of patches) {
        if (entry.removeKey) {
          next = next.filter((e) => e.entryKey !== entry.removeKey);
          continue;
        }
        if (entry.replaceKey) {
          const renderable = toCliEntry(entry);
          if (!renderable) continue;
          const normalized = { ...renderable, entryKey: entry.replaceKey };
          const idx = next.findIndex((e) => e.entryKey === entry.replaceKey);
          if (idx >= 0) next[idx] = normalized;
          else next.push(normalized);
          continue;
        }
        const renderable = toCliEntry(entry);
        if (renderable) next.push(renderable);
      }

      const nextLines = buildTranscriptLines(next, {
        width: Math.max(16, columnsRef.current),
        height: historyHeightRef.current,
        scrollOffset: 0,
      }).totalLines;
      lineDelta = Math.max(0, nextLines - prevLines);
      return next;
    });

    if (shouldFollow) {
      scroll.scrollTo(0);
    } else {
      scroll.nudge(lineDelta);
    }
  }

  // Keep the ref always fresh
  appendEntriesRef.current = appendEntries;

  const { buffer, cursorIndex } = commandInput;
  const isSlashMode = buffer.startsWith('/');
  const promptColor = isSlashMode ? 'yellow' : busy ? 'magenta' : 'cyan';
  const cursorCharacter = busy ? '·' : '█';
  const inputFrame = buildInputFrame({
    columns,
    inputBuffer: buffer,
    cursorIndex,
    cursorCharacter,
    hint: buildInputHint(buffer, { busy }),
    footerText: buildComposerFooter({ busy, slashMode: isSlashMode }),
    busy,
    promptLabel: isSlashMode ? 'command' : busy ? 'running' : 'ask',
  });
  const headerLine = buildStatusLine({
    agentCount,
    registryCount,
    busy,
    scrollOffset: boundedScrollOffset,
  });

  return h(
    Box,
    { flexDirection: 'column' },
    h(Text, { color: 'cyan', dimColor: true }, headerLine),
    h(
      Box,
      { flexDirection: 'column', flexGrow: 1 },
      ...visibleEntries.map((entry, index) =>
        h(Text, {
          key: `${index}-${entry.kind}-${entry.text}`,
          color: kindColor(entry.kind),
          dimColor: kindDim(entry.kind),
        }, entry.text),
      ),
    ),
    ...panelLines.map((line, index) =>
      h(Text, {
        key: `panel-${index}-${line}`,
        color: isSlashMode && line ? 'yellow' : 'gray',
        dimColor: !isSlashMode,
      }, line),
    ),
    h(Text, { color: 'gray' }, inputFrame.top),
    h(Text, { color: promptColor }, inputFrame.middle),
    h(Text, { color: 'gray', dimColor: true }, inputFrame.bottom),
  );
}
