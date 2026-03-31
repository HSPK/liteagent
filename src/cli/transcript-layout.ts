import type { CliEntry, TranscriptLine } from './types.js';

function wrapParagraph(text: string, width: number): string[] {
  if (width <= 0) {
    return [''];
  }

  if (!text) {
    return [''];
  }

  const lines = [];
  let remaining = text;

  while (remaining.length > width) {
    const slice = remaining.slice(0, width);
    const breakIndex = slice.lastIndexOf(' ');
    const line = breakIndex > Math.floor(width / 3)
      ? slice.slice(0, breakIndex)
      : slice;
    lines.push(line.trimEnd());
    remaining = remaining.slice(line.length).trimStart();
  }

  lines.push(remaining);
  return lines;
}

export function buildTranscriptLines(
  entries: CliEntry[],
  { width, height, scrollOffset = 0 }: { width: number; height: number; scrollOffset?: number },
): {
  lines: TranscriptLine[];
  totalLines: number;
  maxScrollOffset: number;
  boundedScrollOffset: number;
} {
  const allLines = entries.flatMap((entry) => buildEntryLines(entry, width));

  const totalLines = allLines.length;
  const maxScrollOffset = Math.max(0, totalLines - height);
  const boundedScrollOffset = Math.min(Math.max(scrollOffset, 0), maxScrollOffset);
  const start = Math.max(0, totalLines - height - boundedScrollOffset);
  const visibleLines = allLines.slice(start, start + height);

  while (visibleLines.length < height) {
    visibleLines.push({
      kind: 'system',
      text: '',
    });
  }

  return {
    lines: visibleLines,
    totalLines,
    maxScrollOffset,
    boundedScrollOffset,
  };
}

function buildEntryLines(entry: CliEntry, width: number): TranscriptLine[] {
  const label = entryLabel(entry);
  const prefix = `${label} │ `;
  const continuation = `${' '.repeat(label.length)} │ `;
  const contentWidth = Math.max(1, width - prefix.length);
  const paragraphs = String(entry.text ?? '').split('\n');
  const lines: TranscriptLine[] = [];

  for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
    const wrapped = wrapParagraph(paragraph, contentWidth);
    const source = wrapped.length > 0 ? wrapped : [''];

    for (const [lineIndex, line] of source.entries()) {
      lines.push({
        kind: entry.kind,
        text: `${paragraphIndex === 0 && lineIndex === 0 ? prefix : continuation}${line}`,
      });
    }
  }

  return lines.length > 0
    ? lines
    : [{
      kind: entry.kind,
      text: prefix.trimEnd(),
    }];
}

function entryLabel(entry: CliEntry): string {
  if (entry.kind === 'user') {
    return entry.author ?? 'You';
  }

  if (entry.kind === 'agent') {
    return entry.author ?? 'Assistant';
  }

  if (entry.kind === 'command') {
    return 'Command';
  }

  if (entry.kind === 'error') {
    return entry.author ?? 'Error';
  }

  return entry.author ?? 'System';
}
