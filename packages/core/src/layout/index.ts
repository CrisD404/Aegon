import type { Model } from '../model/index.ts';
import type { Element, ElementKind, Id, NodeLayout, View } from '../schema/index.ts';
import { allViewEdges, representativeInView, sizeOf } from '../ops/commands.ts';
import type { Op } from '../ops/index.ts';

/** Tipos que se dibujan como marcos que contienen a otros: grupos y nodos de despliegue. */
export function isFrameKind(kind: ElementKind): boolean {
  return kind === 'group' || kind === 'node';
}

function frameDepth(model: Model, id: Id): number {
  let depth = 0;
  let current = model.elements[id]?.parent;
  const seen = new Set<Id>();
  while (current && !seen.has(current)) {
    seen.add(current);
    depth++;
    current = model.elements[current]?.parent;
  }
  return depth;
}

/**
 * Marco (ubicado en el lienzo) que contiene visualmente a un elemento: para grupos y elementos
 * de despliegue, el ancestro ubicado más cercano; para el resto, el grupo ubicado más profundo
 * de los que integra.
 */
export function visualParentOf(model: Model, view: View, el: Element): Id | undefined {
  if (el.kind === 'group' || el.kind === 'node' || el.kind === 'infra' || el.kind === 'instance') {
    let current = el.parent;
    const seen = new Set<Id>();
    while (current && !seen.has(current)) {
      const parent = model.elements[current];
      if (view.nodes[current] && parent && isFrameKind(parent.kind)) return current;
      seen.add(current);
      current = parent?.parent;
    }
    return undefined;
  }
  let best: Id | undefined;
  let bestDepth = -1;
  for (const g of el.groups ?? []) {
    if (!view.nodes[g] || model.elements[g]?.kind !== 'group') continue;
    const depth = frameDepth(model, g);
    if (depth > bestDepth) {
      best = g;
      bestDepth = depth;
    }
  }
  return best;
}

/** Margen interno de un marco: arriba deja lugar para su etiqueta. */
export const FRAME_PADDING = { top: 64, side: 40, bottom: 40 } as const;

/**
 * Layout automático de lienzos. Lo comparten el lienzo (`Shift+L`), la CLI (`aegon layout`) y el
 * servidor MCP (`layout_view`), así un agente acomoda igual que la app.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function bounds(rects: readonly Rect[]): Rect | null {
  if (!rects.length) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w);
    y2 = Math.max(y2, r.y + r.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/**
 * Orden automático por capas (de arriba hacia abajo siguiendo la dirección de las relaciones):
 * actores arriba, luego quienes los usan, y así. Una pasada de baricentro reduce cruces.
 */
export function layeredLayout(
  rects: readonly (Rect & { id: string; rank?: number })[],
  edges: readonly { from: string; to: string }[],
  origin: { x: number; y: number },
  gap = { x: 72, y: 110 },
): Map<string, { x: number; y: number }> {
  const ids = new Set(rects.map((r) => r.id));
  const out = new Map<string, { x: number; y: number }>();
  if (!rects.length) return out;
  const succ = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const id of ids) {
    succ.set(id, []);
    indeg.set(id, 0);
  }
  const seenEdge = new Set<string>();
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
    const key = `${e.from}>${e.to}`;
    if (seenEdge.has(key) || seenEdge.has(`${e.to}>${e.from}`)) continue;
    seenEdge.add(key);
    succ.get(e.from)!.push(e.to);
    indeg.set(e.to, indeg.get(e.to)! + 1);
  }
  // Longest-path layering con ruptura de ciclos (Kahn; lo que queda en ciclo va a la capa siguiente).
  const layer = new Map<string, number>();
  const queue = rects.filter((r) => indeg.get(r.id) === 0).map((r) => r.id);
  const queued = new Set(queue);
  for (const r of rects) if (queued.has(r.id)) layer.set(r.id, r.rank ?? 0);
  const remaining = new Map(indeg);
  let qi = 0;
  const processed = new Set<string>();
  while (processed.size < ids.size) {
    if (qi >= queue.length) {
      const next = rects.find((r) => !processed.has(r.id) && !queued.has(r.id))!;
      layer.set(next.id, Math.max(layer.get(next.id) ?? 0, 0));
      queue.push(next.id);
      queued.add(next.id);
    }
    const id = queue[qi++]!;
    if (processed.has(id)) continue;
    processed.add(id);
    for (const s of succ.get(id)!) {
      layer.set(s, Math.max(layer.get(s) ?? 0, layer.get(id)! + 1));
      remaining.set(s, remaining.get(s)! - 1);
      if (remaining.get(s) === 0 && !queued.has(s)) {
        queue.push(s);
        queued.add(s);
      }
    }
  }
  const byLayer = new Map<number, (Rect & { id: string })[]>();
  for (const r of rects) {
    const l = layer.get(r.id) ?? 0;
    byLayer.set(l, [...(byLayer.get(l) ?? []), r]);
  }
  const layers = [...byLayer.keys()].sort((a, b) => a - b);
  const order = new Map<string, number>();
  const predecessors = new Map<string, string[]>();
  for (const [from, tos] of succ) for (const to of tos) predecessors.set(to, [...(predecessors.get(to) ?? []), from]);
  let y = origin.y;
  const rowWidths = layers.map((l) => byLayer.get(l)!.reduce((s, r) => s + r.w, 0) + gap.x * (byLayer.get(l)!.length - 1));
  const maxWidth = Math.max(...rowWidths);
  layers.forEach((l, li) => {
    const row = byLayer.get(l)!;
    // Baricentro respecto de las capas ya ubicadas.
    const bary = new Map<string, number>();
    for (const r of row) {
      const placed = (predecessors.get(r.id) ?? []).filter((p) => order.has(p)).map((p) => order.get(p)!);
      bary.set(r.id, placed.length ? placed.reduce((s, v) => s + v, 0) / placed.length : Number.MAX_SAFE_INTEGER / 2);
    }
    row.sort((a, b) => bary.get(a.id)! - bary.get(b.id)! || a.x - b.x);
    let x = origin.x + (maxWidth - rowWidths[li]!) / 2;
    row.forEach((r, i) => {
      out.set(r.id, { x, y });
      order.set(r.id, i);
      x += r.w + gap.x;
    });
    y += Math.max(...row.map((r) => r.h)) + gap.y;
  });
  return out;
}

