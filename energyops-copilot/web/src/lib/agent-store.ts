// Reduces the server's SSE event stream into UI state: a chat feed, a live
// streaming bubble, the workspace widgets, and a status line. Mirrors the
// rendering logic from the spike's index.html, restructured as a reducer.

import { useCallback, useEffect, useReducer } from 'react';
import type { ServerEvent, Widget } from '@shared/types';

export type FeedItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'thinking'; id: string; text: string }
  | {
      kind: 'tool';
      id: string;
      name: string;
      input: unknown;
      status: 'running' | 'done' | 'error';
      result?: string;
    }
  | {
      kind: 'permission';
      id: string;
      toolName: string;
      input: unknown;
      status: 'waiting' | 'allowed' | 'denied';
    }
  | { kind: 'meta'; id: string; text: string };

export interface AgentState {
  feed: FeedItem[];
  streaming: string | null;
  widgets: Widget[];
  status: string;
  working: boolean;
}

const initialState: AgentState = {
  feed: [],
  streaming: null,
  widgets: [],
  status: 'connecting…',
  working: false
};

let seq = 0;
const uid = () => `f${++seq}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reduceSdk(state: AgentState, m: any): AgentState {
  switch (m?.type) {
    case 'system':
      if (m.subtype === 'init') {
        return {
          ...state,
          status: 'ready',
          working: false,
          feed: [
            ...state.feed,
            { kind: 'meta', id: uid(), text: `session · ${m.model}` }
          ]
        };
      }
      return state;

    case 'stream_event': {
      const ev = m.event;
      if (
        ev?.type === 'content_block_delta' &&
        ev.delta?.type === 'text_delta'
      ) {
        return {
          ...state,
          working: true,
          status: 'working…',
          streaming: (state.streaming ?? '') + ev.delta.text
        };
      }
      return { ...state, working: true, status: 'working…' };
    }

    case 'assistant': {
      let feed = state.feed;
      for (const block of m.message.content) {
        if (block.type === 'text' && block.text.trim()) {
          feed = [...feed, { kind: 'assistant', id: uid(), text: block.text }];
        } else if (block.type === 'thinking' && block.thinking) {
          feed = [
            ...feed,
            { kind: 'thinking', id: uid(), text: block.thinking }
          ];
        } else if (block.type === 'tool_use') {
          feed = [
            ...feed,
            {
              kind: 'tool',
              id: block.id,
              name: block.name,
              input: block.input,
              status: 'running'
            }
          ];
        }
      }
      return { ...state, feed, streaming: null };
    }

    case 'user': {
      const content = m.message?.content;
      if (!Array.isArray(content)) return state;
      let feed = state.feed;
      for (const block of content) {
        if (block.type !== 'tool_result') continue;
        const text =
          typeof block.content === 'string'
            ? block.content
            : Array.isArray(block.content)
              ? block.content
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  .filter((c: any) => c.type === 'text')
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  .map((c: any) => c.text)
                  .join('\n')
              : '';
        feed = feed.map(f =>
          f.kind === 'tool' && f.id === block.tool_use_id
            ? { ...f, status: block.is_error ? 'error' : 'done', result: text }
            : f
        );
      }
      return { ...state, feed };
    }

    case 'result': {
      const dur = m.duration_ms ? ` · ${(m.duration_ms / 1000).toFixed(1)}s` : '';
      const cost = m.total_cost_usd ? ` · $${m.total_cost_usd.toFixed(4)}` : '';
      return {
        ...state,
        streaming: null,
        working: false,
        status: `ready${dur}${cost}`
      };
    }
  }
  return state;
}

function reduceEvent(state: AgentState, event: ServerEvent): AgentState {
  switch (event.kind) {
    case 'sdk':
      return reduceSdk(state, event.message);
    case 'widget': {
      // Upsert: reusing an id replaces the widget in place (refinement);
      // a new id appends.
      const exists = state.widgets.some(w => w.id === event.widget.id);
      return {
        ...state,
        widgets: exists
          ? state.widgets.map(w =>
              w.id === event.widget.id ? event.widget : w
            )
          : [...state.widgets, event.widget]
      };
    }
    case 'widget_update':
      return {
        ...state,
        widgets: state.widgets.map(w =>
          w.id === event.id ? ({ ...w, ...event.patch } as Widget) : w
        )
      };
    case 'widget_remove':
      return {
        ...state,
        widgets:
          event.id === 'all'
            ? []
            : state.widgets.filter(w => w.id !== event.id)
      };
    case 'permission_request':
      return {
        ...state,
        feed: [
          ...state.feed,
          {
            kind: 'permission',
            id: event.id,
            toolName: event.toolName,
            input: event.input,
            status: 'waiting'
          }
        ]
      };
    case 'permission_resolved':
      return {
        ...state,
        feed: state.feed.map(f =>
          f.kind === 'permission' && f.id === event.id
            ? { ...f, status: event.behavior === 'allow' ? 'allowed' : 'denied' }
            : f
        )
      };
    case 'error':
      return {
        ...state,
        working: false,
        feed: [...state.feed, { kind: 'meta', id: uid(), text: `⚠ ${event.error}` }]
      };
  }
  return state;
}

type Action =
  | { type: 'event'; event: ServerEvent }
  | { type: 'user'; text: string }
  | { type: 'status'; text: string }
  | { type: 'reset' };

function reducer(state: AgentState, action: Action): AgentState {
  switch (action.type) {
    case 'reset':
      return initialState;
    case 'event':
      return reduceEvent(state, action.event);
    case 'user':
      return {
        ...state,
        working: true,
        status: 'working…',
        feed: [...state.feed, { kind: 'user', id: uid(), text: action.text }]
      };
    case 'status':
      return { ...state, status: action.text };
  }
}

export interface PermissionAnswer {
  behavior: 'allow' | 'deny';
  message?: string;
  always?: boolean;
  updatedInput?: Record<string, unknown>;
}

export function useAgentStream(sessionId: string) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    dispatch({ type: 'reset' });
    const es = new EventSource(`/sessions/${sessionId}/events`);
    es.onmessage = e => {
      if (!e.data) return;
      dispatch({ type: 'event', event: JSON.parse(e.data) as ServerEvent });
    };
    es.onerror = () =>
      dispatch({ type: 'status', text: 'disconnected — is the server running?' });
    return () => es.close();
  }, [sessionId]);

  const send = useCallback(
    async (text: string) => {
      dispatch({ type: 'user', text });
      await fetch(`/sessions/${sessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
    },
    [sessionId]
  );

  const answerPermission = useCallback(
    async (id: string, answer: PermissionAnswer) => {
      await fetch(`/sessions/${sessionId}/permission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...answer })
      });
    },
    [sessionId]
  );

  const interrupt = useCallback(() => {
    void fetch(`/sessions/${sessionId}/interrupt`, { method: 'POST' });
  }, [sessionId]);

  return { state, send, answerPermission, interrupt };
}
