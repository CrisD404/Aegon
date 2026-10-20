import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { create } from 'zustand';
import { DropdownMenu } from 'radix-ui';
import { ViewportPortal, useStore } from '@xyflow/react';
import {
  Anchor,
  Bug,
  CircleCheck,
  CircleHelp,
  Flag,
  Info,
  Lightbulb,
  Lock,
  Maximize2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Send,
  Star,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  COMMENT_COLORS,
  COMMENT_ICONS,
  type Comment,
  type CommentColor,
  type CommentIcon,
  type Id,
  type View,
} from '@aegon/core';
import { useUi } from '../store/ui.ts';
import { useWorkspace } from '../store/workspace.ts';
import { showDialog } from '../store/dialogs.ts';
import {
  addComment,
  commentPosition,
  editCommentText,
  ensureAuthor,
  removeComment,
  replyToComment,
  setAnchor,
  timeAgo,
  toggleResolved,
  updateComment,
} from '../lib/comment-actions.ts';
import { pickNode } from '../lib/flow-actions.ts';
import { Modal } from '../ui/Modal.tsx';
import { RichText } from '../ui/RichText.tsx';
import { Button, IconButton, TextArea, TextInput, cn } from '../ui/primitives.tsx';
import { canvasApi } from './api.ts';

export const COMMENT_ICON: Record<CommentIcon, typeof Info> = {
  message: MessageSquare,
  info: Info,
  question: CircleHelp,
  warning: TriangleAlert,
  idea: Lightbulb,
  check: CircleCheck,
  flag: Flag,
  bug: Bug,
  lock: Lock,
  star: Star,
};

export const COMMENT_COLOR: Record<CommentColor, string> = {
  accent: 'var(--accent)',
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  danger: 'var(--danger)',
  violet: 'var(--kind-component)',
  neutral: 'var(--fg-muted)',
};

const COLOR_LABEL: Record<CommentColor, string> = {
  accent: 'Azul',
  ok: 'Verde',
  warn: 'Ámbar',
  danger: 'Rojo',
  violet: 'Violeta',
  neutral: 'Gris',
};
const ICON_LABEL: Record<CommentIcon, string> = {
  message: 'Comentario',
  info: 'Información',
  question: 'Pregunta',
  warning: 'Advertencia',
  idea: 'Idea',
  check: 'Hecho',
  flag: 'Marcador',
  bug: 'Problema',
  lock: 'Seguridad',
  star: 'Destacado',
};

export function CommentBadge({
  icon = 'message',
  color = 'accent',
  size = 28,
  resolved,
}: {
  icon?: CommentIcon;
  color?: CommentColor;
  size?: number;
  resolved?: boolean;
}) {
  const Icon = resolved ? CircleCheck : COMMENT_ICON[icon];
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full rounded-bl-[4px] text-white shadow-[0_2px_6px_rgb(0_0_0/0.18)]"
      style={{
        width: size,
        height: size,
        background: resolved ? 'var(--fg-subtle)' : COMMENT_COLOR[color],
      }}
    >
      <Icon size={Math.round(size * 0.52)} strokeWidth={2.2} />
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Click en el lienzo (elegir elementos de un paso / ubicar un comentario)

/** Nodo de elemento bajo un punto de la pantalla. */
function nodeAt(x: number, y: number): Id | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const node = (el as HTMLElement).closest?.('.react-flow__node-element');
    if (node) return node.getAttribute('data-id');
  }
  return null;
}

/**
 * Mientras `active`, un click en el lienzo no selecciona ni arrastra: llama a `onPick` con el
 * punto y el nodo debajo. Se puede seguir desplazando y haciendo zoom.
 */