/** Acomoda en una grilla prolija conservando el orden visual (filas por y, luego x). */
export function tidyGrid<T extends Rect & { id: string }>(rects: readonly T[], gap = 56): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const b = bounds(rects);
  if (!b) return out;
  const sorted = [...rects].sort((a, c) => a.y - c.y || a.x - c.x);
  const cols = Math.max(1, Math.round(Math.sqrt(rects.length * 1.6)));
  const colW = Math.max(...rects.map((r) => r.w));
  const rowH = Math.max(...rects.map((r) => r.h));
  sorted.forEach((r, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    out.set(r.id, { x: b.x + col * (colW + gap) + (colW - r.w) / 2, y: b.y + row * (rowH + gap) + (rowH - r.h) / 2 });
  });
  return out;
}

/**
 * Op que ordena un lienzo (o solo `ids`, si son dos o más): por capas si hay relaciones entre
 * ellos, en grilla si no. Los grupos se ajustan para seguir envolviendo a sus miembros.
 * Devuelve `null` si no hay nada que ordenar.
 */
export function arrangeViewOp(model: Model, viewId: Id, ids?: readonly Id[]): Op | null {
  const view = model.views[viewId];
  if (!view) return null;
  if (!(ids && ids.length > 1)) {
    const nested = arrangeNestedOp(model, view);
    if (nested !== undefined) return nested;
  }
  const targets = (ids && ids.length > 1 ? ids : Object.keys(view.nodes)).filter(
    (id) => view.nodes[id] && model.elements[id] && model.elements[id].kind !== 'group',
  );
  const rects = targets.map((id) => {
    const layout = view.nodes[id]!;
    const el = model.elements[id]!;
    return { id, x: layout.x, y: layout.y, ...sizeOf(el, layout), rank: el.kind === 'actor' ? 0 : undefined };
  });
  if (rects.length < 2) return null;
  const edges: { from: Id; to: Id }[] = [];
  for (const rel of Object.values(model.relations)) {
    const a = representativeInView(model, view, rel.from);
    const b = representativeInView(model, view, rel.to);
    if (a && b && a !== b) edges.push({ from: a, to: b });
  }
  const origin = { x: Math.min(...rects.map((r) => r.x)), y: Math.min(...rects.map((r) => r.y)) };
  const positions = edges.some((e) => targets.includes(e.from) && targets.includes(e.to))
    ? layeredLayout(rects, edges, origin)
    : tidyGrid(rects);

  const nodes: Record<Id, NodeLayout> = {};
  for (const [id, pos] of positions) nodes[id] = { ...view.nodes[id]!, x: Math.round(pos.x), y: Math.round(pos.y) };
  for (const [gid, layout] of Object.entries(view.nodes)) {
    if (model.elements[gid]?.kind !== 'group') continue;
    const members = Object.keys(nodes).filter((id) => model.elements[id]?.groups?.includes(gid));
    if (!members.length) continue;
    const rs = members.map((id) => ({ ...nodes[id]!, ...sizeOf(model.elements[id]!, nodes[id]) }));
    const x = Math.min(...rs.map((r) => r.x)) - 40;
    const y = Math.min(...rs.map((r) => r.y)) - 64;
    const w = Math.max(...rs.map((r) => r.x + r.w)) + 40 - x;
    const h = Math.max(...rs.map((r) => r.y + r.h)) + 40 - y;
    nodes[gid] = { ...layout, x, y, w, h };
  }
  return { type: 'view.place', view: viewId, nodes };
}

