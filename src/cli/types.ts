import type {
  DispatchHandleLike,
  MemorySnapshot,
  ProtocolRecord,
  ProtocolValue,
  SelfDescription,
  SignalLike,
  TaskRecord,
} from '../agent/types.js';
import type { AppDefinitionSummary, AppDescription } from '../apps/types.js';
import type { RuntimeEventFilter, RuntimeObservedEvent, RuntimeSnapshot } from '../runtime/types.js';

export type EntryKind = 'user' | 'agent' | 'system' | 'error' | 'command';

export interface CliEntry {
  kind: EntryKind;
  text: string;
  author?: string;
  entryKey?: string;
  replaceKey?: string;
  removeKey?: string;
}

export interface CliEntryPatch {
  kind?: EntryKind;
  text?: string;
  author?: string;
  entryKey?: string;
  replaceKey?: string;
  removeKey?: string;
}

export interface TranscriptLine {
  kind: EntryKind | string;
  text: string;
}

export interface InputHintOptions {
  busy?: boolean;
}

export interface InputFrameRequest {
  columns: number;
  inputBuffer: string;
  cursorIndex: number;
  cursorCharacter: string;
  hint: string;
  footerText: string;
  busy: boolean;
  promptLabel: string;
}

export interface InputFrame {
  top: string;
  middle: string;
  bottom: string;
}

export interface ParsedCommand {
  command: string;
  args: string[];
  options: {
    appId?: string | null;
  };
}

export interface ConsoleReply {
  agentId: string;
  conversationId?: string | null;
  status: string;
  result: ProtocolValue | null;
  renderedBySubscription?: boolean;
}

export interface ConsoleChatResult {
  conversationId: string;
  replies: ConsoleReply[];
}

export interface RuntimeSubmissionHandle {
  agentId: string;
  handle: DispatchHandleLike<ProtocolValue | null>;
  renderedBySubscription?: boolean;
}

export interface RuntimeSubmissionResult {
  conversationId: string;
  handles: RuntimeSubmissionHandle[];
}

export interface SubmitTextOptions {
  conversationId?: string;
  agentId?: string | null;
}

export interface RuntimeControllerAgentLike {
  id: string;
  describeSelf(): SelfDescription;
  snapshotMemory(): MemorySnapshot;
  installAppById(appId: string, source?: string): Promise<AppDescription | null>;
}

export interface RuntimeControllerRuntimeLike {
  defaultInstalledApps: string[];
  appRegistry: {
    list(): AppDefinitionSummary[];
  };
  state?: {
    hasBackend?(): boolean;
  };
  createAgent(input: {
    id: string;
    installedApps: string[];
  }): Promise<RuntimeControllerAgentLike>;
  getAgent(agentId: string): RuntimeControllerAgentLike | null;
  listAgents(): string[];
  subscribeEvents(callback: (event: RuntimeObservedEvent) => void, options?: RuntimeEventFilter): () => void;
  sendMessage(input: {
    from: string;
    to: string;
    type: string;
    targetAppId?: string | null;
    payload?: ProtocolRecord | null;
  }): SignalLike;
  ingestEvent(input: {
    to: string;
    type: string;
    targetAppId?: string | null;
    payload?: ProtocolRecord | null;
  }): SignalLike;
  text(input: {
    to: string;
    text: string;
    app?: string | null;
    conversationId?: string | null;
  }): DispatchHandleLike<ProtocolValue | null>;
  whenIdle(): Promise<void>;
  saveState(options?: {
    reason?: string;
    waitForIdle?: boolean;
  }): Promise<RuntimeSnapshot | null>;
  dispose(): void;
  loadState(): Promise<RuntimeSnapshot>;
}

export interface RuntimeControllerOptions {
  runtime?: RuntimeControllerRuntimeLike;
  bootstrapAssistant?: boolean;
  defaultAssistantId?: string;
  defaultAssistantApps?: string[];
}

export type RuntimeEventLike = RuntimeObservedEvent;

export type EntryListener = (entries: CliEntryPatch[]) => void;

export interface RuntimeControllerAgentSummary {
  agentId: string;
  appCount: number;
  taskCount: number;
  timerCount: number;
  scheduleCount: number;
}

export interface RuntimeControllerCreateAgentResult {
  agentId: string;
  installedApps: Array<string | null>;
}

export interface RuntimeControllerIdleResult {
  status: 'idle';
  agents: RuntimeControllerAgentSummary[];
}

export type RuntimeControllerCommandResult =
  | { type: 'help' }
  | RuntimeControllerAgentSummary[]
  | RuntimeControllerCreateAgentResult
  | SelfDescription
  | MemorySnapshot
  | AppDefinitionSummary[]
  | SelfDescription['apps']
  | AppDescription
  | SignalLike
  | RuntimeControllerIdleResult
  | null;

export interface RuntimeControllerLike {
  runtime: RuntimeControllerRuntimeLike;
  initialize(): Promise<RuntimeControllerLike>;
  execute(command: ParsedCommand): Promise<RuntimeControllerCommandResult>;
  chatText?(text: string, options?: SubmitTextOptions): Promise<ConsoleChatResult>;
  submitText(text: string, options?: SubmitTextOptions): Promise<RuntimeSubmissionResult>;
  broadcastText(text: string): Promise<ConsoleChatResult>;
  subscribeEntries(callback: EntryListener): () => void;
  hasLiveEntries?(): boolean;
  waitForIdle(): Promise<RuntimeControllerIdleResult>;
  persistState(reason?: string): Promise<void>;
  dispose(): void;
}
