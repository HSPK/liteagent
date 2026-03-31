import type {
  ExecutionContext,
  LifecycleContext,
  MaybePromise,
  ProtocolValue,
  SelfDescription,
  RoutingContext,
  SignalLike,
} from '../agent/types.js';

export interface AppManifest {
  id: string;
  kind?: string;
  version?: string;
  title?: string;
  priority?: number;
  [key: string]: ProtocolValue | undefined;
}

export interface AppLike {
  manifest: AppManifest;
  canHandle?: (signal: SignalLike, selfModel?: SelfDescription) => boolean;
  routeSignal?: (context: RoutingContext, signal: SignalLike) => MaybePromise<AppRouteDecision>;
  onInstall?: (context: LifecycleContext) => MaybePromise<void>;
  onSignal: (context: ExecutionContext, signal: SignalLike) => MaybePromise<void>;
}

export interface AppDefinition {
  manifest: AppManifest;
  provenance?: string;
  create: () => AppLike;
}

export interface AppDefinitionSummary {
  manifest: AppManifest;
  provenance: string;
}

export interface AppInstallRecord {
  app: AppLike;
  source: string;
  installedAt: number;
}

export interface AppDescription {
  appId: string;
  source: string;
  installedAt: number;
  manifest: AppManifest;
}

export interface PolicyLike {
  assertCanHostApp(appId: string): void;
  assertCanInstallApp?(appId: string): void;
}

export interface ModelProviderDescription {
  id: string;
  description: string;
  defaultModel: string | null;
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsTools: boolean;
}

export interface AssistantProfile {
  name: string;
  systemPrompt: string;
  provider: string | null;
  model: string | null;
  tools: boolean;
  maxTranscriptMessages: number;
  [key: string]: ProtocolValue;
}

export interface AssistantReplyPayload {
  text: string;
  conversationId: string | null;
  taskId: string;
  providerId: string | null;
  model: string | null;
  transcriptLength: number;
  error: string | null;
  [key: string]: ProtocolValue;
}

export interface AssistantTranscriptTurn {
  role: string;
  content: string | Array<{ type?: string; text?: string | null }>;
  createdAt: number;
  signalId?: string;
  signalKind?: string;
  signalType?: string;
  providerId?: string | null;
  model?: string | null;
}

export interface AssistantMessage {
  role: string;
  content: string;
}

export interface AssistantModelResult {
  text?: string;
  messages?: Array<{
    role?: string;
    content?: string | Array<{ type?: string; text?: string | null }>;
  }>;
  providerId?: string | null;
  model?: string | null;
  [key: string]: ProtocolValue | undefined;
}

export interface BuiltinAppTarget {
  registerApp(definition: AppDefinition): AppDefinition;
}

export type AppRouteDecision =
  | null
  | 'ignore'
  | 'spawn'
  | 'resume'
  | 'queue'
  | 'interrupt'
  | {
      action: 'ignore' | 'spawn' | 'resume' | 'queue' | 'interrupt';
      taskId?: string;
      title?: string | null;
    };
