import type {
  AppDefinition,
  AppDefinitionSummary,
  AppDescription,
  AppLike as InstalledAppLike,
  AssistantModelResult,
  ModelProviderDescription,
} from '../apps/types.js';

export type UnknownRecord = Record<string, unknown>;

export type MaybePromise<T> = T | Promise<T>;

export interface ProtocolRecord {
  [key: string]: ProtocolValue;
}

export type ProtocolValue =
  | string
  | number
  | boolean
  | null
  | ProtocolValue[]
  | ProtocolRecord
  | object;

export type SignalKind = 'message' | 'event' | 'timer' | 'tool' | 'reply' | 'system';

export type SignalPayload = ProtocolRecord | null;

export type SignalMetadata = ProtocolRecord;

export interface SignalLike {
  id: string;
  kind: SignalKind;
  type: string;
  to: string;
  from: string | null;
  payload: SignalPayload;
  createdAt?: number;
  conversationId?: string | null;
  targetAppId?: string | null;
  targetTaskId?: string | null;
  metadata?: SignalMetadata | null;
}

export interface SignalMatcherInput {
  kind?: string | string[] | null;
  kinds?: string | string[] | null;
  type?: string | string[] | null;
  types?: string | string[] | null;
  from?: string | string[] | null;
  targetAppId?: string | string[] | null;
  targetTaskId?: string | string[] | null;
  metadata?: ProtocolRecord | null;
}

export interface WaitInput {
  reason?: string;
  resumeOnSignals?: string | SignalMatcherInput | Array<string | SignalMatcherInput>;
  kind?: string | string[] | null;
  kinds?: string | string[] | null;
  type?: string | string[] | null;
  types?: string | string[] | null;
  from?: string | string[] | null;
  dependencyTaskIds?: string | string[];
  pendingDependencyTaskIds?: string | string[];
  timeoutMs?: number | null;
  timeoutType?: string | null;
  timeoutPayload?: ProtocolRecord | null;
  timeoutMetadata?: ProtocolRecord | null;
  timeoutTimerId?: string | null;
  timeoutAt?: number | null;
  timeoutSignalType?: string | null;
  targetAppId?: string | null;
  targetTaskId?: string | string[] | null;
  metadata?: ProtocolRecord | null;
}

export interface TaskRecord {
  id: string;
  appId: string | null;
  title?: string;
  status?: string;
  conversationId: string | null;
  signalIds?: string[];
  createdAt?: number;
  updatedAt?: number;
  lastSignalId?: string | null;
  result?: ProtocolValue;
  error?: ProtocolValue | null;
  waitingReason?: string | null;
  wait?: WaitInput | null;
  metadata?: ProtocolRecord;
}

export interface TaskEventRecord {
  type: string;
  signalId?: string | null;
  data?: TaskEventData | null;
  createdAt?: number;
}

export interface TaskEventEntry extends TaskEventRecord {
  id: string;
  taskId: string;
  signalId: string | null;
  createdAt: number;
  data: TaskEventData;
}

export interface TaskInboxEntry {
  id: string;
  taskId: string;
  signal: SignalLike;
  source?: string;
  queuedAt: number;
}

export interface TaskInboxReader {
  list(): TaskInboxEntry[];
  peek(): TaskInboxEntry | null;
  size(): number;
}

export interface TaskInboxView extends TaskInboxReader {
  drain(): TaskInboxEntry[];
  clear(): number;
}

export interface TaskRuntimeSnapshot {
  tasks: TaskRecord[];
  inboxes: Record<string, TaskInboxEntry[]>;
  events: Record<string, TaskEventEntry[]>;
}

export interface TaskCreatedEventData {
  appId: string | null;
  title: string;
  signalType: string;
  signalKind: SignalKind;
}

export interface TaskUpdatePatch {
  title?: string | null;
  metadata?: ProtocolRecord;
  wait?: string | WaitInput | null;
  result?: ProtocolValue;
  error?: ProtocolValue | null;
  status?: string;
}

export interface TaskUpdatedEventData {
  patch: TaskUpdatePatch;
}

export interface TaskResumedEventData {
  signalType: string;
  signalKind: SignalKind;
}

export interface TaskCompletedEventData {
  hasResult: boolean;
}

export interface TaskWaitingEventData {
  wait: WaitInput;
}

export interface TaskErrorDescription extends ToolErrorDescription {
  stack?: string;
}

export interface TaskFailedEventData {
  error: TaskErrorDescription;
}

export interface TaskCancelledEventData {
  reason: string;
}

export interface TaskInboxEnqueuedEventData {
  source: string;
  signalType: string;
  signalKind: SignalKind;
}

