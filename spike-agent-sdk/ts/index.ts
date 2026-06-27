import { query } from '@anthropic-ai/claude-agent-sdk';
import { fileURLToPath } from 'node:url';

// Load CLAUDE_CODE_OAUTH_TOKEN (and any other vars) from the .env next to this
// file. Node 20.12+/22 ships process.loadEnvFile natively, so no dependency.
try {
  process.loadEnvFile(fileURLToPath(new URL('.env', import.meta.url)));
} catch {
  // .env is optional; fall back to the ambient environment.
}

if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
  console.error(
    'CLAUDE_CODE_OAUTH_TOKEN is not set. Run `claude setup-token` first.'
  );
  process.exit(1);
}

for await (const message of query({
  prompt: 'In one sentence, say hello and tell me which model you are.',
  options: { allowedTools: [] }
})) {
  if (message.type === 'result') {
    console.log(message.result);
  }
}
