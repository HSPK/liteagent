import {
  appendTranscript,
  buildAssistantMessages,
  createAssistantTurn,
  createDefaultAssistantProfile,
  createUserTurn,
  extractAssistantText,
  getAssistantProfile,
  listTranscript,
  updateAssistantProfile,
} from './assistant-transcript.js';
import type { ExecutionContext, SignalLike } from '../../agent/types.js';
import type {
  AppDefinition,
  AppLike,
  AssistantModelResult,
  AssistantProfile,
  AssistantReplyPayload,
  ModelProviderDescription,
} from '../types.js';

function resolveProvider(profile: AssistantProfile, providers: ModelProviderDescription[]): ModelProviderDescription {
  if (profile.provider) {
    const selected = providers.find((provider) => provider.id === profile.provider);
    if (!selected) {
      throw new Error(`Assistant provider is not available: ${profile.provider}`);
    }
    return selected;
  }

  if (providers.length === 0) {
    throw new Error('No model provider configured. Register a provider before chatting with the assistant.');
  }

  if (providers.length > 1) {
    throw new Error('Multiple model providers are registered. Configure assistant.provider to choose one.');
  }

  return providers[0];
}

function resolveModel(profile: AssistantProfile, provider: ModelProviderDescription): string {
  const model = profile.model ?? provider?.defaultModel ?? null;
  if (!model) {
    throw new Error(`Assistant model is not configured for provider ${provider?.id ?? 'unknown'}.`);
  }
  return model;
}

function createReplyPayload({
  text,
  conversationId,
  taskId,
  providerId,
  model,
  transcriptLength,
  error = null,
}: {
  text: string;
  conversationId: string | null;
  taskId: string;
  providerId: string | null;
  model: string | null;
  transcriptLength: number;
  error?: string | null;
}): AssistantReplyPayload {
  return {
    text,
    conversationId,
    taskId,
    providerId,
    model,
    transcriptLength,
    error,
  };
}

async function handleAssistantText(context: ExecutionContext, signal: SignalLike): Promise<void> {
  const profile = getAssistantProfile(context.memory.app, context.agentId);
  const transcript = listTranscript(context.memory.conversation);
  const userTurn = createUserTurn(signal);

  try {
    const providers = context.models.list();
    const provider = resolveProvider(profile, providers);
    const model = resolveModel(profile, provider);
    const result = await context.models.run({
      provider: provider.id,
      model,
      tools: profile.tools ? true : [],
      messages: buildAssistantMessages(profile, transcript, userTurn),
    }) as AssistantModelResult;
    const text = extractAssistantText(result);
    const nextTranscript = appendTranscript(
      context.memory.conversation,
      [userTurn, createAssistantTurn(text, result)],
      profile.maxTranscriptMessages,
    );
    const payload = createReplyPayload({
      text,
      conversationId: context.conversation.id,
      taskId: context.task.id,
      providerId: provider.id,
      model,
      transcriptLength: nextTranscript.length,
    });
    const reply = context.signals.reply({
      type: 'assistant.reply',
      payload,
      metadata: {
        appId: context.appId,
        taskId: context.task.id,
        providerId: provider.id,
        model,
      },
    });

    context.memory.agent.set('assistant:lastReply', payload);
    context.memory.conversation.set('assistant:lastReply', payload);
    context.task.record('assistant.reply', payload);
    context.complete({
      ...payload,
      replySignalId: reply.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const payload = createReplyPayload({
      text: message,
      conversationId: context.conversation.id,
      taskId: context.task.id,
      providerId: null,
      model: null,
      transcriptLength: transcript.length,
      error: message,
    });
    const reply = context.signals.reply({
      type: 'assistant.reply',
      payload,
      metadata: {
        appId: context.appId,
        taskId: context.task.id,
        error: true,
      },
    });

    context.memory.agent.set('assistant:lastReply', payload);
    context.memory.conversation.set('assistant:lastReply', payload);
    context.task.record('assistant.reply', payload);
    context.complete({
      ...payload,
      replySignalId: reply.id,
    });
  }
}

export function createAssistantApp(): AppLike {
  const manifest = {
    id: 'domain.assistant',
    kind: 'domain',
    version: '0.1.0',
    title: 'Assistant',
    priority: 90,
  };

  return {
    manifest,
    async onInstall(context) {
      updateAssistantProfile(context.memory.app, context.agentId, createDefaultAssistantProfile(context.agentId));
    },
    canHandle(signal) {
      return signal.targetAppId === manifest.id
        || signal.type === 'text'
        || signal.type === 'assistant.configure'
        || signal.type === 'assistant.profile';
    },
    async onSignal(context, signal) {
      switch (signal.type) {
        case 'assistant.configure': {
          const profile = updateAssistantProfile(context.memory.app, context.agentId, signal.payload ?? {});
          context.complete({
            ok: true,
            profile,
          });
          return;
        }
        case 'assistant.profile':
          context.complete({
            profile: getAssistantProfile(context.memory.app, context.agentId),
          });
          return;
        case 'text':
          await handleAssistantText(context, signal);
          return;
        default:
          context.complete({ ignored: signal.type });
      }
    },
  };
}

export const assistantAppDefinition = {
  manifest: {
    id: 'domain.assistant',
    kind: 'domain',
    version: '0.1.0',
    title: 'Assistant',
    priority: 90,
  },
  provenance: 'builtin',
  create: () => createAssistantApp(),
} satisfies AppDefinition;
