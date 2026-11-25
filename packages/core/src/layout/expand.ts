import { ancestorsOf, childViewOf, indexOf, type Model } from '../model/index.ts';
import { applyOp, type Op } from '../ops/index.ts';
import { sizeOf } from '../ops/commands.ts';
import { childLevelOf } from '../rules/hierarchy.ts';
import { DEPLOYMENT_KINDS, type Element, type Id, type NodeLayout, type View } from '../schema/index.ts';
import { FRAME_PADDING, bounds, isExpandedInView, isFrameKind, layeredLayout, tidyGrid, visualParentOf, type Rect } from './index.ts';

/**
 * Abrir y cerrar elementos C4 en el lugar: un sistema (o un contenedor) se convierte en un marco
 * con sus hijos adentro, sin cambiar de lienzo. Así un mismo lienzo muestra varios niveles a la vez
 * y el usuario decide cuánto detalle ve de cada parte.
 *
 * `view.nodes` siempre es lo que se ve: al cerrar, los hijos salen del lienzo y su disposición se
 * guarda en `view.folded` (relativa a la esquina del elemento) para reabrirlo como estaba.
 */

const MIN_FRAME = { w: 280, h: 160 } as const;
/** Marco recién abierto sin hijos: lugar para crear el primero adentro. */
const EMPTY_FRAME = { w: 360, h: 200 } as const;
/** Separación de lo que no tenía lugar guardado (hijos creados mientras estaba cerrado). */
const STACK_GAP = 48;
const EPS = 1;

/** Hijos C4 de un elemento (contenedores, bases y buses de un sistema; componentes de un contenedor). */
export function c4ChildrenOf(model: Model, id: Id): Element[] {
  const out: Element[] = [];
  for (const childId of indexOf(model).childrenOf.get(id) ?? []) {
    const child = model.elements[childId];
    if (!child || child.kind === 'group' || (DEPLOYMENT_KINDS as readonly string[]).includes(child.kind)) continue;
    out.push(child);
  }
  return out;
}

/** ¿Se puede abrir en el lugar? Sistemas y contenedores, en lienzos C4 (no en despliegue). */
export function canExpandInView(model: Model, view: View, id: Id): boolean {
  const el = model.elements[id];
  return !!el && !!view.nodes[id] && view.level !== 'deployment' && childLevelOf(el.kind) !== null;
}

interface Ctx {
  model: Model;
  rects: Map<Id, Rect>;
  parentOf: Map<Id, Id | undefined>;
  childrenOf: Map<Id | undefined, Id[]>;
  /** Marcos C4 abiertos: siempre envuelven justo a su contenido. */
  exact: Set<Id>;
}

function context(model: Model, view: View, skip: ReadonlySet<Id> = new Set()): Ctx {
  const rects = new Map<Id, Rect>();
  const parentOf = new Map<Id, Id | undefined>();
  const childrenOf = new Map<Id | undefined, Id[]>();
  const exact = new Set<Id>();
  for (const [id, layout] of Object.entries(view.nodes)) {
    const el = model.elements[id];
    if (!el || skip.has(id)) continue;
    rects.set(id, { x: layout.x, y: layout.y, ...sizeOf(el, layout) });
    if (isExpandedInView(view, id)) exact.add(id);
  }
  for (const id of rects.keys()) {
    let parent = visualParentOf(model, view, model.elements[id]!);
    // Si el marco quedó fuera (se está cerrando o reubicando), cuelga del siguiente hacia arriba.
    while (parent && !rects.has(parent)) parent = visualParentOf(model, view, model.elements[parent]!);
    parentOf.set(id, parent);
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), id]);
  }
  return { model, rects, parentOf, childrenOf, exact };
}

/** Todo lo que el lienzo dibuja dentro de `id` (hijos, y lo que contienen los marcos anidados). */
function nestedIn(ctx: Ctx, id: Id): Id[] {
  const out: Id[] = [];
  const stack = [...(ctx.childrenOf.get(id) ?? [])];
  while (stack.length) {
    const next = stack.pop()!;
    out.push(next);
    stack.push(...(ctx.childrenOf.get(next) ?? []));
  }
  return out;
}