export interface TaskDependencyProgressEventData {
  dependencyTaskId: string;
  resolution: string;
  remainingDependencyTaskIds: string[];
}

export interface TaskDependencyReadyEventData {
  dependencyTaskId: string;
  resolution: string;
  dependencyTaskIds: string[];
}

export interface TaskTimeoutScheduledEventData {
  timerId: string;
  scheduleId: string;
  dueAt: number;
  signalType: string;
}

export interface TaskTimeoutCancelledEventData {
  timerId: string;
  scheduleId: string;
}

export interface TaskSignalReceivedEventData {
  signalType: string;
  signalKind: SignalKind;
  from: string | null;
  routeAction: string;
  routeSource: string;
}

export interface TaskScheduleEventData {
  scheduleId: string;
  kind?: string;
  label?: string;
  dueAt?: number;
  intervalMs?: number | null;
}

export interface TaskInboxMutationEventData {
  count: number;
  signalTypes?: string[];
}

export interface TaskToolCallEventData {
  callId: string;
  toolName: string | null;
  input: ProtocolValue;
}

export interface TaskToolResultEventData extends ToolCallSignalResultPayload {}

export type TaskEventData =
  | TaskCreatedEventData
  | TaskUpdatedEventData
  | TaskResumedEventData
  | TaskCompletedEventData
  | TaskWaitingEventData
  | TaskFailedEventData
  | TaskCancelledEventData
  | TaskInboxEnqueuedEventData
  | TaskDependencyProgressEventData
  | TaskDependencyReadyEventData
  | TaskTimeoutScheduledEventData
  | TaskTimeoutCancelledEventData
  | TaskSignalReceivedEventData
  | TaskScheduleEventData
  | TaskInboxMutationEventData
  | TaskToolCallEventData
  | TaskToolResultEventData
  | ModelStreamEvent
  | ProtocolRecord;

export interface DispatchHandleLike<TResult = ProtocolValue | null> {
  conversationId?: string | null;
  signal: SignalLike;
  whenIdle(): Promise<DispatchHandleLike<TResult>>;
  conversation(): ConversationRecord | null;
  task(): TaskRecord | null;
  lastTask(): TaskRecord | ConversationTaskSummary | null;
  events(): TaskEventEntry[];
  result(): Promise<TResult>;
}

export interface ToolRequestHandle {
  callId: string;
  signal: SignalLike;
}

export interface ToolCallSignalPayload extends ProtocolRecord {
  callId: string;
  toolName: string;
  input: ProtocolValue;
}

export interface ToolErrorDescription {
  name?: string;
  message: string;
}

export interface ToolCallSignalResultPayload extends ProtocolRecord {
  callId: string;
  toolName: string | null;
  input: ProtocolValue;
  ok: boolean;
  output: ProtocolValue;
  error: ToolErrorDescription | null;
}

export interface MemorySnapshot {
  agent: ProtocolRecord;
  apps: Record<string, ProtocolRecord>;
  tasks: Record<string, ProtocolRecord>;
  conversations: Record<string, ProtocolRecord>;
  named: Record<string, Record<string, ProtocolRecord>>;
}

export interface MemorySummary {
  agentKeys: string[];
  appScopes: string[];
  taskScopes: string[];
  conversationScopes: string[];
  namedScopes: Record<string, string[]>;
}

export interface ConversationSignalSummary {
  id: string;
  kind: string;
  type: string;
  from: string | null;
  to: string;
  createdAt: number;
}

export interface ConversationTaskSummary {
  id: string;
  appId: string | null | undefined;
  title?: string;
  status?: string;
  updatedAt: number;
  waitingReason: string | null;
  result: ProtocolValue | null;
  error: ProtocolValue | null;
}

export interface ConversationRecord {
  conversationId: string;
  createdAt: number;
  updatedAt: number;
  signalCount: number;
  participants: string[];
  appIds: string[];
  taskIds: string[];
  lastSignal: ConversationSignalSummary | null;
  lastTask: ConversationTaskSummary | null;
}

export interface PolicyDescription {
  allowedTools: string[] | null;
  allowedModelProviders: string[] | null;
  allowedApps: string[] | null;
  installableApps: string[] | null;
  allowAppInstallation: boolean;
  maxActiveTasks: number | null;
  maxActiveSchedules: number | null;
  allowRecurringSchedules: boolean;
  minScheduleIntervalMs: number | null;
}

export interface SelfModelHistoryEntry {
  id: string;
  type: string;
  details: UnknownRecord;
  createdAt: number;
}

