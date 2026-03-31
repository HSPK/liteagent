const PROFILE_KEY = 'assistant:profile';
const TRANSCRIPT_KEY = 'assistant:transcript';
import type { MemoryScopeApi, ProtocolRecord, SignalLike } from '../../agent/types.js';
import type {
  AssistantMessage,
  AssistantModelResult,
  AssistantProfile,
  AssistantTranscriptTurn,
} from '../types.js';

interface AssistantTextPart {
  type?: string;
  text?: string | null;
}

function asProfilePatch(value: ReturnType<MemoryScopeApi['get']>): ProtocolRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as ProtocolRecord
    : {};
}

function isAssistantTranscriptTurn(value: unknown): value is AssistantTranscriptTurn {
  return !!value
    && typeof value === 'object'
    && typeof (value as { role?: unknown }).role === 'string'
    && typeof (value as { createdAt?: unknown }).createdAt === 'number';
}

export function createDefaultAssistantProfile(agentId: string): AssistantProfile {
  return {
    name: agentId,
    systemPrompt: `You are ${agentId}, a helpful assistant running inside the agents framework. Use tools when they help, keep answers grounded in available context, and be concise.`,
    provider: null,
    model: null,
    tools: true,
    maxTranscriptMessages: 24,
  };
}

export function getAssistantProfile(memoryScope: MemoryScopeApi, agentId: string): AssistantProfile {
  return normalizeAssistantProfile({
    ...createDefaultAssistantProfile(agentId),
    ...asProfilePatch(memoryScope.get(PROFILE_KEY, {})),
  }, agentId);
}

export function updateAssistantProfile(
  memoryScope: MemoryScopeApi,
  agentId: string,
  patch: ProtocolRecord = {},
): AssistantProfile {
  const next = normalizeAssistantProfile({
    ...getAssistantProfile(memoryScope, agentId),
    ...(patch ?? {}),
  }, agentId);
  memoryScope.set(PROFILE_KEY, next);
  return next;
}

export function listTranscript(memoryScope: MemoryScopeApi): AssistantTranscriptTurn[] {
  const transcript = memoryScope.get(TRANSCRIPT_KEY, []);
  return Array.isArray(transcript)
    ? transcript
      .filter((entry) => isAssistantTranscriptTurn(entry))
      .map((entry) => structuredClone(entry))
    : [];
}

export function appendTranscript(
  memoryScope: MemoryScopeApi,
  turns: AssistantTranscriptTurn[] = [],
  maxMessages = 24,
): AssistantTranscriptTurn[] {
  const transcript = listTranscript(memoryScope);
  const appended = transcript.concat(
    turns
      .filter(Boolean)
      .map((turn) => structuredClone(turn)),
  );
  const bounded = appended.slice(-Math.max(1, maxMessages));
  memoryScope.set(TRANSCRIPT_KEY, bounded);
  return bounded;
}

export function createUserTurn(signal: SignalLike): AssistantTranscriptTurn {
  return {
    role: 'user',
    content: typeof signal.payload?.text === 'string' ? signal.payload.text : '',
    createdAt: signal.createdAt ?? Date.now(),
    signalId: signal.id,
    signalKind: signal.kind,
    signalType: signal.type,
  };
}

export function createAssistantTurn(text: string, result: AssistantModelResult = {}): AssistantTranscriptTurn {
  return {
    role: 'assistant',
    content: text,
    createdAt: Date.now(),
    providerId: result.providerId ?? null,
    model: result.model ?? null,
  };
}

export function buildAssistantMessages(
  profile: AssistantProfile,
  transcript: AssistantTranscriptTurn[],
  nextUserTurn: AssistantTranscriptTurn | null | undefined,
): AssistantMessage[] {
  const messages: AssistantMessage[] = [];

  if (profile.systemPrompt) {
    messages.push({
      role: 'system',
      content: profile.systemPrompt,
    });
  }

  for (const turn of transcript) {
    if (!turn?.role || typeof turn.content !== 'string') {
      continue;
    }

    messages.push({
      role: turn.role,
      content: turn.content,
    });
  }

  if (nextUserTurn?.content) {
    messages.push({
      role: 'user',
      content: typeof nextUserTurn.content === 'string' ? nextUserTurn.content : '',
    });
  }

  return messages;
}

export function extractAssistantText(result: AssistantModelResult | null | undefined): string {
  if (typeof result?.text === 'string' && result.text.length > 0) {
    return result.text;
  }

  const messages = Array.isArray(result?.messages) ? result.messages : [];
  let lastMessage = null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (candidate?.role === 'assistant') {
      lastMessage = candidate;
      break;
    }
  }

  if (typeof lastMessage?.content === 'string') {
    return lastMessage.content;
  }

  if (Array.isArray(lastMessage?.content)) {
    return lastMessage.content
      .filter((part): part is AssistantTextPart => part?.type === 'text')
      .map((part) => part.text ?? '')
      .join('');
  }

  return '';
}

function normalizeAssistantProfile(profile: ProtocolRecord, agentId: string): AssistantProfile {
  const maxTranscriptMessages = typeof profile.maxTranscriptMessages === 'number'
    && Number.isInteger(profile.maxTranscriptMessages)
    && profile.maxTranscriptMessages > 0
    ? profile.maxTranscriptMessages
    : 24;

  return {
    name: typeof profile.name === 'string' && profile.name.length > 0
      ? profile.name
      : agentId,
    systemPrompt: typeof profile.systemPrompt === 'string' && profile.systemPrompt.length > 0
      ? profile.systemPrompt
      : createDefaultAssistantProfile(agentId).systemPrompt,
    provider: typeof profile.provider === 'string' && profile.provider.length > 0
      ? profile.provider
      : null,
    model: typeof profile.model === 'string' && profile.model.length > 0
      ? profile.model
      : null,
    tools: profile.tools !== false,
    maxTranscriptMessages,
  };
}