/**
 * Posiciones libres para ubicar elementos nuevos en un lienzo sin pisar lo que ya hay: una
 * columna a la derecha de lo ubicado (o una grilla desde el origen si el lienzo está vacío).
 */
export function freePositions(model: Model, viewId: Id, ids: readonly Id[]): Record<Id, NodeLayout> {
  const view = model.views[viewId];
  const out: Record<Id, NodeLayout> = {};
  if (!view) return out;
  const placed = Object.entries(view.nodes)
    .filter(([id]) => model.elements[id])
    .map(([id, layout]) => ({ x: layout.x, y: layout.y, ...sizeOf(model.elements[id]!, layout) }));
  const b = bounds(placed);
  let loose = 0;
  ids.forEach((id) => {
    // Dentro de su marco (nodo o grupo ubicado): debajo de lo que ya contiene, y el marco crece.
    const el = model.elements[id];
    const frameId = el ? visualParentOf(model, view, el) : undefined;
    const frame = frameId ? (out[frameId] ?? view.nodes[frameId]) : undefined;
    if (el && frameId && frame) {
      const fs = sizeOf(model.elements[frameId]!, frame);
      const inside = Object.entries({ ...view.nodes, ...out })
        .filter(([cid]) => cid !== id && cid !== frameId && model.elements[cid] && visualParentOf(model, view, model.elements[cid]!) === frameId)
        .map(([cid, l]) => ({ ...l, ...sizeOf(model.elements[cid]!, l) }));
      const ib = bounds(inside);
      const pos = { x: Math.round(frame.x + FRAME_PADDING.side), y: Math.round(ib ? ib.y + ib.h + 40 : frame.y + FRAME_PADDING.top) };
      out[id] = pos;
      const own = sizeOf(el, undefined);
      out[frameId] = {
        ...frame,
        w: Math.max(fs.w, pos.x + own.w + FRAME_PADDING.side - frame.x),
        h: Math.max(fs.h, pos.y + own.h + FRAME_PADDING.bottom - frame.y),
      };
      return;
    }
    if (!b) out[id] = { x: (loose % 4) * 320, y: Math.floor(loose / 4) * 220 };
    else out[id] = { x: Math.round(b.x + b.w + 100), y: Math.round(b.y + loose * 160) };
    loose++;
  });
  return out;
}

/**
 * Layout jerárquico para lienzos con marcos que contienen elementos (grupos o nodos de
 * despliegue): de adentro hacia afuera, ordena los hijos de cada marco y lo ajusta a su
 * contenido; después ordena los hermanos de cada nivel con las relaciones elevadas a ese nivel.
 * Devuelve `undefined` si el lienzo no tiene marcos con contenido (se usa el layout plano).
 */
