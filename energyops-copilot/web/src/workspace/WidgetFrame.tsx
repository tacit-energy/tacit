import { useEffect, useRef, useState } from 'react';
import { CircleHelp, Plus, StickyNote } from 'lucide-react';
import { Button, Card, Textarea } from '@/components/ui';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';

// Wraps a widget and adds a "+" button to pin an operator annotation to it.
// The note is persisted to the annotation store (kind: 'widget') and is
// readable by the agent via get_annotations.
export function WidgetFrame({
  widgetId,
  sessionId,
  widgetTitle,
  onAskQuestion,
  askDisabled = false,
  children
}: {
  widgetId: string;
  sessionId: string;
  widgetTitle?: string;
  onAskQuestion?: (question: string) => void;
  askDisabled?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [questionOpen, setQuestionOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [text, setText] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const questionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    fetch(
      `${API_BASE}/sessions/${sessionId}/annotations?kind=widget&id=${encodeURIComponent(widgetId)}`
    )
      .then(r => (r.ok ? r.json() : []))
      .then((rows: { text: string }[]) => {
        if (active && rows[0]?.text) {
          setSaved(rows[0].text);
          setText(rows[0].text);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [widgetId, sessionId]);

  // close popovers on outside click
  useEffect(() => {
    if (!open && !questionOpen) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as globalThis.Node)) {
        setOpen(false);
      }
      if (
        questionRef.current &&
        !questionRef.current.contains(e.target as globalThis.Node)
      ) {
        setQuestionOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, questionOpen]);

  const save = async () => {
    setBusy(true);
    try {
      await fetch(`${API_BASE}/sessions/${sessionId}/annotation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'widget', id: widgetId, text })
      });
      setSaved(text.trim() ? text : null);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const askQuestion = () => {
    if (askDisabled) return;
    const trimmed = question.trim();
    if (!trimmed) return;
    onAskQuestion?.(trimmed);
    setQuestionOpen(false);
  };

  return (
    <div className="relative">
      {children}

      {onAskQuestion && (
        <button
          onClick={() => {
            if (askDisabled) return;
            setOpen(false);
            setQuestionOpen(o => !o);
          }}
          disabled={askDisabled}
          title="Ask about this widget"
          aria-label="Ask about this widget"
          className="absolute right-11 top-2.5 z-10 grid h-7 w-7 place-items-center rounded-md border border-[var(--border)] bg-[var(--panel-strong)] text-[var(--muted-foreground)] hover:border-[var(--accent)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[var(--border)] disabled:hover:text-[var(--muted-foreground)]"
        >
          <CircleHelp size={15} />
        </button>
      )}

      <button
        onClick={() => setOpen(o => !o)}
        title={saved ? 'Edit note' : 'Add note'}
        aria-label={saved ? 'Edit note' : 'Add note'}
        className="absolute right-2.5 top-2.5 z-10 grid h-7 w-7 place-items-center rounded-md border border-[var(--border)] bg-[var(--panel-strong)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--accent)]"
      >
        {saved ? (
          <StickyNote size={14} className="text-[var(--accent)]" />
        ) : (
          <Plus size={15} />
        )}
      </button>

      {open && (
        <div ref={popRef} className="absolute right-2.5 top-11 z-20 w-72">
          <Card className="bg-[var(--panel-strong)] p-3 shadow-lg">
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
              Operator note
            </div>
            <Textarea
              autoFocus
              value={text}
              onChange={e => setText(e.target.value)}
              rows={3}
              placeholder="e.g. P3 is a summer-only backup pump; ignore the spike."
              className="text-[13px]"
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" onClick={save} disabled={busy}>
                Save
              </Button>
            </div>
          </Card>
        </div>
      )}

      {questionOpen && (
        <div ref={questionRef} className="absolute right-11 top-11 z-20 w-80">
          <Card className="bg-[var(--panel-strong)] p-3 shadow-lg">
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
              Ask about widget
            </div>
            <div className="mb-2 rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 text-[12px] text-[var(--muted-foreground)]">
              {widgetTitle ?? widgetId}
            </div>
            <Textarea
              autoFocus
              value={question}
              onChange={e => setQuestion(e.target.value)}
              rows={3}
              placeholder="e.g. Why is this unusual, and what should I check next?"
              className="text-[13px]"
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setQuestionOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={askQuestion}
                disabled={askDisabled || !question.trim()}
              >
                Send
              </Button>
            </div>
          </Card>
        </div>
      )}

      {saved && !open && (
        <div className="mt-1 flex items-start gap-1.5 px-1 text-[12px] text-[var(--muted-foreground)]">
          <StickyNote size={12} className="mt-0.5 shrink-0 text-[var(--accent)]" />
          <span>{saved}</span>
        </div>
      )}
    </div>
  );
}
