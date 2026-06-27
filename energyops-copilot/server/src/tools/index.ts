// Builds the in-process MCP server for one session, bound to its dataset and
// event stream. Tool names become mcp__eo__<name>.

import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { dataTools } from './data.js';
import { scanTools } from './scan.js';
import { widgetTools } from './widgets.js';
import { annotationTools } from './annotations.js';
import type { ToolContext } from './context.js';

export function makeEoTools(ctx: ToolContext) {
  return createSdkMcpServer({
    name: 'eo',
    version: '0.3.0',
    tools: [
      ...dataTools(ctx),
      ...scanTools(ctx),
      ...widgetTools(ctx),
      ...annotationTools(ctx)
    ]
  });
}
