import type { Model } from '../model/index.ts';
import { sizeOf } from '../ops/commands.ts';
import { FRAME_PADDING, bounds, visualParentOf, type Rect } from '../layout/index.ts';
import type { Id, NodeLayout, View } from '../schema/index.ts';

/**
 * Insertar un bloque *dentro* de un nodo de despliegue del lienzo: dónde cae, y cómo crecen los
 * marcos que lo contienen para seguir envolviéndolo.
 */

/** Separación entre lo insertado y lo que el marco ya contiene (la misma que usa `freePositions`). */
const GAP = 40;
/** Lo que se corre para hacer lugar conserva la distancia que tenía, hasta esta (el aire de una flecha con etiqueta). */
const KEEP = 160;
const SEARCH_STEP = 40;

const overlaps = (a: Rect, b: Rect, gap = 0) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/**
 * Nodo de despliegue del lienzo (el más chico) que contiene el punto. Se saltean los que no valen
 * para el ambiente del lienzo: lo que se inserta no puede existir donde su nodo no existe.
 */
export function hostNodeAt(model: Model, view: View, point: { x: number; y: number }): Id | undefined {
  let best: { id: Id; area: number } | undefined;
  for (const [id, layout] of Object.entries(view.nodes)) {
    const el = model.elements[id];
    if (el?.kind !== 'node') continue;
    if (view.environment && el.environments && !el.environments.includes(view.environment)) continue;
    const size = sizeOf(el, layout);
    if (point.x < layout.x || point.x > layout.x + size.w || point.y < layout.y || point.y > layout.y + size.h) continue;
    const area = size.w * size.h;
    if (!best || area < best.area) best = { id, area };
  }
  return best?.id;
}

/**
 * Lugar para una caja de `w`×`h` dentro de un marco del lienzo: lo más cerca posible de `desired`
 * (su esquina) sin pisar lo que el marco ya contiene. Si no entra, va debajo de su contenido y el
 * marco crece hacia la derecha y abajo; los marcos que lo contienen crecen con él y lo que tenían
 * a la derecha o debajo se corre para hacerle lugar. `nodes` trae esos marcos y lo que se corrió.
 */
