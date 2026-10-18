import { useMemo, useState } from 'react';
import { Anchor, Eye, EyeOff, MessageSquarePlus, MessagesSquare, Search } from 'lucide-react';
import type { Comment } from '@aegon/core';
import { useUi } from '../store/ui.ts';
import { useWorkspace } from '../store/workspace.ts';
import { focusComment, timeAgo } from '../lib/comment-actions.ts';
import { CommentBadge } from '../canvas/Comments.tsx';
import { Button, IconButton, Segmented, cn } from '../ui/primitives.tsx';

type Filter = 'open' | 'resolved' | 'all';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Pestaña "Comentarios": todos los comentarios del workspace, por lienzo; click = ir al comentario. */
export function CommentsPanel() {
  const comments = useWorkspace((s) => s.model.comments);
  const views = useWorkspace((s) => s.model.views);
  const elements = useWorkspace((s) => s.model.elements);
  const show = useUi((s) => s.showComments);
  const open = useUi((s) => s.openComment);
  const activeViewId = useUi((s) => s.activeViewId);
  const [filter, setFilter] = useState<Filter>('open');
  const [query, setQuery] = useState('');

  const all = useMemo(() => Object.values(comments ?? {}), [comments]);
  const counts = {
    open: all.filter((c) => !c.resolved).length,
    resolved: all.filter((c) => c.resolved).length,
  };
  const groups = useMemo(() => {
    const q = norm(query.trim());
    const list = all
      .filter((c) => (filter === 'all' ? true : filter === 'open' ? !c.resolved : !!c.resolved))
      .filter(
        (c) =>
          !q ||
          norm(
            `${c.title ?? ''} ${c.body} ${c.author} ${(c.replies ?? []).map((r) => `${r.author} ${r.body}`).join(' ')}`,
          ).includes(q),
      )
      .sort((a, b) => b.at.localeCompare(a.at));
    const byView = new Map<string, Comment[]>();
    for (const c of list) byView.set(c.view, [...(byView.get(c.view) ?? []), c]);
    // El lienzo actual primero.
    return [...byView].sort(([a], [b]) =>
      a === activeViewId
        ? -1
        : b === activeViewId
          ? 1
          : (views[a]?.name ?? a).localeCompare(views[b]?.name ?? b),
    );
  }, [all, filter, query, views, activeViewId]);

  const startComment = () => {
    useUi.getState().setPref('showComments', true);
    useUi.getState().setCommentMode(true);
  };

  return (
    <div className="flex h-full flex-col" data-testid="comments-panel">
      <div className="flex flex-col gap-2.5 p-3 pb-2">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="primary" onClick={startComment} data-testid="comments-new">
            <MessageSquarePlus size={13} /> Comentar
          </Button>
          <span className="flex-1" />
          <IconButton
            size="sm"
            label={show ? 'Ocultar comentarios en el lienzo' : 'Mostrar comentarios en el lienzo'}
            active={!show}
            onClick={() => useUi.getState().setPref('showComments', !show)}
            data-testid="comments-visibility"
          >
            {show ? <Eye size={14} /> : <EyeOff size={14} />}
          </IconButton>
        </div>
        <Segmented
          value={filter}
          onChange={(v) => setFilter(v ?? 'open')}
          options={[
            { value: 'open', label: `Abiertos ${counts.open}` },
            { value: 'resolved', label: `Resueltos ${counts.resolved}` },
            { value: 'all', label: 'Todos' },
          ]}
        />
        <div className="relative">
          <Search
            size={13}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-subtle"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar en comentarios y respuestas"
            className="h-7 w-full rounded-sm border border-transparent bg-raised pr-2 pl-7 text-[12.5px] text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
        {!groups.length ? (
          <div className="mx-1 mt-2 flex flex-col items-center gap-2 rounded-lg border border-dashed border-line px-4 py-6 text-center">
            <MessagesSquare size={22} className="text-fg-subtle" />
            <p className="m-0 text-[12.5px] leading-relaxed text-fg-subtle">
              {all.length
                ? 'Nada coincide con el filtro.'
                : 'Dejá notas, preguntas o advertencias sobre el diagrama. Viajan con el workspace (y con git) para que las vea todo el equipo.'}
            </p>
          </div>
        ) : null}
        {groups.map(([viewId, list]) => (
          <section key={viewId} className="mt-1">
            <h3 className="m-0 flex items-center gap-1.5 px-1.5 pt-2 pb-1 text-[10.5px] font-semibold tracking-[0.05em] text-fg-subtle uppercase">
              {views[viewId] ? (
                <span className="rounded-[4px] bg-raised px-1 font-mono text-[9.5px]">
                  L{views[viewId]!.level}
                </span>
              ) : null}
              <span className="truncate">
                {views[viewId]?.name ?? `Lienzo "${viewId}" (no existe)`}
              </span>
              <span className="ml-auto font-normal tabular-nums">{list.length}</span>
            </h3>
            {list.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => focusComment(c.id)}
                className={cn(
                  'flex w-full gap-2.5 rounded-md px-2 py-2 text-left hover:bg-hover',
                  open === c.id && 'bg-accent-soft hover:bg-accent-soft',
                )}
                data-testid={`comments-item-${c.id}`}
              >
                <CommentBadge icon={c.icon} color={c.color} size={24} resolved={c.resolved} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    className={cn(
                      'line-clamp-2 text-[12.5px] leading-snug',
                      c.resolved ? 'text-fg-subtle line-through' : 'text-fg',
                    )}
                  >
                    {c.title ? <b className="font-semibold">{c.title} · </b> : null}
                    {c.body}
                  </span>
                  <span className="flex items-center gap-1 truncate text-[11px] text-fg-subtle">
                    {c.author} · {timeAgo(c.at)}
                    {c.replies?.length
                      ? ` · ${c.replies.length} ${c.replies.length === 1 ? 'respuesta' : 'respuestas'}`
                      : ''}
                    {c.element && elements[c.element] ? (
                      <>
                        {' · '}
                        <Anchor size={10} /> {elements[c.element]!.name}
                      </>
                    ) : null}
                  </span>
                </span>
              </button>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