export interface ToolSpec extends UnknownRecord {
  name: string;
  description?: string;
  inputSchema?: UnknownRecord | null;
  outputSchema?: UnknownRecord | null;
}

export interface ToolExecutionContext {
  agentId: string;
  appId: string | null;
  taskId: string | null;
  signal: SignalLike;
}

export interface ToolDefinition<TInput extends ProtocolValue = ProtocolValue, TOutput extends ProtocolValue = ProtocolValue> extends ToolSpec {
  execute: (input: TInput, context: ToolExecutionContext) => MaybePromise<TOutput>;
}

export interface ScheduleRecord {
  id: string;
  kind: string;
  label: string;
  createdAt: number;
  dueAt: number;
  intervalMs: number | null;
  fireCount: number;
  active: boolean;
  signalTemplate: SignalLike;
  metadata: ProtocolRecord;
  maxRuns: number | null;
  lastFiredAt?: number;
  cancelledAt?: number;
  completedAt?: number;
  nextRunAt?: number;
}

export interface SchedulerEvent {
  type: string;
  scheduleId: string;
  schedule: ScheduleRecord;
  data: ProtocolRecord;
  createdAt: number;
}

export interface ModelContentPart {
  type?: string;
  text?: string | null;
  url?: string;
  data?: string | ArrayBuffer | ArrayBufferView;
  mimeType?: string;
  detail?: string;
}

export interface ToolCallLike {
  id?: string | null;
  type?: string | null;
  name?: string | null;
  arguments?: ProtocolValue;
  index?: number | null;
  callId?: string | null;
  argumentsDelta?: string | null;
}

export interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export type ModelToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | {
      name: string;
    };

export interface ModelToolResult {
  callId: string;
  toolName: string | null;
  ok: boolean;
  output: ProtocolValue;
  error: string | null;
}

export interface ModelMessage {
  role: string;
  content?: string | ModelContentPart[];
  toolCalls?: ToolCallLike[];
  toolCallId?: string;
  name?: string | null;
}

interface ModelStreamEventBase {
  providerId?: string | null;
  model?: string | null;
  responseId?: string | null;
}

export interface ModelResponseStartedEvent extends ModelStreamEventBase {
  type: 'response.started';
}

export interface ModelTextDeltaEvent extends ModelStreamEventBase {
  type: 'text.delta';
  text: string;
}

export interface ModelToolCallDeltaEvent extends ModelStreamEventBase {
  type: 'tool.call.delta';
  index?: number | null;
  callId?: string | null;
  name?: string | null;
  argumentsDelta?: string | null;
}

export interface ModelToolResultEvent extends ModelStreamEventBase {
  type: 'tool.result';
  toolResult: ModelToolResult;
}

export interface ModelResponseCompletedEvent extends ModelStreamEventBase {
  type: 'response.completed';
  text?: string;
  toolCalls?: ToolCallLike[];
  finishReason?: string | null;
  usage?: ModelUsage | null;
  message?: ModelMessage;
  raw?: UnknownRecord | null;
}

export type ModelStreamEvent =
  | ModelResponseStartedEvent
  | ModelTextDeltaEvent
  | ModelToolCallDeltaEvent
  | ModelToolResultEvent
  | ModelResponseCompletedEvent;

export interface SelfDescription {
  agentId: string;
  policy: PolicyDescription;
  apps: AppDescription[];
  tasks: TaskRecord[];
  conversations: ConversationRecord[];
  schedules: ScheduleRecord[];
  timers: ScheduleRecord[];
  tools: ToolSpec[];
  models: ModelProviderDescription[];
  memory: MemorySummary;
  history: SelfModelHistoryEntry[];
}

export interface AgentStateSnapshot {
  agentId: string;
  policy: PolicyDescription;
  apps: AppDescription[];
  conversations: ConversationRecord[];
  tasks: TaskRuntimeSnapshot;
  schedules: ScheduleRecord[];
  timers: ScheduleRecord[];
  memory: MemorySnapshot;
  history: SelfModelHistoryEntry[];
}

export interface MemoryScopeRef {
  kind: string;
  id: string | null;
}

export type MemoryScopeInput = string | MemoryScopeRef;

export interface MemoryScopeApi {
  get(key: string, fallback?: ProtocolValue | null): ProtocolValue | null;
  set(key: string, value: ProtocolValue): ProtocolValue;
  delete(key: string): boolean;
  entries(): ProtocolRecord;
  merge(values: ProtocolRecord): ProtocolRecord;
  clear(): boolean;
}

export type CreateMemoryScope = (scope: MemoryScopeInput, id?: string | null) => MemoryScopeApi;

