import { ChatPanel } from '@/chat/ChatPanel';
import { Workspace } from '@/workspace/Workspace';
import { useAgentStream } from '@/lib/agent-store';

export function SessionPage({
  sessionId,
  onBack,
  onOpenSettings
}: {
  sessionId: string;
  onBack: () => void;
  onOpenSettings: () => void;
}) {
  const { state, send, answerPermission, interrupt } = useAgentStream(sessionId);

  return (
    <div className="grid h-full min-h-0 min-w-0 grid-cols-[minmax(380px,460px)_1fr] grid-rows-[minmax(0,1fr)] overflow-hidden bg-[image:var(--workspace-background)] text-[var(--foreground)]">
      <ChatPanel
        state={state}
        send={send}
        answerPermission={answerPermission}
        interrupt={interrupt}
        onBack={onBack}
      />
      <Workspace
        widgets={state.widgets}
        sessionId={sessionId}
        onOpenSettings={onOpenSettings}
        onInsightAction={(action, _id, title) =>
          send(
            action === 'accept'
              ? `I accept the insight "${title}". Please note this decision and the current system context.`
              : `I'm dismissing the insight "${title}" — it isn't actionable right now.`
          )
        }
      />
    </div>
  );
}
