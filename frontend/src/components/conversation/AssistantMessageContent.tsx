import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Brain, ChevronRight } from 'lucide-react';

type Segment = { kind: 'text' | 'thought'; content: string };

const OPEN = '<thought>';
const CLOSE = '</thought>';

function parseSegments(content: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  while (cursor < content.length) {
    const open = content.indexOf(OPEN, cursor);
    if (open === -1) {
      segments.push({ kind: 'text', content: content.slice(cursor) });
      break;
    }
    if (open > cursor) {
      segments.push({ kind: 'text', content: content.slice(cursor, open) });
    }
    const close = content.indexOf(CLOSE, open + OPEN.length);
    if (close === -1) {
      // Unclosed thought (still streaming) — treat the rest as thought.
      segments.push({ kind: 'thought', content: content.slice(open + OPEN.length).trim() });
      break;
    }
    segments.push({ kind: 'thought', content: content.slice(open + OPEN.length, close).trim() });
    cursor = close + CLOSE.length;
  }
  return segments.filter((s) => s.content.length > 0);
}

interface Props {
  content: string;
}

export const AssistantMessageContent: React.FC<Props> = ({ content }) => {
  const segments = parseSegments(content);
  if (segments.length === 0) {
    return null;
  }
  return (
    <>
      {segments.map((seg, idx) =>
        seg.kind === 'thought' ? (
          <details
            key={idx}
            className="not-prose group my-2 rounded-lg border border-border bg-background-secondary/40 px-3 py-2"
          >
            <summary className="flex items-center gap-1.5 cursor-pointer select-none text-foreground-muted hover:text-foreground transition-colors">
              <ChevronRight className="w-3 h-3 transition-transform group-open:rotate-90" />
              <Brain className="w-3 h-3" />
              <span className="text-[10px] font-semibold uppercase tracking-wider">
                Thinking
              </span>
            </summary>
            <div className="mt-2 whitespace-pre-wrap text-xs italic leading-relaxed text-foreground-muted">
              {seg.content}
            </div>
          </details>
        ) : (
          <ReactMarkdown key={idx}>{seg.content}</ReactMarkdown>
        )
      )}
    </>
  );
};
