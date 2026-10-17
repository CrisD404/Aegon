export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GuideLine {
  orientation: 'v' | 'h';
  /** Coordenada fija (x para verticales, y para horizontales). */
  at: number;
  from: number;
  to: number;
}

export function center(r: Rect) {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function contains(outer: Rect, point: { x: number; y: number }) {
  return point.x >= outer.x && point.x <= outer.x + outer.w && point.y >= outer.y && point.y <= outer.y + outer.h;
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
 * Guías inteligentes: alinea bordes y centros del rectángulo que se mueve con los demás.
 * Devuelve el ajuste a aplicar (snap) y las líneas a dibujar.
 */
export function computeGuides(moving: Rect, others: readonly Rect[], threshold: number): { dx: number; dy: number; lines: GuideLine[] } {
  const xs = (r: Rect) => [r.x, r.x + r.w / 2, r.x + r.w];
  const ys = (r: Rect) => [r.y, r.y + r.h / 2, r.y + r.h];
  let bestX: { diff: number; target: number } | null = null;
  let bestY: { diff: number; target: number } | null = null;
  for (const o of others) {
    for (const mx of xs(moving)) {
      for (const ox of xs(o)) {
        const diff = ox - mx;
        if (Math.abs(diff) <= threshold && (!bestX || Math.abs(diff) < Math.abs(bestX.diff))) bestX = { diff, target: ox };
      }
    }
    for (const my of ys(moving)) {
      for (const oy of ys(o)) {
        const diff = oy - my;
        if (Math.abs(diff) <= threshold && (!bestY || Math.abs(diff) < Math.abs(bestY.diff))) bestY = { diff, target: oy };
      }
    }
  }
  const dx = bestX?.diff ?? 0;
  const dy = bestY?.diff ?? 0;
  const snapped = { ...moving, x: moving.x + dx, y: moving.y + dy };
  const lines: GuideLine[] = [];
  const eps = 0.5;
  if (bestX) {
    const at = bestX.target;
    const aligned = others.filter((o) => xs(o).some((v) => Math.abs(v - at) < eps));
    const all = [snapped, ...aligned];
    lines.push({ orientation: 'v', at, from: Math.min(...all.map((r) => r.y)) - 12, to: Math.max(...all.map((r) => r.y + r.h)) + 12 });
  }
  if (bestY) {
    const at = bestY.target;
    const aligned = others.filter((o) => ys(o).some((v) => Math.abs(v - at) < eps));
    const all = [snapped, ...aligned];
    lines.push({ orientation: 'h', at, from: Math.min(...all.map((r) => r.x)) - 12, to: Math.max(...all.map((r) => r.x + r.w)) + 12 });
  }
  return { dx, dy, lines };
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** Alinea rectángulos; devuelve las nuevas posiciones por id. */
export function align<T extends Rect & { id: string }>(rects: readonly T[], mode: AlignMode): Map<string, { x: number; y: number }> {
  const b = bounds(rects);
  const out = new Map<string, { x: number; y: number }>();
  if (!b) return out;
  for (const r of rects) {
    let { x, y } = r;
    if (mode === 'left') x = b.x;
    if (mode === 'right') x = b.x + b.w - r.w;
    if (mode === 'hcenter') x = b.x + b.w / 2 - r.w / 2;
    if (mode === 'top') y = b.y;
    if (mode === 'bottom') y = b.y + b.h - r.h;
    if (mode === 'vcenter') y = b.y + b.h / 2 - r.h / 2;
    out.set(r.id, { x, y });
  }
  return out;
}

/** Distribuye con espacios iguales entre el primero y el último. */
export function distribute<T extends Rect & { id: string }>(rects: readonly T[], axis: 'h' | 'v'): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (rects.length < 3) return out;
  const sorted = [...rects].sort((a, b) => (axis === 'h' ? a.x - b.x : a.y - b.y));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const span = axis === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y;
  const total = sorted.reduce((sum, r) => sum + (axis === 'h' ? r.w : r.h), 0);
  const gap = (span - total) / (sorted.length - 1);
  let cursor = axis === 'h' ? first.x : first.y;
  for (const r of sorted) {
    out.set(r.id, axis === 'h' ? { x: cursor, y: r.y } : { x: r.x, y: cursor });
    cursor += (axis === 'h' ? r.w : r.h) + gap;
  }
  return out;
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
