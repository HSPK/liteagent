import { useReducer } from 'react';

import { completeSlashCommand } from '../slash-commands.js';

interface InputState {
  buffer: string;
  cursorIndex: number;
}

type InputAction =
  | { type: 'insert'; text: string }
  | { type: 'backspace' }
  | { type: 'deleteFwd' }
  | { type: 'move'; dir: 'left' | 'right' | 'home' | 'end' }
  | { type: 'complete' }
  | { type: 'clear' }
  | { type: 'setValue'; value: string };

function reduce(state: InputState, action: InputAction): InputState {
  const { buffer, cursorIndex } = state;

  switch (action.type) {
    case 'insert': {
      return {
        buffer: `${buffer.slice(0, cursorIndex)}${action.text}${buffer.slice(cursorIndex)}`,
        cursorIndex: cursorIndex + action.text.length,
      };
    }
    case 'backspace': {
      if (cursorIndex === 0) {
        return state;
      }
      return {
        buffer: `${buffer.slice(0, cursorIndex - 1)}${buffer.slice(cursorIndex)}`,
        cursorIndex: cursorIndex - 1,
      };
    }
    case 'deleteFwd': {
      return {
        buffer: `${buffer.slice(0, cursorIndex)}${buffer.slice(cursorIndex + 1)}`,
        cursorIndex,
      };
    }
    case 'move': {
      switch (action.dir) {
        case 'left':  return { buffer, cursorIndex: Math.max(0, cursorIndex - 1) };
        case 'right': return { buffer, cursorIndex: Math.min(buffer.length, cursorIndex + 1) };
        case 'home':  return { buffer, cursorIndex: 0 };
        case 'end':   return { buffer, cursorIndex: buffer.length };
        default:      return state;
      }
    }
    case 'complete': {
      const completion = completeSlashCommand(buffer);
      return { buffer: completion.input, cursorIndex: completion.input.length };
    }
    case 'clear': {
      return { buffer: '', cursorIndex: 0 };
    }
    case 'setValue': {
      return { buffer: action.value, cursorIndex: action.value.length };
    }
    default:
      return state;
  }
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
  const [state, dispatch] = useReducer(reduce, { buffer: initial, cursorIndex: initial.length });
  return {
    buffer: state.buffer,
    cursorIndex: state.cursorIndex,
    insert:      (text) => dispatch({ type: 'insert', text }),
    backspace:   () => dispatch({ type: 'backspace' }),
    deleteFwd:   () => dispatch({ type: 'deleteFwd' }),
    moveCursor:  (dir) => dispatch({ type: 'move', dir }),
    complete:    () => dispatch({ type: 'complete' }),
    clear:       () => dispatch({ type: 'clear' }),
    setValue:    (value) => dispatch({ type: 'setValue', value }),
  };
}