function shift(ctx: Ctx, id: Id, dx: number, dy: number) {
  for (const target of [id, ...nestedIn(ctx, id)]) {
    const r = ctx.rects.get(target)!;
    ctx.rects.set(target, { ...r, x: r.x + dx, y: r.y + dy });
  }
}

const overlapsV = (a: Rect, b: Rect) => a.y < b.y + b.h && b.y < a.y + a.h;
const overlapsH = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w;

/**
 * `id` cambia de tamaño (misma esquina): le hace lugar. Lo que estaba a su derecha o debajo se
 * corre lo que creció (o vuelve lo que se achicó) y el marco que lo contiene se ajusta, repitiendo
 * hacia afuera. Abrir y después cerrar deja el lienzo como estaba.
 */
function reflow(ctx: Ctx, id: Id, before: Rect, after: Rect) {
  const dx = after.w - before.w;
  const dy = after.h - before.h;
  if (!dx && !dy) return;
  const parent = ctx.parentOf.get(id);
  const siblings = (ctx.childrenOf.get(parent) ?? []).filter((s) => s !== id);

  // La franja que ocupa el más grande de los dos tamaños decide a quién alcanza el cambio.
  const span = dx > 0 || dy > 0 ? after : before;
  const right = before.x + before.w;
  const bottom = before.y + before.h;
  for (const s of siblings) {
    const r = ctx.rects.get(s)!;
    if (dx && r.x >= right - EPS && overlapsV(r, span)) shift(ctx, s, dx, 0);
    else if (dy && r.y >= bottom - EPS && overlapsH(r, span)) shift(ctx, s, 0, dy);
  }
  ctx.rects.set(id, after);
  if (!parent) return;

  const frame = ctx.rects.get(parent)!;
  const content = bounds([after, ...siblings.map((s) => ctx.rects.get(s)!)])!;
  const wantRight = content.x + content.w + FRAME_PADDING.side;
  const wantBottom = content.y + content.h + FRAME_PADDING.bottom;
  let nextRight = frame.x + frame.w;
  let nextBottom = frame.y + frame.h;
  if (ctx.exact.has(parent)) {
    // Un marco C4 abierto envuelve justo a su contenido.
    nextRight = wantRight;
    nextBottom = wantBottom;
  } else {
    // Un grupo o un nodo de despliegue se mueve lo mismo que su contenido: conserva el aire que
    // le dio el usuario y, al cerrar, vuelve exactamente a su tamaño.
    nextRight = dx >= 0 ? Math.max(nextRight + dx, wantRight) : Math.min(nextRight, Math.max(nextRight + dx, wantRight));
    nextBottom = dy >= 0 ? Math.max(nextBottom + dy, wantBottom) : Math.min(nextBottom, Math.max(nextBottom + dy, wantBottom));
  }
  const next: Rect = {
    x: frame.x,
    y: frame.y,
    w: Math.max(nextRight - frame.x, MIN_FRAME.w),
    h: Math.max(nextBottom - frame.y, MIN_FRAME.h),
  };
  reflow(ctx, parent, frame, next);
}

function layoutOf(prev: NodeLayout | undefined, rect: Rect, def: { w: number; h: number }, frame: boolean): NodeLayout {
  const out: NodeLayout = { x: Math.round(rect.x), y: Math.round(rect.y) };
  if (frame || prev?.w !== undefined || Math.round(rect.w) !== def.w) out.w = Math.round(rect.w);
  if (frame || prev?.h !== undefined || Math.round(rect.h) !== def.h) out.h = Math.round(rect.h);
  return out;
}

