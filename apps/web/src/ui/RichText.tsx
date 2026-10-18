import { Fragment, type ReactNode } from 'react';
import { cn } from './primitives.tsx';

/**
 * Markdown mínimo para textos cortos (pasos de flujos, comentarios): párrafos, listas con `-`,
 * `código`, **negrita**, _itálica_ y links. Sin HTML: todo se escapa.
 */
export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {blocks.map((block, i) => {
        const lines = block.split('\n');
        if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
          return (
            <ul key={i} className="m-0 flex list-disc flex-col gap-0.5 pl-4">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*]\s+/, ''))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="m-0">
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 ? <br /> : null}
                {inline(l)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

const TOKEN = /(`[^`]+`|\*\*[^*]+\*\*|_[^_]+_|\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s)]+)/g;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const token = m[0];
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${m.index}`;
    if (token.startsWith('`')) {
      out.push(
        <code key={key} className="rounded-xs bg-raised px-1 py-px font-mono text-[0.92em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**')) out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('_')) out.push(<em key={key}>{token.slice(1, -1)}</em>);
    else {
      const link = token.startsWith('[') ? /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token) : null;
      const href = link ? link[2]! : token;
      // Los textos vienen de otras personas (comentarios vía git): solo links web o de correo.
      if (!/^(https?:|mailto:)/i.test(href)) {
        out.push(link ? link[1]! : token);
        last = m.index + token.length;
        continue;
      }
      out.push(
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline-offset-2 hover:underline"
        >
          {link ? link[1] : token}
        </a>,
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
