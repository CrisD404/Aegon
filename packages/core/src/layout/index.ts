import type { Model } from '../model/index.ts';
import type { Id, NodeLayout } from '../schema/index.ts';
import { representativeInView, sizeOf } from '../ops/commands.ts';
import type { Op } from '../ops/index.ts';

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
  ids.forEach((id, i) => {
    if (!b) out[id] = { x: (i % 4) * 320, y: Math.floor(i / 4) * 220 };
    else out[id] = { x: Math.round(b.x + b.w + 100), y: Math.round(b.y + i * 160) };
  });
  return out;
}
