import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  Brain,
  Check,
  ChevronRight,
  FileInput,
  Loader2,
  ShieldCheck,
  Wrench,
  X
} from 'lucide-react';
import { Badge, Button, Card, Textarea } from '@/components/ui';
import { TacitBrand } from '@/components/TacitBrand';
import type {
  AgentState,
  FeedItem,
  PermissionAnswer
} from '@/lib/agent-store';
import { labelFor } from '@/lib/tool-labels';

interface Props {
  state: AgentState;
  send: (text: string) => void;
  answerPermission: (id: string, answer: PermissionAnswer) => void;
  onBack?: () => void;
  onClose?: () => void;
  autoFocusInput?: boolean;
  disabled?: boolean;
}

const pretty = (v: unknown) => {
  const s = JSON.stringify(v, null, 2);
  return s && s.length > 1200 ? `${s.slice(0, 1200)}\n...` : s;
};

const inputDescription = (input: unknown) => {
  if (!input || typeof input !== 'object') return null;
  const description = (input as { description?: unknown }).description;
  return typeof description === 'string' && description.trim()
    ? description.trim()
    : null;
};

const blockStarts = (line: string) =>
  /^```/.test(line) ||
  /^#{1,3}\s+/.test(line) ||
  /^[-*]\s+/.test(line) ||
  /^\d+\.\s+/.test(line);

const renderInline = (text: string): ReactNode[] => {
  const nodes: ReactNode[] = [];
  const pattern =
    /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${match.index}-${token}`;

    if (token.startsWith('`')) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-[var(--background)] px-1 py-0.5 font-mono text-[0.92em]"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*') || token.startsWith('_')) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (link) {
        nodes.push(
          <a
            key={key}
            href={link[2]}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--accent)] underline underline-offset-2"
          >
            {link[1]}
          </a>
        );
      }
    }
    last = match.index + token.length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
};

