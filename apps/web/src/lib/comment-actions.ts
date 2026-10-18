import type { Comment, CommentColor, CommentIcon, CommentPatch, Id, Model } from '@aegon/core';
import { useUi } from '../store/ui.ts';
import { useWorkspace } from '../store/workspace.ts';
import { canvasApi } from '../canvas/api.ts';
import { promptDialog } from '../store/dialogs.ts';

/** Acciones sobre comentarios: todas son ops (se deshacen, aparecen en Cambios y viajan con git). */

const ws = () => useWorkspace.getState();
const ui = () => useUi.getState();

export function newCommentId(): Id {
  return `c-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Nombre con el que se firma: el guardado o, la primera vez, lo pide. */
export async function ensureAuthor(): Promise<string | null> {
  const saved = ui().commentAuthor.trim();
  if (saved) return saved;
  const name = await promptDialog({
    title: '¿Cómo firmás tus comentarios?',
    description: 'Se guarda en este equipo y aparece junto a cada comentario y respuesta.',
    label: 'Tu nombre',
    placeholder: 'Ej. Ana · Arquitectura',
    confirmLabel: 'Guardar',
  });
  if (!name?.trim()) return null;
  ui().setPref('commentAuthor', name.trim());
  return name.trim();
}

export function addComment(input: {
  view: Id;
  x: number;
  y: number;
  element?: Id;
  icon: CommentIcon;
  color: CommentColor;
  title?: string;
  body: string;
  author: string;
}): Id | null {
  const comment: Comment = {
    id: newCommentId(),
    view: input.view,
    x: Math.round(input.x),
    y: Math.round(input.y),
    ...(input.element ? { element: input.element } : {}),
    ...(input.icon !== 'message' ? { icon: input.icon } : {}),
    ...(input.color !== 'accent' ? { color: input.color } : {}),
    ...(input.title?.trim() ? { title: input.title.trim() } : {}),
    body: input.body.trim(),
    author: input.author,
    at: new Date().toISOString(),
  };
  return ws().dispatch({ type: 'comment.add', comment }, { label: 'Agregar comentario' })
    ? comment.id
    : null;
}

export function updateComment(
  id: Id,
  patch: CommentPatch,
  label = 'Editar comentario',
  coalesce?: string,
) {
  return ws().dispatch(
    { type: 'comment.update', id, patch },
    { label, ...(coalesce ? { coalesce: `comment:${id}:${coalesce}` } : {}) },
  );
}

export function editCommentText(comment: Comment, title: string, body: string) {
  if (!body.trim()) return false;
  return updateComment(comment.id, {
    title: title.trim() || null,
    body: body.trim(),
    edited: new Date().toISOString(),
  });
}

export async function replyToComment(comment: Comment, body: string): Promise<boolean> {
  if (!body.trim()) return false;
  const author = await ensureAuthor();
  if (!author) return false;
  return updateComment(
    comment.id,
    {
      replies: [
        ...(comment.replies ?? []),
        { author, at: new Date().toISOString(), body: body.trim() },
      ],
    },
    'Responder comentario',
  );
}

export function toggleResolved(comment: Comment) {
  updateComment(
    comment.id,
    { resolved: comment.resolved ? null : true },
    comment.resolved ? 'Reabrir comentario' : 'Resolver comentario',
  );
  if (!comment.resolved && ui().openComment === comment.id) ui().setOpenComment(null);
}

export function removeComment(comment: Comment) {
  if (ws().dispatch({ type: 'comment.remove', id: comment.id }, { label: 'Eliminar comentario' })) {
    if (ui().openComment === comment.id) ui().setOpenComment(null);
    ui().toast('Comentario eliminado', 'info', { label: 'Deshacer', run: () => ws().undo() });
  }
}

/** Posición absoluta (en el lienzo) de un comentario, resolviendo el ancla. */
export function commentPosition(model: Model, comment: Comment): { x: number; y: number } {
  const anchor = comment.element ? model.views[comment.view]?.nodes[comment.element] : undefined;
  return anchor
    ? { x: anchor.x + comment.x, y: anchor.y + comment.y }
    : { x: comment.x, y: comment.y };
}

/** Ancla o desancla un comentario sin moverlo de lugar. */
export function setAnchor(comment: Comment, element: Id | null) {
  const model = ws().model;
  const abs = commentPosition(model, comment);
  const node = element ? model.views[comment.view]?.nodes[element] : undefined;
  const pos = node ? { x: abs.x - node.x, y: abs.y - node.y } : abs;
  updateComment(
    comment.id,
    { element: node ? element : null, x: Math.round(pos.x), y: Math.round(pos.y) },
    node ? 'Anclar comentario' : 'Desanclar comentario',
  );
}

/** Lleva al comentario: abre su lienzo, lo centra y lo despliega. */
export function focusComment(id: Id) {
  const model = ws().model;
  const comment = model.comments?.[id];
  if (!comment || !model.views[comment.view]) return;
  if (!ui().showComments) ui().setPref('showComments', true);
  const center = () => {
    const pos = commentPosition(ws().model, comment);
    canvasApi.centerOnPoint(pos.x + 140, pos.y + 60);
    ui().setOpenComment(id);
  };
  if (ui().activeViewId !== comment.view) {
    ui().openView(comment.view, { transition: 'fade' });
    const started = Date.now();
    const wait = () => {
      const shell = document.querySelector<HTMLElement>('[data-testid="canvas"]');
      if (shell?.dataset.framed === comment.view) center();
      else if (Date.now() - started < 4000) requestAnimationFrame(wait);
    };
    requestAnimationFrame(wait);
  } else center();
}

const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

/** "hace 5 minutos", "ayer", "12 de oct." */
export function timeAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const s = Math.round((t - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 45) return 'recién';
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (abs < 86400 * 6) return rtf.format(Math.round(s / 86400), 'day');
  return new Date(t).toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'short',
    ...(new Date(t).getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}),
  });
}
