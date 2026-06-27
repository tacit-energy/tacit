// Per-session context handed to the tool factories. Binds tools to one session's
// dataset and its event stream, so each agent session is isolated.
import type { ServerEvent, Widget } from '../types.js';

export interface ToolContext {
  datasetId: string;
  sessionId?: string;
  broadcast: (event: ServerEvent) => void;
  nextWidgetId: () => string;
}

export function emitWidget(ctx: ToolContext, widget: Widget, replaceId?: string): string {
  const id = replaceId ?? widget.id;
  ctx.broadcast({ kind: 'widget', widget: { ...widget, id } as Widget });
  return id;
}