function arrangeNestedOp(model: Model, view: View): Op | null | undefined {
  const placed = Object.keys(view.nodes).filter((id) => model.elements[id]);
  const parentOf = new Map<Id, Id | undefined>();
  const childrenOf = new Map<Id | undefined, Id[]>();
  for (const id of placed) {
    const parent = visualParentOf(model, view, model.elements[id]!);
    parentOf.set(id, parent);
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), id]);
  }
  if (![...childrenOf.keys()].some((k) => k !== undefined)) return undefined;

  // Cadena de marcos de un nodo del lienzo (él mismo primero).
  const chain = (id: Id): Id[] => {
    const out = [id];
    let p = parentOf.get(id);
    while (p) {
      out.push(p);
      p = parentOf.get(p);
    }
    return out;
  };
  const edges = allViewEdges(model, view).map((e) => ({ from: chain(e.from), to: chain(e.to) }));
  const byPosition = (a: Id, b: Id) => view.nodes[a]!.y - view.nodes[b]!.y || view.nodes[a]!.x - view.nodes[b]!.x;

  const size = new Map<Id, { w: number; h: number }>();
  const relative = new Map<Id, { x: number; y: number }>();
  const layoutLevel = (parent: Id | undefined) => {
    const kids = [...(childrenOf.get(parent) ?? [])].sort(byPosition);
    for (const k of kids) if (childrenOf.has(k)) layoutLevel(k);
    const rects = kids.map((id) => {
      const el = model.elements[id]!;
      const s = size.get(id) ?? sizeOf(el, view.nodes[id]);
      return { id, x: view.nodes[id]!.x, y: view.nodes[id]!.y, w: s.w, h: s.h, rank: el.kind === 'actor' ? 0 : undefined };
    });
    const set = new Set(kids);
    // Relaciones elevadas a este nivel: el ancestro de cada extremo que es hijo de `parent`.
    const lifted: { from: Id; to: Id }[] = [];
    for (const e of edges) {
      const a = e.from.find((x) => set.has(x));
      const b = e.to.find((x) => set.has(x));
      if (a && b && a !== b) lifted.push({ from: a, to: b });
    }
    const positions = lifted.length ? layeredLayout(rects, lifted, { x: 0, y: 0 }) : tidyGrid(rects.map((r) => ({ ...r })));
    const b = bounds(rects.map((r) => ({ ...r, ...positions.get(r.id)! })));
    for (const r of rects) {
      const pos = positions.get(r.id)!;
      relative.set(r.id, { x: pos.x - (b?.x ?? 0), y: pos.y - (b?.y ?? 0) });
    }
    if (parent !== undefined) {
      size.set(parent, {
        w: Math.max((b?.w ?? 0) + FRAME_PADDING.side * 2, 280),
        h: Math.max((b?.h ?? 0) + FRAME_PADDING.top + FRAME_PADDING.bottom, 160),
      });
    }
  };
  layoutLevel(undefined);

  // Coordenadas absolutas, ancladas en la esquina superior izquierda actual del lienzo.
  const anchor = bounds(placed.map((id) => ({ ...view.nodes[id]!, ...sizeOf(model.elements[id]!, view.nodes[id]) })))!;
  const nodes: Record<Id, NodeLayout> = {};
  const place = (parent: Id | undefined, ox: number, oy: number) => {
    for (const id of childrenOf.get(parent) ?? []) {
      const rel = relative.get(id)!;
      const x = Math.round(ox + rel.x);
      const y = Math.round(oy + rel.y);
      const framed = size.get(id);
      nodes[id] = framed ? { x, y, w: Math.round(framed.w), h: Math.round(framed.h) } : { ...view.nodes[id]!, x, y };
      if (childrenOf.has(id)) place(id, x + FRAME_PADDING.side, y + FRAME_PADDING.top);
    }
  };
  place(undefined, anchor.x, anchor.y);
  const changed = Object.entries(nodes).filter(([id, l]) => {
    const prev = view.nodes[id]!;
    return prev.x !== l.x || prev.y !== l.y || prev.w !== l.w || prev.h !== l.h;
  });
  return changed.length ? { type: 'view.place', view: view.id, nodes: Object.fromEntries(changed) } : null;
}

/**
 * Ajusta cada marco (nodo de despliegue o grupo) a lo que contiene, de adentro hacia afuera, sin
 * mover nada más: deja el margen de la etiqueta arriba y el de los costados. Null si ya estaban.
 */
export function fitFramesOp(model: Model, viewId: Id): Op | null {
  const view = model.views[viewId];
  if (!view) return null;
  const placed = Object.keys(view.nodes).filter((id) => model.elements[id]);
  const parentOf = new Map<Id, Id | undefined>(placed.map((id) => [id, visualParentOf(model, view, model.elements[id]!)]));
  const depth = (id: Id) => {
    let d = 0;
    for (let p = parentOf.get(id); p; p = parentOf.get(p)) d++;
    return d;
  };
  const rects = new Map<Id, { x: number; y: number; w: number; h: number }>(
    placed.map((id) => [id, { ...view.nodes[id]!, ...sizeOf(model.elements[id]!, view.nodes[id]) }]),
  );
  const frames = placed.filter((id) => placed.some((c) => parentOf.get(c) === id)).sort((a, b) => depth(b) - depth(a));
  const nodes: Record<Id, NodeLayout> = {};
  for (const frame of frames) {
    const box = bounds(placed.filter((c) => parentOf.get(c) === frame).map((c) => rects.get(c)!))!;
    const next = {
      x: Math.round(box.x - FRAME_PADDING.side),
      y: Math.round(box.y - FRAME_PADDING.top),
      w: Math.round(Math.max(box.w + FRAME_PADDING.side * 2, 280)),
      h: Math.round(Math.max(box.h + FRAME_PADDING.top + FRAME_PADDING.bottom, 160)),
    };
    rects.set(frame, next);
    const prev = view.nodes[frame]!;
    if (prev.x !== next.x || prev.y !== next.y || prev.w !== next.w || prev.h !== next.h) nodes[frame] = next;
  }
  return Object.keys(nodes).length ? { type: 'view.place', view: viewId, nodes } : null;
}