/** Posiciones que cambiaron respecto del lienzo (para un `view.place`). */
function placements(ctx: Ctx, view: View, forced: Readonly<Record<Id, NodeLayout>> = {}): Record<Id, NodeLayout> {
  const out: Record<Id, NodeLayout> = {};
  for (const [id, rect] of ctx.rects) {
    if (forced[id]) continue;
    const el = ctx.model.elements[id]!;
    const prev = view.nodes[id];
    const next = layoutOf(prev, rect, sizeOf(el), isFrameKind(el.kind) || ctx.exact.has(id));
    if (!prev || prev.x !== next.x || prev.y !== next.y || prev.w !== next.w || prev.h !== next.h) out[id] = next;
  }
  for (const [id, layout] of Object.entries(forced)) {
    const prev = view.nodes[id];
    if (!prev || prev.x !== layout.x || prev.y !== layout.y || prev.w !== layout.w || prev.h !== layout.h) out[id] = layout;
  }
  return out;
}

/**
 * Los comentarios sueltos del lienzo (los que no están anclados a un elemento) acompañan a la
 * tarjeta más cercana: si esa tarjeta se corrió para hacer lugar, el comentario va con ella.
 */
function commentOps(model: Model, viewId: Id, before: ReadonlyMap<Id, Rect>, ctx: Ctx): Op[] {
  const out: Op[] = [];
  // Solo tarjetas: un marco contiene el punto de casi cualquier comentario y no dice de quién es.
  const cards = [...before].filter(([id]) => !ctx.childrenOf.get(id)?.length && ctx.rects.has(id));
  for (const c of Object.values(model.comments ?? {})) {
    if (c.view !== viewId || c.element) continue;
    let best: { id: Id; d: number } | null = null;
    for (const [id, r] of cards) {
      const dx = Math.max(r.x - c.x, 0, c.x - (r.x + r.w));
      const dy = Math.max(r.y - c.y, 0, c.y - (r.y + r.h));
      const d = Math.hypot(dx, dy);
      if (!best || d < best.d) best = { id, d };
    }
    if (!best) continue;
    const from = before.get(best.id)!;
    const to = ctx.rects.get(best.id)!;
    const dx = Math.round(to.x - from.x);
    const dy = Math.round(to.y - from.y);
    if (dx || dy) out.push({ type: 'comment.update', id: c.id, patch: { x: c.x + dx, y: c.y + dy } });
  }
  return out;
}

/** Disposición de los hijos (relativa a la esquina del marco) cuando no hay una guardada. */
function freshInner(model: Model, id: Id, kids: readonly Element[]): Record<Id, NodeLayout> {
  const out: Record<Id, NodeLayout> = {};
  if (!kids.length) return out;
  const kidIds = new Set(kids.map((k) => k.id));
  // Del lienzo de detalle (L2/L3), si existe: el usuario ya los acomodó ahí.
  const detail = childViewOf(model, id);
  const fromDetail = detail ? kids.filter((k) => detail.nodes[k.id]) : [];
  if (fromDetail.length) {
    for (const k of fromDetail) out[k.id] = { ...detail!.nodes[k.id]! };
  } else {
    // Si no, por capas siguiendo las relaciones entre ellos (o una grilla si no hay).
    const owner = (end: Id): Id | undefined => (kidIds.has(end) ? end : ancestorsOf(model, end).find((a) => kidIds.has(a.id))?.id);
    const edges: { from: Id; to: Id }[] = [];
    for (const rel of Object.values(model.relations)) {
      const a = owner(rel.from);
      const b = owner(rel.to);
      if (a && b && a !== b) edges.push({ from: a, to: b });
    }
    const rects = kids.map((k) => ({ id: k.id, x: 0, y: 0, ...sizeOf(k) }));
    const positions = edges.length ? layeredLayout(rects, edges, { x: 0, y: 0 }) : tidyGrid(rects);
    for (const k of kids) out[k.id] = { x: Math.round(positions.get(k.id)!.x), y: Math.round(positions.get(k.id)!.y) };
  }
  return out;
}

/**
 * Abre un sistema o contenedor en el lugar. Sus hijos entran al lienzo dentro de un marco (como
 * estaban la última vez, como están en su lienzo de detalle o acomodados por capas) y lo que lo
 * rodea se corre para hacerle lugar. Null si no se puede abrir o ya está abierto.
 */