export interface MemoryServiceLike {
  get(scope: MemoryScopeInput, key: string, fallback?: ProtocolValue | null): ProtocolValue | null;
  set(scope: MemoryScopeInput, key: string, value: ProtocolValue): ProtocolValue;
  delete(scope: MemoryScopeInput, key: string): boolean;
  entries(scope: MemoryScopeInput): ProtocolRecord;
  merge(scope: MemoryScopeInput, values: ProtocolRecord): ProtocolRecord;
  clear(scope: MemoryScopeInput): boolean;
  setAgent(key: string, value: ProtocolValue): ProtocolValue;
  snapshot(): MemorySnapshot;
  restore(snapshot: Partial<MemorySnapshot>): void;
  summary(): MemorySummary;
}

export interface TaskRuntimeLike {
  createTask(input: { appId: string | null; signal: SignalLike; title?: string | null }): TaskRecord;
  getTask(taskId: string): TaskRecord | null;
  updateTask(taskId: string, patch?: TaskUpdatePatch): TaskRecord;
  resumeTask(taskId: string, signal: SignalLike): TaskRecord;
  completeTask(taskId: string, result?: ProtocolValue): TaskRecord;
  waitTask(taskId: string, reasonOrOptions?: string | WaitInput): TaskRecord;
  waitForTasks(taskId: string, dependencyTaskIds: string | string[], options?: WaitInput): TaskRecord;
  failTask(taskId: string, error: unknown): TaskRecord;
  cancelTask(taskId: string, reason?: string): TaskRecord;
  enqueueSignal(taskId: string, signal: SignalLike, options?: { source?: string }): TaskInboxEntry;
  listInbox(taskId: string): TaskInboxEntry[];
  peekInbox(taskId: string): TaskInboxEntry | null;
  drainInbox(taskId: string): TaskInboxEntry[];
  clearInbox(taskId: string): number;
  inboxSize(taskId: string): number;
  resolveDependency(taskId: string, options?: { resolution?: string }): TaskRecord[];
  recordEvent(taskId: string, event: TaskEventRecord): TaskEventEntry;
  listEvents(taskId: string): TaskEventEntry[];
  subscribe(callback: TaskEventListener, options?: { taskId?: string | null }): () => void;
  listTasks(filters?: {
    appId?: string | null;
    status?: string | string[] | null;
    conversationId?: string | null;
  }): TaskRecord[];
  countActiveTasks(): number;
  findTaskBySignalId(signalId: string): TaskRecord | null;
  findResumableTask(signal: SignalLike, filters?: { appId?: string | null }): TaskRecord | null;
  snapshot(): TaskRuntimeSnapshot;
  restore(snapshot: TaskRuntimeSnapshot | TaskRecord[]): void;
}

export interface SchedulerLike {
  scheduleDelay(input: {
    delayMs: number;
    label: string;
    metadata?: ProtocolRecord;
    signal: SignalLike;
  }): ScheduleRecord;
  scheduleAt(input: {
    at: number | string | Date;
    label: string;
    signal: SignalLike;
  }): ScheduleRecord;
  scheduleRecurring(input: {
    intervalMs: number;
    startAt?: number | string | Date | null;
    label: string;
    signal: SignalLike;
    maxRuns?: number | null;
  }): ScheduleRecord;
  cancel(scheduleId: string): boolean;
  subscribe(callback: (event: SchedulerEvent) => void): () => void;
  countActiveSchedules(options?: { includeSystem?: boolean }): number;
  listSchedules(): ScheduleRecord[];
  listTimers?(): ScheduleRecord[];
  snapshot(): ScheduleRecord[];
  restore(snapshot: ScheduleRecord[]): void;
  dispose(): void;
}

export interface ToolAccessLike {
  registerTool<TInput extends ProtocolValue = ProtocolValue, TOutput extends ProtocolValue = ProtocolValue>(
    tool: ToolDefinition<TInput, TOutput>,
  ): ToolDefinition<TInput, TOutput>;
  listTools(): ToolSpec[];
  callTool(
    toolName: string,
    input: ProtocolValue,
    context: ToolExecutionContext,
  ): Promise<ProtocolValue>;
}

export interface ModelAccessLike {
  listProviders(): ModelProviderDescription[];
  stream(request: ModelRequest, modelContext: ModelProviderContext): AsyncIterable<ModelStreamEvent>;
  generate(request: ModelRequest, modelContext?: ModelProviderContext): Promise<AssistantModelResult>;
  run(request: ModelRequest, modelContext?: ModelProviderContext): Promise<AssistantModelResult>;
}

