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

// El layout automático vive en @aegon/core (lo usan también la CLI y el servidor MCP).
export { layeredLayout, tidyGrid } from '@aegon/core';