export function expandInViewOp(model: Model, viewId: Id, id: Id): Op | null {
  const view = model.views[viewId];
  const el = model.elements[id];
  if (!view || !el || !canExpandInView(model, view, id) || isExpandedInView(view, id)) return null;
  const origin = view.nodes[id]!;
  const kids = c4ChildrenOf(model, id);

  // 1. Qué entra y dónde (relativo a la esquina del marco).
  const inside = new Set<Id>([id, ...kids.map((k) => k.id)]);
  const saved = view.folded?.[id];
  let inner: Record<Id, NodeLayout> = {};
  if (saved) {
    for (const [nodeId, layout] of Object.entries(saved)) {
      // Solo lo que sigue siendo parte del elemento (pudo moverse o borrarse mientras estaba cerrado).
      if (model.elements[nodeId] && ancestorsOf(model, nodeId).some((a) => a.id === id)) {
        inner[nodeId] = layout;
        inside.add(nodeId);
      }
    }
  }
  const known = kids.filter((k) => inner[k.id]);
  if (!known.length) inner = freshInner(model, id, kids);
  // Lo que no tenía lugar (hijos nuevos) va en una fila debajo del resto.
  const missing = kids.filter((k) => !inner[k.id]);
  if (missing.length) {
    const box = bounds(Object.entries(inner).map(([nodeId, l]) => ({ x: l.x, y: l.y, ...sizeOf(model.elements[nodeId]!, l) })));
    let x = box?.x ?? 0;
    const y = box ? box.y + box.h + STACK_GAP : 0;
    for (const k of missing) {
      inner[k.id] = { x, y };
      x += sizeOf(k).w + STACK_GAP;
    }
  }
  // Normalizar: lo de más arriba a la izquierda queda justo bajo el título del marco.
  const innerRects = Object.entries(inner).map(([nodeId, l]) => ({ id: nodeId, x: l.x, y: l.y, ...sizeOf(model.elements[nodeId]!, l) }));
  const box = bounds(innerRects);
  const offset = box ? { x: FRAME_PADDING.side - box.x, y: FRAME_PADDING.top - box.y } : { x: 0, y: 0 };
  const before: Rect = { x: origin.x, y: origin.y, ...sizeOf(el, origin) };
  const after: Rect = {
    x: origin.x,
    y: origin.y,
    w: box ? Math.max(box.w + FRAME_PADDING.side * 2, MIN_FRAME.w) : EMPTY_FRAME.w,
    h: box ? Math.max(box.h + FRAME_PADDING.top + FRAME_PADDING.bottom, MIN_FRAME.h) : EMPTY_FRAME.h,
  };

  // 2. Hacerle lugar entre lo que ya está en el lienzo (sin contar lo que va a quedar adentro).
  const skip = new Set(inside);
  skip.delete(id);
  const ctx = context(model, view, skip);
  ctx.rects.set(id, before);
  const snapshot = new Map(ctx.rects);
  reflow(ctx, id, before, after);
  ctx.exact.add(id);

  const forced: Record<Id, NodeLayout> = {};
  for (const r of innerRects) {
    const source = inner[r.id]!;
    const layout: NodeLayout = { x: Math.round(origin.x + r.x + offset.x), y: Math.round(origin.y + r.y + offset.y) };
    if (source.w !== undefined) layout.w = source.w;
    if (source.h !== undefined) layout.h = source.h;
    forced[r.id] = layout;
  }

  const folded = { ...(view.folded ?? {}) };
  delete folded[id];
  const ops: Op[] = [
    { type: 'view.place', view: viewId, nodes: placements(ctx, view, forced) },
    { type: 'view.update', id: viewId, patch: { expanded: [...(view.expanded ?? []).filter((e) => e !== id), id], folded: Object.keys(folded).length ? folded : null } },
    ...commentOps(model, viewId, snapshot, ctx),
  ];
  return { type: 'batch', ops, label: `Abrir ${el.name}` };
}

/**
 * Cierra un elemento abierto: vuelve a ser una tarjeta, lo que contenía sale del lienzo (su
 * disposición queda guardada) y lo que se había corrido vuelve a su lugar.
 */