export interface ModelProviderInstanceLike {
  id: string;
  description?: string;
  defaultModel?: string | null;
  supportsVision?: boolean;
  supportsTools?: boolean;
  stream?: (request: ModelRequest, context?: ModelProviderContext) => AsyncIterable<ModelStreamEvent>;
  generate?: (request: ModelRequest, context?: ModelProviderContext) => Promise<AssistantModelResult>;
}

export interface ModelProviderRegistryLike {
  register(provider: ModelProviderInstanceLike): ModelProviderInstanceLike;
  get(providerId: string): ModelProviderInstanceLike | null;
  list(): ModelProviderDescription[];
}

export interface TaskListFilters extends UnknownRecord {
  appId?: string | null;
  status?: string | string[] | null;
  conversationId?: string | null;
}

export interface LifecycleContextInput {
  agentId: string;
  appId: string;
  source: string;
  describeSelf: () => SelfDescription;
  listInstalledApps: () => AppDescription[];
  listAvailableApps: () => AppDefinitionSummary[];
  listModelProviders: () => ModelProviderDescription[];
  createMemoryScope: CreateMemoryScope;
}

export interface LifecycleContext {
  agentId: string;
  appId: string;
  source: string;
  self: {
    describe: () => SelfDescription;
  };
  apps: {
    listInstalled: () => AppDescription[];
    listAvailable: () => AppDefinitionSummary[];
  };
  models: {
    list: () => ModelProviderDescription[];
  };
  memory: {
    agent: MemoryScopeApi;
    app: MemoryScopeApi;
    scope: (kind: string, id?: string | null) => MemoryScopeApi;
  };
}

export interface RoutingContextInput {
  agentId: string;
  appId: string;
  signal: SignalLike;
  policy: PolicyDescription;
  describeSelf: () => SelfDescription;
  listInstalledApps: () => AppDescription[];
  listAvailableApps: () => AppDefinitionSummary[];
  listTasks: (filters?: TaskListFilters) => TaskRecord[];
  getTask: (taskId: string) => TaskRecord | null;
  findResumableTask: (signal: SignalLike, filters?: TaskListFilters) => TaskRecord | null;
  taskInbox: (taskId: string) => TaskInboxReader;
  createMemoryScope: CreateMemoryScope;
}

export interface RoutingContext {
  agentId: string;
  appId: string;
  signal: SignalLike;
  policy: PolicyDescription;
  self: {
    describe: () => SelfDescription;
  };
  apps: {
    listInstalled: () => AppDescription[];
    listAvailable: () => AppDefinitionSummary[];
  };
  tasks: {
    list: (filters?: TaskListFilters) => TaskRecord[];
    get: (taskId: string) => TaskRecord | null;
    findResumable: (nextSignal?: SignalLike, filters?: TaskListFilters) => TaskRecord | null;
    inbox: (taskId: string) => TaskInboxReader;
  };
  memory: {
    agent: MemoryScopeApi;
    app: MemoryScopeApi;
    task: (taskId: string) => MemoryScopeApi;
    conversation: (conversationId: string | null) => MemoryScopeApi;
    scope: (kind: string, id?: string | null) => MemoryScopeApi;
  };
}

export interface ToolRequestOptions {
  targetAppId?: string | null;
  targetTaskId?: string | null;
  metadata?: ProtocolRecord;
}

export type TaskEventRecorder = (type: string, data?: TaskEventData) => TaskEventEntry;

export interface ScheduleRequestBase {
  type: string;
  payload?: ProtocolRecord | null;
  targetAppId?: string | null;
  targetTaskId?: string | null;
  metadata?: ProtocolRecord;
}

export interface DelayScheduleRequest extends ScheduleRequestBase {
  delayMs: number;
}

export interface AtScheduleRequest extends ScheduleRequestBase {
  at: number | string | Date;
}

export interface RecurringScheduleRequest extends ScheduleRequestBase {
  intervalMs: number;
  startAt?: number | string | Date | null;
  maxRuns?: number | null;
}

export interface ModelRequest extends UnknownRecord {
  provider?: string | null;
  model?: string | null;
  messages?: ModelMessage[];
  tools?: boolean | Array<string | ToolSpec>;
  autoExecuteTools?: boolean;
  maxToolRounds?: number;
  toolChoice?: ModelToolChoice;
  onEvent?: (event: ModelStreamEvent) => void;
  options?: UnknownRecord;
}

