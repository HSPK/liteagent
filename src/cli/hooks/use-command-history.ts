import { useReducer } from 'react';

interface HistoryState {
  history: string[];
  index: number | null;
}

type HistoryAction =
  | { type: 'push'; line: string }
  | { type: 'setIndex'; index: number | null }
  | { type: 'reset' };

function reduce(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'push': {
      if (state.history.at(-1) === action.line) {
        return { history: state.history, index: null };
      }
      return { history: [...state.history, action.line], index: null };
    }
    case 'setIndex': {
      return { ...state, index: action.index };
    }
    case 'reset': {
      return { ...state, index: null };
    }
    default:
      return state;
  }
}

export interface CommandHistory {
  history: string[];
  index: number | null;
  push(line: string): void;
  /** Navigate through history. Returns the new buffer value to display, or null if navigated past the end. */
  navigate(dir: number): string | null;
  reset(): void;
}

export function useCommandHistory(): CommandHistory {
  const [state, dispatch] = useReducer(reduce, { history: [], index: null });

  function navigate(dir: number): string | null {
    const { history, index } = state;

    if (history.length === 0) {
      return null;
    }

    let nextIndex: number | null;
    if (index === null) {
      nextIndex = dir < 0 ? history.length - 1 : null;
    } else {
      const candidate = index + dir;
      if (candidate < 0) {
        nextIndex = 0;
      } else if (candidate >= history.length) {
        nextIndex = null;
      } else {
        nextIndex = candidate;
      }
    }

    dispatch({ type: 'setIndex', index: nextIndex });
    return nextIndex !== null ? (history[nextIndex] ?? '') : null;
  }

  return {
    history: state.history,
    index: state.index,
    push: (line) => dispatch({ type: 'push', line }),
    navigate,
    reset: () => dispatch({ type: 'reset' }),
  };
}
