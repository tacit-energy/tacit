// Per-session event bus. Each session has its own Bus: events are stored (so a
// reconnecting browser can replay the session) and pushed live to subscribers.

import type { ServerEvent } from './types.js';

type Listener = (event: ServerEvent) => void;

export class Bus {
  private history: ServerEvent[] = [];
  private listeners = new Set<Listener>();

  broadcast = (event: ServerEvent): void => {
    this.history.push(event);
    for (const listener of this.listeners) listener(event);
  };

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getHistory(): readonly ServerEvent[] {
    return this.history;
  }
}