export interface ModelProviderContext extends UnknownRecord {
  tools?: {
    call?: (toolName: string, input: ProtocolValue) => Promise<ProtocolValue>;
    list?: () => ToolSpec[];
  };
  agentId?: string;
  appId?: string | null;
  taskId?: string | null;
  conversationId?: string | null;
  signal?: SignalLike;
}

export interface SignalEmitRequest {
  kind?: SignalKind;
  type: string;
  payload?: ProtocolRecord | null;
  targetAppId?: string | null;
  targetTaskId?: string | null;
  metadata?: ProtocolRecord;
}

export interface PublishSignalRequest {
  kind: SignalKind;
  type: string;
  to?: string;
  from?: string;
  payload?: ProtocolRecord | null;
  metadata?: ProtocolRecord;
}

export interface ReplySignalRequest {
  type?: string;
  to?: string;
  from?: string;
  payload?: ProtocolRecord | null;
  metadata?: ProtocolRecord;
}

export interface SendMessageRequest {
  to: string;
  type: string;
  payload?: ProtocolRecord | null;
  targetAppId?: string | null;
  targetTaskId?: string | null;
  metadata?: ProtocolRecord;
}

export interface EmitEventRequest {
  type: string;
  payload?: ProtocolRecord | null;
  targetAppId?: string | null;
  targetTaskId?: string | null;
  metadata?: ProtocolRecord;
}

export type TaskExecutionView = Omit<TaskRecord, 'wait'> & {
  get: () => TaskRecord | null;
  update: (patch: TaskUpdatePatch) => TaskRecord;
  events: () => TaskEventEntry[];
  record: (type: string, data?: TaskEventData) => TaskEventEntry;
  inbox: TaskInboxView;
  wait: (input?: string | WaitInput) => TaskRecord;
  awaitSignal: (input?: string | WaitInput) => TaskRecord;
  awaitTasks: (taskIds: string | string[], options?: WaitInput) => TaskRecord;
  waitForTasks: (taskIds: string | string[], options?: WaitInput) => TaskRecord;
  complete: (result?: ProtocolValue) => TaskRecord;
  fail: (error: unknown) => TaskRecord;
  cancel: (reason?: string) => TaskRecord;
};

export interface ExecutionContextInput {
  agentId: string;
  appId: string;
  task: TaskRecord;
  signal: SignalLike;
  policy: PolicyDescription;
  describeConversation: () => ConversationRecord | null;
  completeTask: (result?: ProtocolValue) => TaskRecord;
  waitForTask: (input?: string | WaitInput) => TaskRecord;
  waitForTasks: (taskIds: string | string[], options?: WaitInput) => TaskRecord;
  failTask: (error: unknown) => TaskRecord;
  cancelTask: (reason?: string) => TaskRecord;
  listTasks: (filters?: TaskListFilters) => TaskRecord[];
  getTask: (taskId?: string) => TaskRecord | null;
  updateTask: (patch: TaskUpdatePatch) => TaskRecord;
  listTaskEvents: () => TaskEventEntry[];
  recordTaskEvent: (type: string, data?: TaskEventData) => TaskEventEntry;
  listTaskInbox: () => TaskInboxEntry[];
  peekTaskInbox: () => TaskInboxEntry | null;
  drainTaskInbox: () => TaskInboxEntry[];
  clearTaskInbox: () => number;
  taskInboxSize: () => number;
  createMemoryScope: CreateMemoryScope;
  snapshotMemory: () => MemorySnapshot;
  listTools: () => ToolSpec[];
  callTool: (toolName: string, input?: ProtocolValue) => Promise<ProtocolValue>;
  requestTool: (toolName: string, input?: ProtocolValue, options?: ToolRequestOptions) => ToolRequestHandle;
  listModelProviders: () => ModelProviderDescription[];
  streamModel: (request?: ModelRequest) => AsyncIterable<ModelStreamEvent>;
  generateModel: (request?: ModelRequest) => MaybePromise<AssistantModelResult>;
  runModel: (request?: ModelRequest) => MaybePromise<AssistantModelResult>;
  scheduleDelay: (request: DelayScheduleRequest) => ScheduleRecord;
  scheduleAt: (request: AtScheduleRequest) => ScheduleRecord;
  scheduleRecurring: (request: RecurringScheduleRequest) => ScheduleRecord;
  cancelSchedule: (scheduleId: string) => boolean;
  listSchedules: () => ScheduleRecord[];
  emitToSelf: (input: SignalEmitRequest) => SignalLike;
  publishSignal: (input: PublishSignalRequest) => SignalLike;
  publishReply: (input: ReplySignalRequest) => SignalLike;
  sendMessage: (input: SendMessageRequest) => SignalLike;
  emitEvent: (input: EmitEventRequest) => SignalLike;
  listInstalledApps: () => AppDescription[];
  listAvailableApps: () => AppDefinitionSummary[];
  installApp: (appId: string) => MaybePromise<AppDescription | null>;
  uninstallApp: (appId: string) => boolean;
  describeSelf: () => SelfDescription;
  listSelfHistory: () => SelfModelHistoryEntry[];
}

