import { useEffect, useRef, useState } from 'react';

import {
  consumeSuppressedTerminalInput,
  extractMouseScrollDelta,
  normalizeTerminalInput,
} from '../ink-input-helpers.js';

export interface ScrollState {
  scrollOffset: number;
  /** Always-fresh ref for use inside callbacks without stale closure issues. */
  scrollOffsetRef: React.MutableRefObject<number>;
  /** Tracks terminal input sequences that originated from mouse events and should be suppressed in keyboard handlers. */
  suppressedInputRef: React.MutableRefObject<string>;
  scrollBy(delta: number): void;
  scrollTo(offset: number): void;
  /** Adjusts scroll when new lines arrive: follows output if at the bottom, otherwise shifts up to maintain the view. */
  nudge(lineDelta: number): void;
  consumeSuppressed(input: string): { consumed: boolean; pendingInput: string };
}

export function useScroll(
  stdin: NodeJS.ReadStream | null | undefined,
  stdout: NodeJS.WriteStream | null | undefined,
): ScrollState {
  const [scrollOffset, setScrollOffsetState] = useState(0);
  const scrollOffsetRef = useRef(0);
  const suppressedInputRef = useRef('');

  function setScrollOffset(val: number | ((prev: number) => number)): void {
    const raw = typeof val === 'function' ? val(scrollOffsetRef.current) : val;
    const bounded = Math.max(0, raw);
    scrollOffsetRef.current = bounded;
    setScrollOffsetState(bounded);
  }

  useEffect(() => {
    if (!stdin?.isTTY || !stdout?.isTTY) {
      return undefined;
    }

    const handleMouseData = (chunk: Buffer | string) => {
      const text = normalizeTerminalInput(chunk);
      const delta = extractMouseScrollDelta(chunk);
      if (delta !== 0) {
        suppressedInputRef.current += text;
        setScrollOffset((v) => Math.max(0, v + delta));
      }
    };

    stdout.write('\x1b[?1000h\x1b[?1006h');
    stdin.prependListener('data', handleMouseData);

    return () => {
      stdin.off('data', handleMouseData);
      stdout.write('\x1b[?1000l\x1b[?1006l');
    };
  }, [stdin, stdout]);

  return {
    scrollOffset,
    scrollOffsetRef,
    suppressedInputRef,
    scrollBy:  (delta) => setScrollOffset((v) => Math.max(0, v + delta)),
    scrollTo:  (offset) => setScrollOffset(Math.max(0, offset)),
    nudge:     (lineDelta) => {
      if (scrollOffsetRef.current > 0 && lineDelta > 0) {
        setScrollOffset((v) => v + lineDelta);
      }
    },
    consumeSuppressed: (input) => {
      const result = consumeSuppressedTerminalInput(suppressedInputRef.current, input);
      suppressedInputRef.current = result.pendingInput;
      return result;
    },
  };
}