export function MarkdownContent({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (line.startsWith('```')) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) {
        code.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(
        <pre
          key={blocks.length}
          className="overflow-auto rounded-md bg-[var(--background)] p-2 text-[12px]"
        >
          <code>{code.join('\n')}</code>
        </pre>
      );
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const HeadingTag = heading[1].length === 1 ? 'h2' : 'h3';
      blocks.push(
        <HeadingTag
          key={blocks.length}
          className="font-semibold text-[var(--secondary-foreground)]"
        >
          {renderInline(heading[2])}
        </HeadingTag>
      );
      i += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ul key={blocks.length} className="list-disc space-y-1 pl-5">
          {items.map((item, index) => (
            <li key={index}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ol key={blocks.length} className="list-decimal space-y-1 pl-5">
          {items.map((item, index) => (
            <li key={index}>{renderInline(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && !blockStarts(lines[i])) {
      paragraph.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p key={blocks.length} className="whitespace-pre-wrap">
        {renderInline(paragraph.join('\n'))}
      </p>
    );
  }

  return <div className="space-y-2 leading-relaxed">{blocks}</div>;
}

function DetailBlock({
  label,
  open,
  children
}: {
  label: string;
  open: boolean;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--background)]">
      <div className="px-2 py-1.5 text-[12px] text-[var(--muted-foreground)]">
        {label}
      </div>
      {children}
    </div>
  );
}

function DetailIconButton({
  active,
  label,
  onClick,
  children
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex size-7 items-center justify-center rounded-md border transition ${
        active
          ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-foreground)]'
          : 'border-[var(--border)] bg-[var(--background)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
      }`}
    >
      {children}
    </button>
  );
}

function ToolStatusIcon({ status }: { status: 'running' | 'done' | 'error' }) {
  if (status === 'running')
    return <Loader2 size={12} className="shrink-0 animate-spin text-[var(--primary)]" />;
  if (status === 'error')
    return <X size={12} className="shrink-0 text-[var(--destructive)]" />;
  return <Check size={12} className="shrink-0 text-emerald-400/70" />;
}

function ToolDetailModal({
  item,
  onClose
}: {
  item: Extract<FeedItem, { kind: 'tool' }>;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const description = inputDescription(item.input);
  const badgeVariant =
    item.status === 'running'
      ? 'default'
      : item.status === 'error'
        ? 'danger'
        : 'success';

  // Portal to <body>: an ancestor uses transform/filter, which would otherwise
  // trap a fixed-position overlay and let overflow clipping hide it.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <Card
        className="flex max-h-[80vh] w-full max-w-[560px] flex-col overflow-hidden p-0 text-[13px]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
          <Wrench size={14} className="shrink-0 text-[var(--accent)]" />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-[var(--foreground)]">
              {labelFor(item.name)}
            </div>
            <div className="truncate font-mono text-[11px] text-[var(--muted-foreground)]">
              {item.name}
            </div>
          </div>
          <Badge variant={badgeVariant}>{item.status}</Badge>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="ml-1 text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
          {description && (
            <p className="text-[12px] text-[var(--muted-foreground)]">
              {description}
            </p>
          )}
          <div>
            <div className="mb-1 text-[12px] font-medium text-[var(--muted-foreground)]">
              Input
            </div>
            <pre className="overflow-auto rounded-md border border-[var(--border)] bg-[var(--background)] p-2 text-[12px] text-[var(--muted-foreground)]">
              {pretty(item.input)}
            </pre>
          </div>
          <div>
            <div className="mb-1 text-[12px] font-medium text-[var(--muted-foreground)]">
              Result
            </div>
            <pre className="overflow-auto rounded-md border border-[var(--border)] bg-[var(--background)] p-2 text-[12px] text-[var(--muted-foreground)]">
              {item.result
                ? item.result.length > 4000
                  ? `${item.result.slice(0, 4000)}\n...`
                  : item.result
                : item.status === 'running'
                  ? 'Running…'
                  : '(no result)'}
            </pre>
          </div>
        </div>
      </Card>
    </div>,
    document.body
  );
}

function ToolRow({ item }: { item: Extract<FeedItem, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="View details"
        className="group flex max-w-[680px] items-center gap-2 self-start rounded-md px-2 py-1 text-left text-[13px] text-[var(--muted-foreground)] transition hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
      >
        <ToolStatusIcon status={item.status} />
        <span className="truncate">{labelFor(item.name)}</span>
      </button>
      {open && <ToolDetailModal item={item} onClose={() => setOpen(false)} />}
    </>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex max-w-[680px] items-center gap-2 self-start rounded-[var(--message-radius)] bg-[var(--secondary)] px-3.5 py-2.5 text-[14px] text-[var(--muted-foreground)]">
      <Loader2 size={14} className="shrink-0 animate-spin text-[var(--accent)]" />
      <span>Thinking...</span>
    </div>
  );
}

function PermissionCard({
  item,
  answerPermission
}: {
  item: Extract<FeedItem, { kind: 'permission' }>;
  answerPermission: Props['answerPermission'];
}) {
  const [expanded, setExpanded] = useState(false);
  const description = inputDescription(item.input);

  return (
    <Card className="max-w-[680px] border-[var(--accent)] p-3 text-[13px]">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 font-medium">
          <ShieldCheck size={14} className="text-[var(--accent)]" />
          Permission: <span className="font-mono">{item.toolName}</span>
          <Badge>{item.status}</Badge>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <DetailIconButton
            active={expanded}
            label="Show request details"
            onClick={() => setExpanded(!expanded)}
          >
            <FileInput size={14} />
          </DetailIconButton>
        </div>
      </div>
      {description && (
        <div className="mt-1.5 text-[12px] text-[var(--muted-foreground)]">
          {description}
        </div>
      )}
      <DetailBlock label="Request details" open={expanded}>
        <pre className="max-h-48 overflow-auto border-t border-[var(--border)] p-2 text-[12px] text-[var(--muted-foreground)]">
          {pretty(item.input)}
        </pre>
      </DetailBlock>
      {item.status === 'waiting' && (
        <div className="mt-2.5 flex gap-2">
          <Button
            variant="primary"
            onClick={() => answerPermission(item.id, { behavior: 'allow' })}
          >
            Allow
          </Button>
          <Button
            variant="danger"
            onClick={() => answerPermission(item.id, { behavior: 'deny' })}
          >
            Deny
          </Button>
        </div>
      )}
    </Card>
  );
}

interface AskQuestion {
  header?: string;
  question: string;
  multiSelect?: boolean;
  options: { label: string; description?: string }[];
}

export function AskQuestionCard({
  item,
  answerPermission
}: {
  item: Extract<FeedItem, { kind: 'permission' }>;
  answerPermission: (id: string, answer: PermissionAnswer) => void;
}) {
  const questions =
    (item.input as { questions?: AskQuestion[] })?.questions ?? [];
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const waiting = item.status === 'waiting';

  const isSelected = (q: AskQuestion, label: string) => {
    const a = answers[q.question];
    return q.multiSelect
      ? Array.isArray(a) && a.includes(label)
      : a === label;
  };

  const choose = (q: AskQuestion, label: string) => {
    if (!waiting) return;
    setAnswers(prev => {
      if (q.multiSelect) {
        const cur = Array.isArray(prev[q.question])
          ? (prev[q.question] as string[])
          : [];
        return {
          ...prev,
          [q.question]: cur.includes(label)
            ? cur.filter(l => l !== label)
            : [...cur, label]
        };
      }
      return { ...prev, [q.question]: label };
    });
  };

  const allAnswered = questions.every(q => {
    const a = answers[q.question];
    return q.multiSelect ? Array.isArray(a) && a.length > 0 : typeof a === 'string';
  });

  return (
    <Card className="max-w-[680px] border-[var(--accent)] p-3 text-[13px]">
      <div className="flex items-center gap-2 font-medium">
        <ShieldCheck size={14} className="text-[var(--accent)]" />
        The agent has a question
        <Badge>{item.status}</Badge>
      </div>

      {questions.map((q, qi) => (
        <div key={qi} className="mt-3">
          <div className="mb-1.5 text-[12px] font-medium text-[var(--foreground)]">
            {q.header ? `${q.header} — ${q.question}` : q.question}
            {q.multiSelect && (
              <span className="ml-1 text-[var(--muted-foreground)]">
                (choose any)
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            {q.options.map((opt, oi) => {
              const sel = isSelected(q, opt.label);
              return (
                <button
                  key={oi}
                  type="button"
                  disabled={!waiting}
                  onClick={() => choose(q, opt.label)}
                  className={`rounded-md border px-3 py-2 text-left transition ${
                    sel
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                      : 'border-[var(--border)] bg-[var(--background)] hover:border-[var(--accent)]'
                  } ${waiting ? '' : 'opacity-70'}`}
                >
                  <div className="text-[13px] text-[var(--foreground)]">
                    {opt.label}
                  </div>
                  {opt.description && (
                    <div className="text-[12px] text-[var(--muted-foreground)]">
                      {opt.description}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {waiting && (
        <div className="mt-3 flex justify-end gap-2">
          <Button
            variant="default"
            onClick={() => answerPermission(item.id, { behavior: 'deny' })}
          >
            Skip
          </Button>
          <Button
            variant="primary"
            disabled={!allAnswered}
            onClick={() =>
              answerPermission(item.id, {
                behavior: 'allow',
                updatedInput: { questions, answers }
              })
            }
          >
            Answer
          </Button>
        </div>
      )}
    </Card>
  );
}

const hasQuestions = (input: unknown) =>
  Boolean(
    input &&
      typeof input === 'object' &&
      Array.isArray((input as { questions?: unknown }).questions)
  );

function Item({
  item,
  answerPermission
}: {
  item: FeedItem;
  answerPermission: Props['answerPermission'];
}) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="max-w-[680px] self-end whitespace-pre-wrap rounded-[var(--message-radius)] bg-[var(--primary)] px-3.5 py-2.5 text-[14px] text-[var(--primary-foreground)]">
          {item.text}
        </div>
      );
    case 'assistant':
      return (
        <div className="max-w-[680px] self-start rounded-[var(--message-radius)] bg-[var(--secondary)] px-3.5 py-2.5 text-[14px] text-[var(--secondary-foreground)]">
          <MarkdownContent text={item.text} />
        </div>
      );
    case 'thinking':
      return (
        <Card className="max-w-[680px] p-3 text-[13px]">
          <div className="flex items-center gap-2 font-medium text-[var(--muted-foreground)]">
            <Brain size={14} /> Thinking
          </div>
          <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap text-[12px] text-[var(--muted-foreground)]">
            {item.text.slice(0, 800)}
          </pre>
        </Card>
      );
    case 'tool':
      return <ToolRow item={item} />;
    case 'permission':
      return (
        hasQuestions(item.input) ? (
          <AskQuestionCard item={item} answerPermission={answerPermission} />
        ) : (
          <PermissionCard item={item} answerPermission={answerPermission} />
        )
      );
    case 'meta':
      return (
        <div className="self-center text-[12px] text-[var(--muted-foreground)]">
          {item.text}
        </div>
      );
  }
}

export function ChatPanel({
  state,
  send,
  answerPermission,
  onBack,
  onClose,
  autoFocusInput = false,
  disabled = false
}: Props) {
  const [input, setInput] = useState('');
  const feedRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const showThinkingIndicator = state.working && !state.streaming;

  const scrollToBottom = () => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  useEffect(() => {
    if (shouldStickToBottomRef.current) scrollToBottom();
  }, [state.feed, state.streaming, showThinkingIndicator]);

  useEffect(() => {
    if (!autoFocusInput) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 120);
    return () => window.clearTimeout(id);
  }, [autoFocusInput]);

  const submit = () => {
    if (disabled) return;
    const text = input.trim();
    if (!text) return;
    shouldStickToBottomRef.current = true;
    setInput('');
    send(text);
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col border-r border-[var(--border)] bg-[var(--panel)]">
      <header className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2.5">
        {onBack && (
          <Button variant="ghost" onClick={onBack} aria-label="Back to dataset" className="px-2">
            <ArrowLeft />
            Dataset
          </Button>
        )}
        <h1 className="text-[var(--foreground)]">
          <TacitBrand />
        </h1>
        <span
          className={
            state.working
              ? 'text-[12px] text-[var(--accent)]'
              : 'text-[12px] text-[var(--muted-foreground)]'
          }
        >
          {state.status}
        </span>
        <span className="flex-1" />
        {onClose && (
          <Button variant="default" size="sm" onClick={onClose} aria-label="Hide chat">
            <X />
            Hide chat
          </Button>
        )}
      </header>

      <div
        ref={feedRef}
        onScroll={e => {
          const el = e.currentTarget;
          const distanceFromBottom =
            el.scrollHeight - el.scrollTop - el.clientHeight;
          shouldStickToBottomRef.current = distanceFromBottom < 48;
        }}
        className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain p-4"
      >
        {state.feed.map(item => (
          <Item key={item.id} item={item} answerPermission={answerPermission} />
        ))}
        {state.streaming && (
          <div className="max-w-[680px] self-start rounded-[var(--message-radius)] bg-[var(--secondary)] px-3.5 py-2.5 text-[14px] text-[var(--muted-foreground)] opacity-80">
            <MarkdownContent text={state.streaming} />
          </div>
        )}
        {showThinkingIndicator && <ThinkingIndicator />}
      </div>

      <footer className="flex gap-2 border-t border-[var(--border)] p-3">
        <Textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={disabled}
          rows={2}
          placeholder={
            disabled
              ? 'The copilot is working...'
              : 'Ask about the system... (Enter to send, Shift+Enter for newline)'
          }
          className="flex-1 resize-none"
        />
        <Button
          variant="primary"
          onClick={submit}
          disabled={disabled || !input.trim()}
          className="self-stretch px-4"
        >
          Send <ChevronRight size={16} />
        </Button>
      </footer>
    </div>
  );
}
