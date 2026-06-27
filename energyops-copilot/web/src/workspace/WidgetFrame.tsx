import { useEffect, useRef, useState } from 'react';
import { Plus, StickyNote } from 'lucide-react';
import { Button, Card, Textarea } from '@/components/ui';

// Wraps a widget and adds a "+" button to pin an operator annotation to it.
// The note is persisted to the annotation store (kind: 'widget') and is
// readable by the agent via get_annotations.
export function WidgetFrame({
  widgetId,
  sessionId,
  children
}: {
  widgetId: string;
  sessionId: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    fetch(
      `/sessions/${sessionId}/annotations?kind=widget&id=${encodeURIComponent(widgetId)}`
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

  // close popover on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as globalThis.Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const save = async () => {
    setBusy(true);
    try {
      await fetch(`/sessions/${sessionId}/annotation`, {
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

  return (
    <div className="relative">
      {children}

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

      {saved && !open && (
        <div className="mt-1 flex items-start gap-1.5 px-1 text-[12px] text-[var(--muted-foreground)]">
          <StickyNote size={12} className="mt-0.5 shrink-0 text-[var(--accent)]" />
          <span>{saved}</span>
        </div>
      )}
    </div>
  );
}
