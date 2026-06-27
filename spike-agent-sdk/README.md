# Agent SDK spike — subscription auth

Minimal spike running the Claude Agent SDK against your **Claude Pro/Max subscription**
(no Anthropic API key) via a long-lived OAuth token.

## 1. Generate the OAuth token (one-time, interactive)

Run this yourself in the terminal — it opens a browser for OAuth:

```
! claude setup-token
```

It prints a token (valid ~1 year, inference-only). Export it:

```
export CLAUDE_CODE_OAUTH_TOKEN=<token-it-printed>
```

> Gotcha: if `ANTHROPIC_API_KEY` is set it takes precedence and overrides the
> subscription token. Currently it is **not** set in this shell, so you're fine.
> If it ever is: `unset ANTHROPIC_API_KEY`.

## 2. Run a spike

TypeScript:
```
cd ts && npm install && npm start
```

Python:
```
cd py && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt && python main.py
```

## Web chat spike (`ts/server.ts`)

`npm run web` (in `ts/`) starts a chat UI at http://localhost:3456 that shows the
full agent loop: streaming text, thinking, tool calls with live status, and a
permission prompt for risky built-in tools. It demonstrates the three things this
spike is about:

- **External data** — a sample filesystem under `ts/data/` (building energy/heating
  readings + maintenance notes). The agent browses it via the `list_data_files` /
  `read_data_file` tools (sandboxed to that folder). Regenerate with
  `node ../<scratch>/gen-data.mjs ./data` is not needed; the files are committed.
- **Custom visualization** — the `display_chart` tool pushes an interactive ECharts
  widget straight into the chat; `show_image` embeds an image file.
- **Agent state** — every SDK message is streamed to the browser over SSE.

Try: *"Plot the daily energy use for Seestrasse 8 over the last 30 days and tell me
if anything looks off."* (The data has a deliberate anomaly.)

The safe in-process demo tools auto-approve; built-in tools (Bash/Write/…) still
trigger the permission UI.

## Notes
- The SDK shells out to the `claude` CLI (already installed: v2.1.173).
- As of 2026-06-15, SDK / `claude -p` subscription usage draws from a separate
  monthly Agent SDK credit pool (distinct from claude.ai web limits).
- ToS: subscription OAuth tokens are for your own use, not for reselling/embedding
  in a third-party product.
