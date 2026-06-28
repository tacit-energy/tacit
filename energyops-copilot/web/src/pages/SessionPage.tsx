import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { MessageCircle } from 'lucide-react';
import { ChatPanel, MarkdownContent } from '@/chat/ChatPanel';
import { Workspace } from '@/workspace/Workspace';
import { AnalyzingOverlay } from '@/components/AnalyzingOverlay';
import { useAgentStream } from '@/lib/agent-store';
import type { ProviderSettings } from '@/App';
import type { AgentState, FeedItem } from '@/lib/agent-store';

const compactText = (text: string, max = 220) => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
};

const drawerWidth = () => Math.min(460, window.innerWidth);

function latestAssistantMessage(state: AgentState) {
  return [...state.feed]
    .reverse()
    .find((f): f is Extract<FeedItem, { kind: 'assistant' }> => f.kind === 'assistant');
}

function LastThoughtCard({
  text,
  compact,
  onOpen
}: {
  text: string;
  compact: boolean;
  onOpen: () => void;
}) {
  if (compact) {
    return (
      <motion.button
        type="button"
        onClick={onOpen}
        initial={{ opacity: 0, y: 14, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.94 }}
        layoutId="last-thought-card"
        transition={{ duration: 0.28, ease: 'easeOut' }}
        className="absolute bottom-5 left-16 z-30 flex size-12 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel-strong)] text-[var(--accent)] shadow-[0_8px_24px_rgb(0_0_0/0.22)] [border-style:var(--border-style)] hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] sm:left-20"
        aria-label="Open chat"
        title="Open chat"
      >
        <MessageCircle size={19} />
      </motion.button>
    );
  }

  return (
    <div className="absolute bottom-5 left-16 right-5 z-30 max-w-[460px] sm:left-20">
      <motion.button
        type="button"
        onClick={onOpen}
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        layoutId="last-thought-card"
        transition={{ duration: 0.28, ease: 'easeOut' }}
        className="flex w-full items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 text-left shadow-[0_10px_28px_rgb(0_0_0/0.22)] [border-style:var(--border-style)] hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        aria-label="Open chat"
      >
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--secondary)] text-[var(--accent)]">
          <MessageCircle size={16} />
        </span>
        <span className="min-w-0">
          <span className="block text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            Last thought
          </span>
          <span className="mt-1 line-clamp-2 block text-[14px] leading-relaxed text-[var(--foreground)]">
            <MarkdownContent text={compactText(text)} />
          </span>
        </span>
      </motion.button>
    </div>
  );
}

export function SessionPage({
  sessionId,
  providerSettings,
  onBack,
  onOpenSettings,
  onOpenSession
}: {
  sessionId: string;
  providerSettings: ProviderSettings;
  onBack: () => void;
  onOpenSettings: () => void;
  onOpenSession?: (sessionId: string) => void;
}) {
  const [chatOpen, setChatOpen] = useState(false);
  const [nodeChartOpen, setNodeChartOpen] = useState(false);
  const [chatDrawerWidth, setChatDrawerWidth] = useState(drawerWidth);
  const closeChatAfterTurnBaseline = useRef<number | null>(null);
  const { state, send, answerPermission } = useAgentStream(sessionId, {
    claudeApiKey:
      providerSettings.provider === 'claude'
        ? providerSettings.claudeApiKey
        : undefined,
    claudeModel:
      providerSettings.provider === 'claude'
        ? providerSettings.claudeModel
        : undefined,
    openRouterApiKey:
      providerSettings.provider === 'openrouter'
        ? providerSettings.openRouterApiKey
        : undefined,
    azureEndpoint:
      providerSettings.provider === 'azure'
        ? providerSettings.azureEndpoint
        : undefined,
    azureApiKey:
      providerSettings.provider === 'azure'
        ? providerSettings.azureApiKey
        : undefined,
    azureModel:
      providerSettings.provider === 'azure'
        ? providerSettings.azureModel
        : undefined
  });

  // Show the overlay while attaching to the session or while an agent turn is live.
  // Restored sessions can legitimately have no widgets, so widget count should not
  // keep the workspace hidden after the stream is ready.
  const analyzing =
    state.status.startsWith('connecting') ||
    (state.completedTurns === 0 && state.working);
  const lastAssistant = useMemo(() => latestAssistantMessage(state), [state]);

  const sendFromChat = useCallback(
    (text: string) => {
      closeChatAfterTurnBaseline.current = state.completedTurns;
      send(text);
    },
    [send, state.completedTurns]
  );

  const explainInsight = useCallback(
    (text: string) => {
      closeChatAfterTurnBaseline.current = null;
      setChatOpen(true);
      send(text);
    },
    [send]
  );

  useEffect(() => {
    const baseline = closeChatAfterTurnBaseline.current;
    if (baseline !== null && state.completedTurns > baseline) {
      closeChatAfterTurnBaseline.current = null;
      setChatOpen(false);
    }
  }, [state.completedTurns]);

  useEffect(() => {
    setChatOpen(false);
    closeChatAfterTurnBaseline.current = null;
  }, [sessionId]);

  useEffect(() => {
    if (!chatOpen || state.status === 'message failed') {
      closeChatAfterTurnBaseline.current = null;
    }
  }, [chatOpen, state.status]);

  useEffect(() => {
    const onResize = () => setChatDrawerWidth(drawerWidth());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div className="relative h-full min-h-0 min-w-0 overflow-hidden bg-[image:var(--workspace-background)] text-[var(--foreground)]">
      <motion.div
        className="h-full min-h-0 min-w-0 overflow-hidden"
        initial={false}
        animate={{
          opacity: analyzing ? 0 : 1,
          scale: analyzing ? 0.985 : 1,
          filter: analyzing ? 'blur(6px)' : 'blur(0px)'
        }}
        transition={{ duration: analyzing ? 0.5 : 0.28, ease: 'easeOut' }}
      >
        <Workspace
          widgets={state.widgets}
          sessionId={sessionId}
          onBack={onBack}
          onNodeChartOpenChange={setNodeChartOpen}
          onExplainInsight={explainInsight}
          onOpenSettings={onOpenSettings}
          onOpenSession={onOpenSession}
          chatInset={chatOpen && !analyzing ? chatDrawerWidth : 0}
        />
      </motion.div>

      <LayoutGroup>
        <AnimatePresence mode="popLayout">
          {!analyzing && !state.working && !chatOpen && lastAssistant && (
            <LastThoughtCard
              key={`${lastAssistant.id}-${nodeChartOpen ? 'compact' : 'full'}`}
              text={lastAssistant.text}
              compact={nodeChartOpen}
              onOpen={() => setChatOpen(true)}
            />
          )}
        </AnimatePresence>
      </LayoutGroup>

      <AnimatePresence>
        {chatOpen && !analyzing && (
          <motion.div
            key="chat-drawer"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
            className="absolute inset-y-0 left-0 z-30 w-[min(460px,100vw)]"
          >
            <ChatPanel
              state={state}
              send={sendFromChat}
              answerPermission={answerPermission}
              onClose={() => setChatOpen(false)}
              autoFocusInput
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {analyzing && (
          <AnalyzingOverlay
            key="overlay"
            state={state}
            answerPermission={answerPermission}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