export function collapseInViewOp(model: Model, viewId: Id, id: Id): Op | null {
  const view = model.views[viewId];
  const el = model.elements[id];
  if (!view || !el || !isExpandedInView(view, id)) return null;
  const full = context(model, view);
  const nested = nestedIn(full, id);
  const frame = view.nodes[id]!;
  const before = full.rects.get(id)!;
  const after: Rect = { x: frame.x, y: frame.y, ...sizeOf(el) };

  const ctx = context(model, view, new Set(nested));
  ctx.exact.delete(id);
  const snapshot = new Map(ctx.rects);
  reflow(ctx, id, before, after);

  const folded = { ...(view.folded ?? {}) };
  if (nested.length) {
    folded[id] = Object.fromEntries(
      nested.sort().map((n) => {
        const l = view.nodes[n]!;
        return [n, { ...l, x: Math.round(l.x - frame.x), y: Math.round(l.y - frame.y) }];
      }),
    );
  } else delete folded[id];
  const expanded = (view.expanded ?? []).filter((e) => e !== id);

  const ops: Op[] = [];
  if (nested.length) ops.push({ type: 'view.unplace', view: viewId, ids: nested });
  ops.push({ type: 'view.place', view: viewId, nodes: placements(ctx, view, { [id]: { x: frame.x, y: frame.y } }) });
  ops.push({ type: 'view.update', id: viewId, patch: { expanded: expanded.length ? expanded : null, folded: Object.keys(folded).length ? folded : null } });
  ops.push(...commentOps(model, viewId, snapshot, ctx));
  return { type: 'batch', ops, label: `Cerrar ${el.name}` };
}

/** Abre o cierra según cómo esté. */
export function toggleExpandOp(model: Model, viewId: Id, id: Id): Op | null {
  const view = model.views[viewId];
  if (!view) return null;
  return isExpandedInView(view, id) ? collapseInViewOp(model, viewId, id) : expandInViewOp(model, viewId, id);
}

/** Profundidad C4 que muestra un lienzo: 1 contexto, 2 contenedores, 3 componentes. */
export type Depth = 1 | 2 | 3;

/** Profundidades que tienen sentido en un lienzo (un L2 ya parte de los contenedores). */
export function depthsOf(view: View): Depth[] {
  const level = view.level;
  if (level === 'deployment') return [];
  return ([1, 2, 3] as const).filter((d) => d >= level);
}

/** Profundidad actual: la del nivel más bajo que el lienzo tiene abierto. */
export function depthOf(model: Model, view: View): Depth {
  let depth: Depth = view.level === 'deployment' ? 1 : view.level;
  for (const id of view.expanded ?? []) {
    if (!isExpandedInView(view, id)) continue;
    const level = childLevelOf(model.elements[id]?.kind ?? 'actor');
    if (level && level !== 'deployment' && level > depth) depth = level;
  }
  return depth;
}

/**
 * Lleva todo el lienzo a una profundidad: en 1 no queda nada abierto; en 2, los sistemas; en 3,
 * también los contenedores. Solo abre lo que tiene hijos. Null si ya está así.
 */
export function setDepthOp(model: Model, viewId: Id, depth: Depth): Op | null {
  const ops: Op[] = [];
  let current = model;
  const apply = (op: Op | null) => {
    if (!op) return false;
    current = applyOp(current, op).model;
    ops.push(op);
    return true;
  };
  const placedOf = (kind: 'system' | 'container', open: boolean) => {
    const view = current.views[viewId]!;
    return Object.keys(view.nodes)
      .filter((id) => current.elements[id]?.kind === kind && isExpandedInView(view, id) === open)
      .sort((a, b) => view.nodes[a]!.y - view.nodes[b]!.y || view.nodes[a]!.x - view.nodes[b]!.x || a.localeCompare(b));
  };
  const view = model.views[viewId];
  if (!view || view.level === 'deployment') return null;

  // Cerrar de adentro hacia afuera; abrir de afuera hacia adentro.
  if (depth < 3) for (const id of placedOf('container', true)) apply(collapseInViewOp(current, viewId, id));
  if (depth < 2) for (const id of placedOf('system', true)) apply(collapseInViewOp(current, viewId, id));
  // Un lienzo de contenedores (L2) ya parte de ese nivel: ahí los otros sistemas no se abren solos.
  if (depth >= 2 && view.level < 2) {
    for (const id of placedOf('system', false)) if (c4ChildrenOf(current, id).length) apply(expandInViewOp(current, viewId, id));
  }
  if (depth >= 3 && view.level < 3) {
    for (const id of placedOf('container', false)) if (c4ChildrenOf(current, id).length) apply(expandInViewOp(current, viewId, id));
  }
  if (!ops.length) return null;
  const label = depth === 1 ? 'Ver contexto' : depth === 2 ? 'Ver contenedores' : 'Ver componentes';
  return { type: 'batch', ops, label };
}