function useCanvasPick(
  active: boolean,
  onPick: (p: { x: number; y: number; node: Id | null }) => void,
  onCancel: () => void,
) {
  const [hover, setHover] = useState<Id | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    if (!active) return;
    const shell = document.querySelector<HTMLElement>('[data-testid="canvas"]');
    if (!shell) return;
    shell.setAttribute('data-picking', '');
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('[data-pick-ignore]')) return;
      e.preventDefault();
      e.stopPropagation();
      pickRef.current({ x: e.clientX, y: e.clientY, node: nodeAt(e.clientX, e.clientY) });
    };
    const move = (e: PointerEvent) => setHover(nodeAt(e.clientX, e.clientY));
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelRef.current();
      }
    };
    shell.addEventListener('pointerdown', down, true);
    shell.addEventListener('pointermove', move, true);
    window.addEventListener('keydown', key, true);
    return () => {
      shell.removeAttribute('data-picking');
      shell.removeEventListener('pointerdown', down, true);
      shell.removeEventListener('pointermove', move, true);
      window.removeEventListener('keydown', key, true);
      setHover(null);
    };
  }, [active]);
  return hover;
}

function PickBanner({ children, onCancel }: { children: React.ReactNode; onCancel: () => void }) {
  return (
    <div
      className="animate-pop absolute top-10 left-1/2 z-40 flex h-10 -translate-x-1/2 items-center gap-2 rounded-lg border border-accent/40 bg-panel pr-1 pl-3 text-[12.5px] text-fg shadow-pop"
      data-pick-ignore
      data-testid="pick-banner"
    >
      {children}
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancelar <span className="text-fg-subtle">Esc</span>
      </Button>
    </div>
  );
}

const hoverStyle = (id: Id | null) =>
  id ? (
    <style>{`.canvas-shell .react-flow__node[data-id="${CSS.escape(id)}"] .c4-node { border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }`}</style>
  ) : null;