export interface ExecutionContext {
  agentId: string;
  appId: string;
  task: TaskExecutionView;
  tasks: {
    list: (filters?: TaskListFilters) => TaskRecord[];
    get: (taskId?: string) => TaskRecord | null;
  };
  signal: SignalLike;
  conversation: {
    id: string | null;
    describe: () => ConversationRecord | null;
  };
  policy: PolicyDescription;
  complete: (result?: ProtocolValue) => TaskRecord;
  wait: (input?: string | WaitInput) => TaskRecord;
  waitForTasks: (taskIds: string | string[], options?: WaitInput) => TaskRecord;
  fail: (error: unknown) => TaskRecord;
  cancel: (reason?: string) => TaskRecord;
  memory: {
    agent: MemoryScopeApi;
    app: MemoryScopeApi;
    task: MemoryScopeApi;
    conversation: MemoryScopeApi;
    scope: (kind: string, id?: string | null) => MemoryScopeApi;
    snapshot: () => MemorySnapshot;
  };
  tools: {
    list: () => ToolSpec[];
    specs: () => ToolSpec[];
    call: (toolName: string, input?: ProtocolValue) => Promise<ProtocolValue>;
    request: (toolName: string, input?: ProtocolValue, options?: ToolRequestOptions) => ToolRequestHandle;
  };
  models: {
    list: () => ModelProviderDescription[];
    stream: (request?: ModelRequest) => AsyncIterable<ModelStreamEvent>;
    generate: (request?: ModelRequest) => MaybePromise<AssistantModelResult>;
    run: (request?: ModelRequest) => MaybePromise<AssistantModelResult>;
  };
  scheduler: {
    delay: (request: DelayScheduleRequest) => ScheduleRecord;
    at: (request: AtScheduleRequest) => ScheduleRecord;
    recurring: (request: RecurringScheduleRequest) => ScheduleRecord;
    cancel: (scheduleId: string) => boolean;
    list: () => ScheduleRecord[];
  };
  timers: {
    delay: (request: DelayScheduleRequest) => ScheduleRecord;
    at: (request: AtScheduleRequest) => ScheduleRecord;
    recurring: (request: RecurringScheduleRequest) => ScheduleRecord;
    cancel: (scheduleId: string) => boolean;
    list: () => ScheduleRecord[];
  };
  signals: {
    emitToSelf: (input: SignalEmitRequest) => SignalLike;
    publish: (input: PublishSignalRequest) => SignalLike;
    reply: (input: ReplySignalRequest) => SignalLike;
    sendMessage: (input: SendMessageRequest) => SignalLike;
    emitEvent: (input: EmitEventRequest) => SignalLike;
  };
  apps: {
    listInstalled: () => AppDescription[];
    listAvailable: () => AppDefinitionSummary[];
    install: (appId: string) => MaybePromise<AppDescription | null>;
    uninstall: (appId: string) => boolean;
  };
  self: {
    describe: () => SelfDescription;
    history: () => SelfModelHistoryEntry[];
  };
}

export interface AppLike {
  manifest: {
    id: string;
  };
}

export interface AppRegistryLike {
  register(definition: AppDefinition): AppDefinition;
  create(appId: string): InstalledAppLike;
  list(): AppDefinitionSummary[];
}

export interface AgentRuntimeLike {
  modelProviders: ModelProviderRegistryLike;
  publishSignal(signal: SignalLike): SignalLike;
  reply(input: {
    from: string;
    to: string;
    type?: string;
    payload?: ProtocolRecord | null;
    conversationId?: string | null;
    metadata?: ProtocolRecord;
  }): SignalLike;
  sendMessage(input: {
    from: string;
    to: string;
    type: string;
    payload?: ProtocolRecord | null;
    targetAppId?: string | null;
    targetTaskId?: string | null;
    conversationId?: string | null;
    metadata?: ProtocolRecord;
  }): SignalLike;
  ingestEvent(input: {
    to: string;
    type: string;
    payload?: ProtocolRecord | null;
    targetAppId?: string | null;
    targetTaskId?: string | null;
    conversationId?: string | null;
    metadata?: ProtocolRecord;
  }): SignalLike;
  event<TResult = ProtocolValue | null>(input: {
    to: string;
    type: string;
    payload?: ProtocolRecord | null;
    [key: string]: unknown;
  }): DispatchHandleLike<TResult>;
  text<TResult = ProtocolValue | null>(input: {
    to: string;
    text: string;
    [key: string]: unknown;
  }): DispatchHandleLike<TResult>;
  message<TResult = ProtocolValue | null>(input: {
    from: string;
    to: string;
    type: string;
    payload?: ProtocolRecord | null;
    [key: string]: unknown;
  }): DispatchHandleLike<TResult>;
  tell<TResult = ProtocolValue | null>(input: {
    from: string;
    to: string;
    text: string;
    [key: string]: unknown;
  }): DispatchHandleLike<TResult>;
}