/**
 * Deja cada marco abierto envolviendo justo a su contenido (después de mover o agregar algo
 * adentro), de adentro hacia afuera; los grupos que los contienen crecen si hace falta. Null si ya
 * estaban ajustados.
 */
export function fitExpandedOp(model: Model, viewId: Id): Op | null {
  const view = model.views[viewId];
  if (!view?.expanded?.length) return null;
  const ctx = context(model, view);
  const depth = (id: Id) => {
    let d = 0;
    for (let p = ctx.parentOf.get(id); p; p = ctx.parentOf.get(p)) d++;
    return d;
  };
  const frames = [...ctx.rects.keys()].filter((id) => ctx.childrenOf.get(id)?.length).sort((a, b) => depth(b) - depth(a));
  const touched = new Set<Id>();
  for (const frame of frames) {
    const kids = ctx.childrenOf.get(frame)!;
    const box = bounds(kids.map((k) => ctx.rects.get(k)!))!;
    const current = ctx.rects.get(frame)!;
    let next: Rect;
    if (ctx.exact.has(frame)) {
      next = {
        x: box.x - FRAME_PADDING.side,
        y: box.y - FRAME_PADDING.top,
        w: Math.max(box.w + FRAME_PADDING.side * 2, MIN_FRAME.w),
        h: Math.max(box.h + FRAME_PADDING.top + FRAME_PADDING.bottom, MIN_FRAME.h),
      };
    } else if (kids.some((k) => touched.has(k))) {
      // Un grupo o nodo de despliegue solo crece para seguir conteniendo a un marco que cambió.
      const x = Math.min(current.x, box.x - FRAME_PADDING.side);
      const y = Math.min(current.y, box.y - FRAME_PADDING.top);
      next = {
        x,
        y,
        w: Math.max(current.x + current.w, box.x + box.w + FRAME_PADDING.side) - x,
        h: Math.max(current.y + current.h, box.y + box.h + FRAME_PADDING.bottom) - y,
      };
    } else continue;
    if (Math.round(next.x) === Math.round(current.x) && Math.round(next.y) === Math.round(current.y) && Math.round(next.w) === Math.round(current.w) && Math.round(next.h) === Math.round(current.h)) continue;
    ctx.rects.set(frame, next);
    touched.add(frame);
  }
  if (!touched.size) return null;
  const nodes: Record<Id, NodeLayout> = {};
  for (const id of touched) {
    const r = ctx.rects.get(id)!;
    nodes[id] = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
  }
  return { type: 'view.place', view: viewId, nodes };
}

/**
 * Quitar del lienzo elementos abiertos se lleva lo que contienen: devuelve todos los IDs a quitar
 * y cómo queda la lista de abiertos.
 */
export function unplaceWithNested(model: Model, viewId: Id, ids: readonly Id[]): { ids: Id[]; expanded: Id[] | null } | null {
  const view = model.views[viewId];
  if (!view) return null;
  const ctx = context(model, view);
  const all = new Set<Id>();
  for (const id of ids) {
    if (!view.nodes[id]) continue;
    all.add(id);
    if (isExpandedInView(view, id)) for (const n of nestedIn(ctx, id)) all.add(n);
  }
  const expanded = (view.expanded ?? []).filter((e) => !all.has(e));
  return { ids: [...all], expanded: expanded.length ? expanded : null };
}