export function roomInside(
  model: Model,
  view: View,
  hostId: Id,
  desired: { x: number; y: number },
  w: number,
  h: number,
): { origin: { x: number; y: number }; nodes: Record<Id, NodeLayout> } {
  const placed = Object.keys(view.nodes).filter((id) => model.elements[id]);
  const parentOf = new Map<Id, Id | undefined>(placed.map((id) => [id, visualParentOf(model, view, model.elements[id]!)]));
  const kidsOf = (id: Id | undefined) => placed.filter((c) => parentOf.get(c) === id);
  const moved = new Map<Id, Rect>();
  const rect = (id: Id): Rect => moved.get(id) ?? { x: view.nodes[id]!.x, y: view.nodes[id]!.y, ...sizeOf(model.elements[id]!, view.nodes[id]) };

  // El marco elegido y los que lo contienen, de adentro hacia afuera.
  const chain: Id[] = [];
  for (let p: Id | undefined = hostId; p && !chain.includes(p); p = parentOf.get(p)) chain.push(p);

  const host = rect(hostId);
  const min = { x: Math.round(host.x + FRAME_PADDING.side), y: Math.round(host.y + FRAME_PADDING.top) };
  const max = { x: Math.round(host.x + host.w - FRAME_PADDING.side - w), y: Math.round(host.y + host.h - FRAME_PADDING.bottom - h) };

  // 1. Entra en el marco tal como está: el lugar libre más cercano al punto pedido.
  if (max.x >= min.x && max.y >= min.y) {
    const obstacles = placed.filter((id) => !chain.includes(id)).map(rect);
    const free = (p: { x: number; y: number }) => !obstacles.some((b) => overlaps({ ...p, w, h }, b, GAP));
    const clamp = (x: number, y: number) => ({ x: Math.min(Math.max(x, min.x), max.x), y: Math.min(Math.max(y, min.y), max.y) });
    const start = clamp(desired.x, desired.y);
    if (free(start)) return { origin: start, nodes: {} };
    const rings = Math.ceil(Math.max(max.x - min.x, max.y - min.y) / SEARCH_STEP) + 1;
    for (let r = 1; r <= rings; r++) {
      let best: { x: number; y: number } | null = null;
      let bestDistance = Infinity;
      for (let i = -r; i <= r; i++) {
        for (const [dx, dy] of [[i, -r], [i, r], [-r, i], [r, i]] as const) {
          const candidate = clamp(start.x + dx * SEARCH_STEP, start.y + dy * SEARCH_STEP);
          const distance = (candidate.x - start.x) ** 2 + (candidate.y - start.y) ** 2;
          if (distance < bestDistance && free(candidate)) {
            best = candidate;
            bestDistance = distance;
          }
        }
      }
      if (best) return { origin: best, nodes: {} };
    }
  }

  // 2. No entra: debajo de lo que el marco ya contiene, y los marcos crecen.
  const content = bounds(kidsOf(hostId).map(rect));
  const origin = { x: min.x, y: content ? Math.max(Math.round(content.y + content.h + GAP), min.y) : min.y };

  /** Mueve un nodo con todo lo que contiene. */
  const shift = (id: Id, dx: number, dy: number) => {
    const stack = [id];
    const seen = new Set<Id>();
    while (stack.length) {
      const next = stack.pop()!;
      if (seen.has(next)) continue;
      seen.add(next);
      const r = rect(next);
      moved.set(next, { ...r, x: r.x + dx, y: r.y + dy });
      stack.push(...kidsOf(next));
    }
  };
  /**
   * Lo que estaba a la derecha o debajo de un marco que creció y quedaría pisado (o a menos de
   * `GAP`) se corre, en cascada, y conserva la distancia que tenía (hasta `KEEP`).
   */
  const makeRoom = (siblings: readonly Id[], before: Rect, after: Rect) => {
    const push = (edge: number, was: number, at: number) => (edge + Math.min(GAP, at - was) > at ? edge + Math.min(KEEP, at - was) - at : 0);
    const queue = [{ before, after }];
    const done = new Set<Id>();
    while (queue.length) {
      const { before: b, after: a } = queue.shift()!;
      for (const id of siblings) {
        if (done.has(id)) continue;
        const s = rect(id);
        let dx = 0;
        let dy = 0;
        if (s.x >= b.x + b.w && s.y < a.y + a.h && a.y < s.y + s.h) dx = push(a.x + a.w, b.x + b.w, s.x);
        else if (s.y >= b.y + b.h && s.x < a.x + a.w && a.x < s.x + s.w) dy = push(a.y + a.h, b.y + b.h, s.y);
        if (dx <= 0 && dy <= 0) continue;
        done.add(id);
        shift(id, dx, dy);
        queue.push({ before: s, after: rect(id) });
      }
    }
  };

  const grown = new Set<Id>();
  for (const frame of chain) {
    const before = rect(frame);
    const inner = bounds([...kidsOf(frame).map(rect), ...(frame === hostId ? [{ ...origin, w, h }] : [])])!;
    const after: Rect = {
      ...before,
      w: Math.max(before.w, Math.round(inner.x + inner.w + FRAME_PADDING.side - before.x)),
      h: Math.max(before.h, Math.round(inner.y + inner.h + FRAME_PADDING.bottom - before.y)),
    };
    if (after.w === before.w && after.h === before.h) break;
    moved.set(frame, after);
    grown.add(frame);
    makeRoom(kidsOf(parentOf.get(frame)).filter((id) => id !== frame), before, after);
  }

  const nodes: Record<Id, NodeLayout> = {};
  for (const [id, r] of moved) nodes[id] = grown.has(id) ? { x: r.x, y: r.y, w: r.w, h: r.h } : { ...view.nodes[id]!, x: r.x, y: r.y };
  return { origin, nodes };
}
