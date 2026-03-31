import { createId } from '../utils/id.js';
import type { SignalKind, SignalLike, SignalMetadata, SignalPayload } from '../agent/types.js';

export interface CreateSignalInput {
  id?: string;
  kind: SignalKind;
  type: string;
  to: string;
  from?: string | null;
  payload?: SignalPayload;
  createdAt?: number;
  conversationId?: string | null;
  targetAppId?: string | null;
  targetTaskId?: string | null;
  metadata?: SignalMetadata;
}

type CreatedSignal = SignalLike & {
  from: string | null;
  payload: SignalPayload;
  createdAt: number;
  conversationId: string;
  targetAppId: string | null;
  targetTaskId: string | null;
  metadata: SignalMetadata;
};

type KindlessSignalInput = Omit<CreateSignalInput, 'kind'>;

export interface CreateTextSignalInput extends Omit<CreateSignalInput, 'kind' | 'type'> {
  text: string;
  payload?: SignalMetadata;
}

export function createSignal({
  id,
  kind,
  type,
  to,
  from = null,
  payload = null,
  createdAt,
  conversationId,
  targetAppId = null,
  targetTaskId = null,
  metadata = {},
}: CreateSignalInput): CreatedSignal {
  if (!kind) {
    throw new Error('Signal kind is required.');
  }

  if (!type) {
    throw new Error('Signal type is required.');
  }

  if (!to) {
    throw new Error('Signal target agent is required.');
  }

  return {
    id: id ?? createId('sig'),
    kind,
    type,
    to,
    from,
    payload,
    createdAt: createdAt ?? Date.now(),
    conversationId: conversationId ?? createId('conv'),
    targetAppId,
    targetTaskId,
    metadata: { ...metadata },
  };
}

export function createMessage(input: KindlessSignalInput): CreatedSignal {
  return createSignal({ ...input, kind: 'message' });
}

export function createEvent(input: KindlessSignalInput): CreatedSignal {
  return createSignal({ ...input, kind: 'event' });
}

export function createTimerSignal(input: KindlessSignalInput): CreatedSignal {
  return createSignal({ ...input, kind: 'timer' });
}

export function createToolSignal(input: KindlessSignalInput): CreatedSignal {
  return createSignal({ ...input, kind: 'tool' });
}

export function createReplySignal(input: KindlessSignalInput): CreatedSignal {
  return createSignal({ ...input, kind: 'reply' });
}

export function createTextEvent({ text, payload = {}, ...input }: CreateTextSignalInput): CreatedSignal {
  return createEvent({
    ...input,
    type: 'text',
    payload: {
      ...payload,
      text,
    },
  });
}

export function createTextMessage({ text, payload = {}, ...input }: CreateTextSignalInput): CreatedSignal {
  return createMessage({
    ...input,
    type: 'text',
    payload: {
      ...payload,
      text,
    },
  });
}
