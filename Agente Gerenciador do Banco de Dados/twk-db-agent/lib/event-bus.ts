/**
 * TWK Event Bus — In-memory pub/sub for real-time agent activity streaming.
 * All tool calls, DB queries, and audit operations emit events here.
 * The /api/stream endpoint subscribes and forwards via SSE.
 */

export type AgentEventType =
  | 'tool.call.start'
  | 'tool.call.end'
  | 'tool.call.error'
  | 'db.query'
  | 'db.mutation'
  | 'audit.start'
  | 'audit.progress'
  | 'audit.complete'
  | 'system.metric'
  | 'agent.thinking'
  | 'agent.response'
  | 'notification';

export interface AgentEvent {
  id:        string;
  type:      AgentEventType;
  timestamp: number;
  duration?: number;
  source?:   string;
  data:      Record<string, unknown>;
}

type Listener = (event: AgentEvent) => void;

class EventBus {
  private listeners = new Set<Listener>();
  private recent: AgentEvent[] = [];
  private maxRecent = 200;

  emit(type: AgentEventType, data: Record<string, unknown> = {}, source?: string, duration?: number) {
    const event: AgentEvent = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type, timestamp: Date.now(), source, duration, data,
    };
    this.recent.push(event);
    if (this.recent.length > this.maxRecent) this.recent.shift();
    for (const l of this.listeners) {
      try { l(event); } catch { /* ignore listener errors */ }
    }
    return event.id;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getRecent(limit = 50): AgentEvent[] {
    return this.recent.slice(-limit).reverse();
  }

  getStats() {
    const now = Date.now();
    const last5min = this.recent.filter((e) => now - e.timestamp < 5 * 60_000);
    const lastHour = this.recent.filter((e) => now - e.timestamp < 60 * 60_000);
    const toolCalls = lastHour.filter((e) => e.type === 'tool.call.end');
    const avgLatency = toolCalls.length
      ? Math.round(toolCalls.reduce((s, e) => s + (e.duration ?? 0), 0) / toolCalls.length)
      : 0;
    return {
      events_5min: last5min.length,
      events_1h:   lastHour.length,
      tool_calls_1h: toolCalls.length,
      avg_tool_latency_ms: avgLatency,
      errors_1h: lastHour.filter((e) => e.type === 'tool.call.error').length,
    };
  }
}

// Singleton: must persist across hot-reloads in dev
const globalForBus = globalThis as unknown as { __twkBus?: EventBus };
export const bus = globalForBus.__twkBus ?? new EventBus();
if (!globalForBus.__twkBus) globalForBus.__twkBus = bus;
