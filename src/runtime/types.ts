import type {
  AgentStateSnapshot,
  KernelObservedEvent,
  KernelSchedulerEvent,
  PolicyDeniedKernelEvent,
  SignalLike,
  SignalMetadata,
  SignalPayload,
  TaskEventEntry,
} from '../agent/types.js';

export interface RuntimeEventBase {
  type: string;
  createdAt: number;
  agentId?: string | null;
}

export interface RuntimeAgentLifecycleEvent extends RuntimeEventBase {
  type: 'agent.created' | 'agent.disposed';
  agentId: string;
}

export interface RuntimeStateEvent extends RuntimeEventBase {
  type: 'state.saved' | 'state.loaded' | 'state.restored';
  reason: string;
  agentCount: number;
}

export interface RuntimeSignalEvent extends RuntimeEventBase {
  type: 'signal.dispatched' | 'signal.published';
  agentId: string | null;
  signal: SignalLike;
}

export interface RuntimeTaskEvent extends RuntimeEventBase {
  type: 'task.event';
  agentId: string;
  taskId: string;
  event: TaskEventEntry;
}

export interface RuntimeSchedulerEvent extends RuntimeEventBase {
  type: 'scheduler.event';
  agentId: string;
  event: KernelSchedulerEvent;
}

export interface RuntimePolicyEvent extends RuntimeEventBase {
  type: 'policy.event';
  agentId: string;
  event: PolicyDeniedKernelEvent;
}

export interface RuntimeKernelEvent extends RuntimeEventBase {
  type: 'kernel.event';
  agentId: string;
  event: KernelObservedEvent;
}

export type RuntimeObservedEvent =
  | RuntimeAgentLifecycleEvent
  | RuntimeStateEvent
  | RuntimeSignalEvent
  | RuntimeTaskEvent
  | RuntimeSchedulerEvent
  | RuntimePolicyEvent
  | RuntimeKernelEvent;

export type RuntimeObservedEventType = RuntimeObservedEvent['type'];

export interface RuntimeEventFilter {
  agentId?: string | null;
  type?: RuntimeObservedEventType | null;
  taskId?: string | null;
  eventType?: string | null;
  since?: number | null;
  limit?: number | null;
}

export interface RuntimeSnapshot {
  version: number;
  createdAt?: number;
  agents: AgentStateSnapshot[];
}

export interface WebhookEventRequest {
  to: string;
  type: string;
  payload?: SignalPayload;
  targetAppId?: string | null;
  targetTaskId?: string | null;
  conversationId?: string | null;
  metadata?: SignalMetadata;
}

export interface WebhookAcceptedResponse {
  accepted: true;
  signalId: string;
  conversationId?: string | null;
  to: string;
  type: string;
}
