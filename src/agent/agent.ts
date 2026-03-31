import { AgentPolicy } from '../core/policy.js';
import { AgentKernel } from './kernel.js';
import type {
  AgentStateSnapshot,
  AgentRuntimeLike,
  AppRegistryLike,
  ConversationRecord,
  DispatchHandleLike,
  KernelObservedEvent,
  KernelEventListener,
  MemorySnapshot,
  PolicyDescription,
  ProtocolRecord,
  ProtocolValue,
  SignalLike,
  SelfDescription,
  TaskEventListener,
  TaskEventEntry,
  TaskRecord,
  ToolDefinition,
  UnknownRecord,
} from './types.js';
import type { AppLike as InstalledAppLike } from '../apps/types.js';
import type { AppDescription } from '../apps/types.js';

export class Agent {
  id: string;
  runtime: AgentRuntimeLike;
  policy: AgentPolicy;
  kernel: AgentKernel;

  constructor({
    id,
    runtime,
    policy = {},
    appRegistry,
  }: {
    id: string;
    runtime: AgentRuntimeLike;
    policy?: AgentPolicy | PolicyDescription | UnknownRecord;
    appRegistry: AppRegistryLike;
  }) {
    this.id = id;
    this.runtime = runtime;
    this.policy = policy instanceof AgentPolicy ? policy : new AgentPolicy(policy);
    this.kernel = new AgentKernel({
      agent: this,
      runtime,
      policy: this.policy,
      appRegistry,
    });
  }

  receive(signal: SignalLike): SignalLike {
    return this.kernel.receiveSignal(signal);
  }

  event<TResult = ProtocolValue | null>(
    type: string,
    payload: ProtocolRecord | null = null,
    options: UnknownRecord = {},
  ): DispatchHandleLike<TResult> {
    return this.runtime.event({
      to: this.id,
      type,
      payload,
      ...options,
    }) as DispatchHandleLike<TResult>;
  }

  text<TResult = ProtocolValue | null>(text: string, options: UnknownRecord = {}): DispatchHandleLike<TResult> {
    return this.runtime.text({
      to: this.id,
      text,
      ...options,
    }) as DispatchHandleLike<TResult>;
  }

  message<TResult = ProtocolValue | null>(
    to: string,
    type: string,
    payload: ProtocolRecord | null = null,
    options: UnknownRecord = {},
  ): DispatchHandleLike<TResult> {
    return this.runtime.message({
      from: this.id,
      to,
      type,
      payload,
      ...options,
    }) as DispatchHandleLike<TResult>;
  }

  tell<TResult = ProtocolValue | null>(to: string, text: string, options: UnknownRecord = {}): DispatchHandleLike<TResult> {
    return this.runtime.tell({
      from: this.id,
      to,
      text,
      ...options,
    }) as DispatchHandleLike<TResult>;
  }

  async installAppById(appId: string, source = 'manual'): Promise<AppDescription | null> {
    return this.kernel.installAppById(appId, source);
  }

  async installApp(app: InstalledAppLike, options?: UnknownRecord): Promise<AppDescription | null> {
    return this.kernel.installAppInstance(app, options);
  }

  registerTool<TInput extends ProtocolValue = ProtocolValue, TOutput extends ProtocolValue = ProtocolValue>(
    tool: ToolDefinition<TInput, TOutput>,
  ): ToolDefinition<TInput, TOutput> {
    return this.kernel.registerTool(tool);
  }

  whenIdle(): Promise<void> {
    return this.kernel.whenIdle();
  }

  isIdle(): boolean {
    return this.kernel.isIdle();
  }

  observeTaskEvents(callback: TaskEventListener, options?: UnknownRecord): () => void {
    return this.kernel.observeTaskEvents(callback, options) as () => void;
  }

  observeKernelEvents(
    callback: KernelEventListener,
    options?: {
      category?: KernelObservedEvent['category'] | null;
      type?: string | null;
    },
  ): () => void {
    return this.kernel.observeKernelEvents(callback, options);
  }

  describeSelf(): SelfDescription {
    return this.kernel.describeSelf();
  }

  snapshotMemory(): MemorySnapshot {
    return this.kernel.snapshotMemory();
  }

  findTaskBySignalId(signalId: string): TaskRecord | null {
    return this.kernel.findTaskBySignalId(signalId);
  }

  getTask(taskId: string): TaskRecord | null {
    return this.kernel.getTask(taskId);
  }

  listTaskEvents(taskId: string): TaskEventEntry[] {
    return this.kernel.listTaskEvents(taskId);
  }

  snapshotState(): AgentStateSnapshot {
    return this.kernel.snapshotState();
  }

  async restoreState(snapshot: AgentStateSnapshot): Promise<void> {
    return this.kernel.restoreState(snapshot);
  }

  listConversations(): ConversationRecord[] {
    return this.kernel.listConversations();
  }

  describeConversation(conversationId: string | null): ConversationRecord | null {
    return this.kernel.describeConversation(conversationId);
  }

  dispose(): void {
    this.kernel.dispose();
  }
}
