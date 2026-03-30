import { useRef, useState } from 'react';

import { completeSlashCommand } from '../slash-commands.js';

interface InputState {
  buffer: string;
  cursorIndex: number;
}

export interface CommandInput {
  buffer: string;
  cursorIndex: number;
  insert(text: string): void;
  backspace(): void;
  deleteFwd(): void;
  moveCursor(dir: 'left' | 'right' | 'home' | 'end'): void;
  complete(): void;
  clear(): void;
  setValue(value: string): void;
}

export function useCommandInput(initial = ''): CommandInput {
  const [state, setState] = useState<InputState>({ buffer: initial, cursorIndex: initial.length });
  // Keep a ref that is always fresh so operations inside cached callbacks get correct values
  const ref = useRef<InputState>(state);
  ref.current = state;

  function update(next: InputState): void {
    ref.current = next;
    setState(next);
  }

  return {
    buffer: state.buffer,
    cursorIndex: state.cursorIndex,

    insert(text: string): void {
      const { buffer, cursorIndex } = ref.current;
      update({
        buffer: `${buffer.slice(0, cursorIndex)}${text}${buffer.slice(cursorIndex)}`,
        cursorIndex: cursorIndex + text.length,
      });
    },

    backspace(): void {
      const { buffer, cursorIndex } = ref.current;
      if (cursorIndex === 0) return;
      update({
        buffer: `${buffer.slice(0, cursorIndex - 1)}${buffer.slice(cursorIndex)}`,
        cursorIndex: cursorIndex - 1,
      });
    },

    deleteFwd(): void {
      const { buffer, cursorIndex } = ref.current;
      update({
        buffer: `${buffer.slice(0, cursorIndex)}${buffer.slice(cursorIndex + 1)}`,
        cursorIndex,
      });
    },

    moveCursor(dir: 'left' | 'right' | 'home' | 'end'): void {
      const { buffer, cursorIndex } = ref.current;
      const next = {
        left:  Math.max(0, cursorIndex - 1),
        right: Math.min(buffer.length, cursorIndex + 1),
        home:  0,
        end:   buffer.length,
      }[dir];
      update({ buffer, cursorIndex: next });
    },

    complete(): void {
      const { buffer } = ref.current;
      const completion = completeSlashCommand(buffer);
      update({ buffer: completion.input, cursorIndex: completion.input.length });
    },

    clear(): void {
      update({ buffer: '', cursorIndex: 0 });
    },

    setValue(value: string): void {
      update({ buffer: value, cursorIndex: value.length });
    },
  };
}
