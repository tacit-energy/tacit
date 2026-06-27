import asyncio
import os
import sys

# Windows consoles default to cp1252, which can't encode characters the model
# often returns (π, emoji, box-drawing). Force UTF-8 so print() doesn't crash.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

from dotenv import load_dotenv

from claude_agent_sdk import (
    query,
    ClaudeAgentOptions,
    AssistantMessage,
    TextBlock,
    ResultMessage,
)

load_dotenv()  # read CLAUDE_CODE_OAUTH_TOKEN from .env


async def main() -> None:
    if not os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
        sys.exit("CLAUDE_CODE_OAUTH_TOKEN is not set. Run `claude setup-token` and put it in .env first.")

    print(">> running query (an agent turn can take 30-60s)...", flush=True)
    async for message in query(
        prompt="create a plot of a sine wave.",
        options=ClaudeAgentOptions(allowed_tools=[]),
    ):
        # Stream assistant text so it doesn't look frozen while the model works.
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock):
                    print(block.text, flush=True)
        if isinstance(message, ResultMessage):
            print("\n>> RESULT:\n" + (message.result or ""), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