export interface KernelAgentLike {
  id: string;
}

export interface RuntimeLike {
  modelProviders: ModelProviderRegistryLike;
  publishSignal(signal: SignalLike): SignalLike;
  reply(input: {
    from: string;
    to: string;
    type?: string;
    payload?: ProtocolRecord | null;
    conversationId?: string | null;
    metadata?: ProtocolRecord;
  }): SignalLike;
  sendMessage(input: {
    from: string;
    to: string;
    type: string;
    payload?: ProtocolRecord | null;
    targetAppId?: string | null;
    targetTaskId?: string | null;
    conversationId?: string | null;
    metadata?: ProtocolRecord;
  }): SignalLike;
  ingestEvent(input: {
    to: string;
    type: string;
    payload?: ProtocolRecord | null;
    targetAppId?: string | null;
    targetTaskId?: string | null;
    conversationId?: string | null;
    metadata?: ProtocolRecord;
  }): SignalLike;
}

export interface ConversationServiceLike {
  recordSignal(signal: SignalLike): ConversationRecord | null;
  recordTask(task: TaskRecord | null, details?: { appId?: string | null }): ConversationRecord | null;
  snapshot(): ConversationRecord[];
  restore(snapshot: ConversationRecord[]): void;
  listConversations(): ConversationRecord[];
  getConversation(conversationId: string | null): ConversationRecord | null;
}

export interface SelfModelLike {
  recordChange(type: string, details?: UnknownRecord): SelfModelHistoryEntry;
  listHistory(): SelfModelHistoryEntry[];
  snapshot(): SelfModelHistoryEntry[];
  restore(history: SelfModelHistoryEntry[]): void;
  describe(): SelfDescription;
}

export interface AppHostLike {
  describeInstalled(appId: string): AppDescription | null;
  install(app: InstalledAppLike, options?: { source?: string; installedAt?: number }): AppDescription | null;
  uninstall(appId: string): boolean;
  getApp(appId: string): InstalledAppLike | null;
  listApps(): AppDescription[];
  getAppsByPriority(): InstalledAppLike[];
}

export interface MailboxLike {
  enqueue(signal: SignalLike): SignalLike;
  whenIdle(): Promise<void>;
  isIdle(): boolean;
}

export interface PolicyDecision {
  ok: boolean;
  reason: string | null;
  details: UnknownRecord;
}

export type KernelSchedulerEvent = SchedulerEvent & {
  category: 'scheduler';
};

export interface PolicyDeniedKernelEvent {
  category: 'policy';
  type: 'policy.denied';
  operation: string;
  decision: PolicyDecision;
  details: UnknownRecord;
  createdAt: number;
}

export type KernelObservedEvent =
  | KernelSchedulerEvent
  | PolicyDeniedKernelEvent;

export interface PolicyLike {
  describe(): PolicyDescription;
  canUseTool(toolName: string): boolean;
  assertCanUseTool(toolName: string): void;
  canUseModel(providerId: string): boolean;
  assertCanUseModel(providerId: string): void;
  assertCanHostApp(appId: string): void;
  assertCanInstallApp(appId: string): void;
  evaluateTaskCreation(context?: { activeTaskCount?: number }): PolicyDecision;
  evaluateSchedule(context?: {
    recurring?: boolean;
    intervalMs?: number | null;
    activeScheduleCount?: number;
    system?: boolean;
  }): PolicyDecision;
}

export type NormalizedRouteDecision =
  | {
      action: 'ignore';
      task: null;
      title: null;
      source: string;
    }
  | {
      action: 'spawn';
      task: null;
      title: string | null;
      source: string;
    }
  | {
      action: 'resume' | 'queue' | 'interrupt';
      task: TaskRecord;
      title: string | null;
      source: string;
    };

export type TaskEventListener = (
  event: TaskEventEntry,
) => void;

export type KernelEventListener = (event: KernelObservedEvent) => void;