/** Elegir en el lienzo los elementos de un paso de flujo. */
export function StepPicker() {
  const pick = useUi((s) => s.stepPick);
  const model = useWorkspace((s) => s.model);
  const cancel = () => useUi.getState().setStepPick(null);
  const hover = useCanvasPick(!!pick, ({ node }) => node && pickNode(node), cancel);
  if (!pick) return null;
  const from = pick.from ? model.elements[pick.from]?.name : undefined;
  return (
    <>
      {hoverStyle(hover)}
      <PickBanner onCancel={cancel}>
        {pick.kind === 'process' ? (
          <span>Paso de proceso: tocá el elemento que hace algo</span>
        ) : from ? (
          <span>
            <b className="text-accent">{from}</b> → tocá el destino del mensaje
          </span>
        ) : (
          <span>Mensaje: tocá el origen</span>
        )}
      </PickBanner>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Borrador de comentario

interface Draft {
  view: Id;
  /** Posición absoluta en el lienzo. */
  at: { x: number; y: number };
  element: Id | null;
}

const useDraft = create<{ draft: Draft | null; set: (d: Draft | null) => void }>((set) => ({
  draft: null,
  set: (draft) => set({ draft }),
}));

/** Abre un borrador de comentario en un punto del lienzo (anclado si hay un elemento). */
export function startCommentAt(view: View, at: { x: number; y: number }, element: Id | null) {
  useUi.getState().setPref('showComments', true);
  useUi.getState().setOpenComment(null);
  useDraft
    .getState()
    .set({ view: view.id, at, element: element && view.nodes[element] ? element : null });
}

/** Modo comentar: el click ubica un borrador (anclado al elemento si cae sobre uno). */
export function CommentPlacer({ view }: { view: View }) {
  const active = useUi((s) => s.commentMode);
  const cancel = () => useUi.getState().setCommentMode(false);
  const hover = useCanvasPick(
    active,
    ({ x, y, node }) => {
      const at = canvasApi.screenToFlow(x, y);
      useDraft
        .getState()
        .set({ view: view.id, at, element: node && view.nodes[node] ? node : null });
      useUi.getState().setCommentMode(false);
      useUi.getState().setOpenComment(null);
    },
    cancel,
  );
  if (!active) return null;
  return (
    <>
      {hoverStyle(hover)}
      <PickBanner onCancel={cancel}>
        <MessageSquare size={14} className="text-accent" />
        <span>Tocá donde quieras comentar · sobre un elemento queda anclado a él</span>
      </PickBanner>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Capa de comentarios (dentro del viewport de ReactFlow)

export function CommentsLayer({ view }: { view: View }) {
  const comments = useWorkspace((s) => s.model.comments);
  const model = useWorkspace((s) => s.model);
  const show = useUi((s) => s.showComments);
  const presenting = useUi((s) => !!s.player);
  const open = useUi((s) => s.openComment);
  const draft = useDraft((s) => s.draft);
  const zoom = useStore((s) => s.transform[2]);
  if (presenting) return null;
  const list = show ? Object.values(comments ?? {}).filter((c) => c.view === view.id) : [];
  const scale = 1 / zoom;
  return (
    <ViewportPortal>
      <div data-comments-layer style={{ display: 'contents' }}>
        {list.map((c) => (
          <CommentPin
            key={c.id}
            comment={c}
            pos={commentPosition(model, c)}
            scale={scale}
            open={open === c.id}
          />
        ))}
        {draft && draft.view === view.id ? <DraftCard draft={draft} scale={scale} /> : null}
      </div>
    </ViewportPortal>
  );
}

/**
 * Ubica la tarjeta junto al pin donde entre en el lienzo: arriba a la derecha por defecto, abajo si
 * no hay lugar arriba y a la izquierda si no entra a la derecha.
 */
function CardSlot({ children, deps }: { children: React.ReactNode; deps: unknown[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ v: 'up' | 'down'; h: 'right' | 'left' }>({
    v: 'up',
    h: 'right',
  });
  useLayoutEffect(() => {
    const el = ref.current;
    const anchor = el?.parentElement;
    const shell = document.querySelector<HTMLElement>('[data-testid="canvas"]');
    if (!el || !anchor || !shell) return;
    const a = anchor.getBoundingClientRect();
    const s = shell.getBoundingClientRect();
    const h = el.offsetHeight;
    const w = el.offsetWidth;
    const v = a.top - h - 8 < s.top + 8 ? 'down' : 'up';
    const hor = a.left + 38 + w > s.right - 8 && a.left - 38 - w > s.left ? 'left' : 'right';
    setPlace((prev) => (prev.v === v && prev.h === hor ? prev : { v, h: hor }));
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={ref} className="comment-card-pos" data-v={place.v} data-h={place.h}>
      {children}
    </div>
  );
}

function CommentPin({
  comment,
  pos,
  scale,
  open,
}: {
  comment: Comment;
  pos: { x: number; y: number };
  scale: number;
  open: boolean;
}) {
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ sx: number; sy: number; x: number; y: number; moved: boolean } | null>(
    null,
  );
  const at = drag ?? pos;

  const down = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { sx: e.clientX, sy: e.clientY, x: pos.x, y: pos.y, moved: false };
  };
  const move = (e: ReactPointerEvent) => {
    const s = start.current;
    if (!s) return;
    const dx = (e.clientX - s.sx) * scale;
    const dy = (e.clientY - s.sy) * scale;
    if (!s.moved && Math.hypot(e.clientX - s.sx, e.clientY - s.sy) < 4) return;
    s.moved = true;
    setDrag({ x: s.x + dx, y: s.y + dy });
  };
  const up = () => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    if (!s.moved) {
      useUi.getState().setOpenComment(open ? null : comment.id);
      return;
    }
    if (drag) {
      const model = useWorkspace.getState().model;
      const anchor = comment.element
        ? model.views[comment.view]?.nodes[comment.element]
        : undefined;
      const rel = anchor ? { x: drag.x - anchor.x, y: drag.y - anchor.y } : drag;
      updateComment(comment.id, { x: Math.round(rel.x), y: Math.round(rel.y) }, 'Mover comentario');
    }
    setDrag(null);
  };

  const replies = comment.replies?.length ?? 0;
  return (
    <div
      className="comment-anchor nodrag nopan nowheel"
      style={{ left: at.x, top: at.y, transform: `scale(${scale})` }}
      data-testid={`comment-${comment.id}`}
    >
      <button
        type="button"
        className={cn('comment-pin group', comment.resolved && 'opacity-60', open && 'is-open')}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        aria-label={comment.title ?? 'Comentario'}
        data-testid={`comment-pin-${comment.id}`}
      >
        <CommentBadge icon={comment.icon} color={comment.color} resolved={comment.resolved} />
        {replies ? <span className="comment-count">{replies}</span> : null}
        {!open ? (
          <span className="comment-preview">
            <b>{comment.title ?? comment.author}</b>
            <span>{comment.body}</span>
          </span>
        ) : null}
      </button>
      {open ? (
        <CardSlot deps={[at.x, at.y, scale, comment.replies?.length]}>
          <CommentCard comment={comment} onClose={() => useUi.getState().setOpenComment(null)} />
        </CardSlot>
      ) : null}
    </div>
  );
}

function IconColorPicker({
  icon,
  color,
  onChange,
}: {
  icon: CommentIcon;
  color: CommentColor;
  onChange: (patch: { icon?: CommentIcon; color?: CommentColor }) => void;
}) {
  return (
    <div className="flex flex-col gap-2 p-1">
      <div className="grid grid-cols-5 gap-1">
        {COMMENT_ICONS.map((i) => {
          const Icon = COMMENT_ICON[i];
          return (
            <button
              key={i}
              type="button"
              title={ICON_LABEL[i]}
              onClick={() => onChange({ icon: i })}
              className={cn(
                'grid h-8 w-8 place-items-center rounded-sm hover:bg-hover',
                i === icon ? 'bg-accent-soft text-accent' : 'text-fg-muted',
              )}
              data-testid={`comment-icon-${i}`}
            >
              <Icon size={15} />
            </button>
          );
        })}
      </div>
      <div className="flex justify-between gap-1 px-0.5">
        {COMMENT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            title={COLOR_LABEL[c]}
            onClick={() => onChange({ color: c })}
            className={cn(
              'h-6 w-6 rounded-full border-2 transition-transform hover:scale-110',
              c === color ? 'border-fg' : 'border-transparent',
            )}
            style={{ background: COMMENT_COLOR[c] }}
            data-testid={`comment-color-${c}`}
          />
        ))}
      </div>
    </div>
  );
}

function DraftCard({ draft, scale }: { draft: Draft; scale: number }) {
  const model = useWorkspace((s) => s.model);
  const author = useUi((s) => s.commentAuthor);
  const [icon, setIcon] = useState<CommentIcon>('message');
  const [color, setColor] = useState<CommentColor>('accent');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [name, setName] = useState(author);
  const [anchored, setAnchored] = useState(!!draft.element);
  const close = () => useDraft.getState().set(null);
  const node = draft.element ? model.views[draft.view]?.nodes[draft.element] : undefined;
  const submit = () => {
    if (!body.trim() || !name.trim()) return;
    if (name.trim() !== author) useUi.getState().setPref('commentAuthor', name.trim());
    const rel =
      anchored && node
        ? { x: draft.at.x - node.x, y: draft.at.y - node.y, element: draft.element! }
        : { ...draft.at };
    const id = addComment({
      view: draft.view,
      ...rel,
      icon,
      color,
      title,
      body,
      author: name.trim(),
    });
    close();
    if (id) useUi.getState().setOpenComment(id);
  };
  const keys = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  };
  return (
    <div
      className="comment-anchor nodrag nopan nowheel"
      style={{ left: draft.at.x, top: draft.at.y, transform: `scale(${scale})` }}
    >
      <span className="comment-pin is-open">
        <CommentBadge icon={icon} color={color} />
      </span>
      <CardSlot deps={[draft.at.x, draft.at.y, scale]}>
        <div className="comment-card" onKeyDown={keys} data-testid="comment-draft">
          <IconColorPicker
            icon={icon}
            color={color}
            onChange={(p) => {
              if (p.icon) setIcon(p.icon);
              if (p.color) setColor(p.color);
            }}
          />
          <div className="flex flex-col gap-1.5 border-t border-line pt-2">
            {!author ? (
              <TextInput
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Tu nombre (queda guardado)"
                className="h-7 text-[12px]"
                data-testid="comment-author"
              />
            ) : null}
            <TextInput
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Título (opcional)"
              className="h-7 text-[12.5px] font-medium"
              data-testid="comment-title"
            />
            <TextArea
              autoFocus
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Escribí un comentario… (admite `código` y **negrita**)"
              rows={3}
              className="min-h-[72px] text-[12.5px]"
              data-testid="comment-body"
            />
            {draft.element && node ? (
              <label className="flex items-center gap-1.5 text-[11.5px] text-fg-subtle">
                <input
                  type="checkbox"
                  checked={anchored}
                  onChange={(e) => setAnchored(e.target.checked)}
                />
                <Anchor size={11} /> Anclado a {model.elements[draft.element]?.name}
              </label>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5 pt-1">
            <span className="text-[10.5px] text-fg-subtle">Ctrl+Enter</span>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" onClick={close}>
              Cancelar
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!body.trim() || !name.trim()}
              onClick={submit}
              data-testid="comment-submit"
            >
              Comentar
            </Button>
          </div>
        </div>
      </CardSlot>
    </div>
  );
}

/** Tarjeta de un comentario: texto, respuestas, edición, ícono/color, resolver y ampliar. */
export function CommentCard({
  comment,
  onClose,
  large,
}: {
  comment: Comment;
  onClose: () => void;
  large?: boolean;
}) {
  const model = useWorkspace((s) => s.model);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(comment.title ?? '');
  const [body, setBody] = useState(comment.body);
  const [reply, setReply] = useState('');
  const element = comment.element ? model.elements[comment.element] : undefined;
  const view = model.views[comment.view];

  const startEdit = () => {
    setTitle(comment.title ?? '');
    setBody(comment.body);
    setEditing(true);
  };
  const save = () => {
    if (editCommentText(comment, title, body)) setEditing(false);
  };
  const send = async () => {
    if (await replyToComment(comment, reply)) setReply('');
  };
  const anchorTo = () => {
    // Ancla al elemento más cercano del lienzo.
    const pos = commentPosition(model, comment);
    let best: { id: Id; d: number } | null = null;
    for (const [id, l] of Object.entries(view?.nodes ?? {})) {
      if (model.elements[id]?.kind === 'group') continue;
      const d = Math.hypot(l.x - pos.x, l.y - pos.y);
      if (!best || d < best.d) best = { id, d };
    }
    if (best) setAnchor(comment, best.id);
  };

  return (
    <div
      className={cn('comment-card', large && 'is-large')}
      data-testid="comment-card"
      onKeyDown={(e) => e.key === 'Escape' && !editing && onClose()}
    >
      <div className="flex items-start gap-2">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              title="Cambiar ícono y color"
              className="rounded-full transition-transform hover:scale-105"
              data-testid="comment-style"
            >
              <CommentBadge
                icon={comment.icon}
                color={comment.color}
                size={26}
                resolved={comment.resolved}
              />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="menu z-[80]" align="start" sideOffset={6}>
              <IconColorPicker
                icon={comment.icon ?? 'message'}
                color={comment.color ?? 'accent'}
                onChange={(p) =>
                  updateComment(
                    comment.id,
                    {
                      ...(p.icon ? { icon: p.icon === 'message' ? null : p.icon } : {}),
                      ...(p.color ? { color: p.color === 'accent' ? null : p.color } : {}),
                    },
                    'Estilo del comentario',
                  )
                }
              />
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] font-semibold text-fg">
            {comment.title ?? comment.author}
          </span>
          <span className="truncate text-[11px] text-fg-subtle">
            {comment.title ? `${comment.author} · ` : ''}
            {timeAgo(comment.at)}
            {comment.edited ? ' · editado' : ''}
            {element ? ` · en ${element.name}` : ''}
          </span>
        </div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <IconButton size="sm" label="Más acciones" data-testid="comment-menu">
              <MoreHorizontal size={14} />
            </IconButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="menu z-[80] min-w-[200px]" align="end" sideOffset={4}>
              <DropdownMenu.Item className="menu-item" onSelect={startEdit}>
                <Pencil size={14} /> Editar
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" onSelect={() => toggleResolved(comment)}>
                {comment.resolved ? <RotateCcw size={14} /> : <CircleCheck size={14} />}{' '}
                {comment.resolved ? 'Reabrir' : 'Resolver'}
              </DropdownMenu.Item>
              {!large ? (
                <DropdownMenu.Item
                  className="menu-item"
                  onSelect={() => void expandComment(comment.id)}
                  data-testid="comment-expand"
                >
                  <Maximize2 size={14} /> Ampliar
                </DropdownMenu.Item>
              ) : null}
              <DropdownMenu.Item
                className="menu-item"
                onSelect={() => (comment.element ? setAnchor(comment, null) : anchorTo())}
              >
                <Anchor size={14} />{' '}
                {comment.element ? 'Desanclar del elemento' : 'Anclar al elemento más cercano'}
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="menu-sep" />
              <DropdownMenu.Item
                className="menu-item"
                data-danger
                onSelect={() => removeComment(comment)}
              >
                <Trash2 size={14} /> Eliminar
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        {!large ? (
          <IconButton size="sm" label="Cerrar" onClick={onClose}>
            <X size={14} />
          </IconButton>
        ) : null}
      </div>

      {comment.resolved ? (
        <div className="flex items-center gap-2 rounded-sm bg-ok/10 px-2 py-1 text-[11.5px] text-ok">
          <CircleCheck size={12} /> Resuelto
          <button
            type="button"
            className="ml-auto text-fg-muted hover:text-fg"
            onClick={() => toggleResolved(comment)}
          >
            Reabrir
          </button>
        </div>
      ) : null}

      {editing ? (
        <div
          className="flex flex-col gap-1.5"
          onKeyDown={(e) =>
            e.key === 'Enter' && (e.ctrlKey || e.metaKey)
              ? save()
              : e.key === 'Escape' && (e.stopPropagation(), setEditing(false))
          }
        >
          <TextInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Título (opcional)"
            className="h-7 text-[12.5px] font-medium"
          />
          <TextArea
            autoFocus
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={large ? 6 : 3}
            className="text-[12.5px]"
            data-testid="comment-edit-body"
          />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!body.trim()}
              onClick={save}
              data-testid="comment-save"
            >
              Guardar
            </Button>
          </div>
        </div>
      ) : (
        <RichText
          text={comment.body}
          className={cn(
            'text-fg-muted',
            large ? 'text-[14px] leading-relaxed' : 'text-[12.5px] leading-snug',
          )}
        />
      )}

      {comment.replies?.length ? (
        <div
          className={cn(
            'flex flex-col gap-2 overflow-auto border-t border-line pt-2',
            large ? 'max-h-[40vh]' : 'max-h-[220px]',
          )}
        >
          {comment.replies.map((r, i) => (
            <div key={i} className="flex flex-col gap-0.5" data-testid="comment-reply">
              <span className="text-[11.5px]">
                <b className="font-semibold text-fg">{r.author}</b>{' '}
                <span className="text-fg-subtle">· {timeAgo(r.at)}</span>
              </span>
              <RichText
                text={r.body}
                className={cn(
                  'text-fg-muted',
                  large ? 'text-[13.5px]' : 'text-[12.5px] leading-snug',
                )}
              />
            </div>
          ))}
        </div>
      ) : null}

      {!editing ? (
        <div className="flex items-end gap-1.5 border-t border-line pt-2">
          <TextArea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Responder…"
            rows={1}
            className="min-h-[32px] flex-1 py-1.5 text-[12.5px]"
            data-testid="comment-reply-input"
          />
          <IconButton
            label="Enviar respuesta"
            disabled={!reply.trim()}
            onClick={() => void send()}
            className="text-accent"
            data-testid="comment-reply-send"
          >
            <Send size={14} />
          </IconButton>
        </div>
      ) : null}
    </div>
  );
}

/** "Ampliar": el comentario en un modal grande (lectura cómoda de textos y respuestas largas). */
export async function expandComment(id: Id) {
  useUi.getState().setOpenComment(null);
  await showDialog<null>((close) => <ExpandedComment id={id} close={() => close(null)} />, null);
}

function ExpandedComment({ id, close }: { id: Id; close: () => void }) {
  const comment = useWorkspace((s) => s.model.comments?.[id]);
  useEffect(() => {
    if (!comment) close();
  }, [comment, close]);
  if (!comment) return null;
  return (
    <Modal
      open
      onClose={close}
      size="lg"
      title={comment.title ?? 'Comentario'}
      icon={
        <CommentBadge
          icon={comment.icon}
          color={comment.color}
          size={30}
          resolved={comment.resolved}
        />
      }
      testId="comment-dialog"
    >
      <CommentCard comment={comment} onClose={close} large />
    </Modal>
  );
}

export { ensureAuthor };
