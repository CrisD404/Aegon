import { Position } from '@xyflow/react';
import type { EdgeAnchor, EdgeShape } from '@aegon/core';

export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

/** Extremos de una flecha flotante: dónde corta el borde de cada nodo y de qué lado sale. */
export interface EdgeEnds {
  sourceX: number;
  sourceY: number;
  sourcePosition: Position;
  targetX: number;
  targetY: number;
  targetPosition: Position;
}

const center = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Punto donde la recta entre centros corta el borde del nodo (edges "flotantes"). */
export function borderPoint(r: Rect, toward: Pt, gap = 3): { point: Pt; side: Position } {
  const c = center(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const hw = r.w / 2 + gap;
  const hh = r.h / 2 + gap;
  if (dx === 0 && dy === 0) return { point: { x: c.x, y: r.y }, side: Position.Top };
  const scale = Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
  const point = { x: c.x + dx * scale, y: c.y + dy * scale };
  const onVertical = Math.abs(Math.abs(point.x - c.x) - hw) < 0.5;
  const side = onVertical
    ? dx > 0
      ? Position.Right
      : Position.Left
    : dy > 0
      ? Position.Bottom
      : Position.Top;
  return { point, side };
}

/** Extremos entre dos nodos (la punta de la flecha queda un poco más separada del destino). */
export function floatingEnds(source: Rect, target: Rect): EdgeEnds {
  const a = borderPoint(source, center(target));
  const b = borderPoint(target, center(source), 6);
  return {
    sourceX: a.point.x,
    sourceY: a.point.y,
    sourcePosition: a.side,
    targetX: b.point.x,
    targetY: b.point.y,
    targetPosition: b.side,
  };
}

/** Curvatura de las flechas curvas del lienzo (la misma que se le pasa a `getBezierPath`). */
export const CURVATURE = 0.3;

// Puntos de control como los calcula `getBezierPath` de ReactFlow.
function controlOffset(distance: number, curvature: number): number {
  return distance >= 0 ? 0.5 * distance : curvature * 25 * Math.sqrt(-distance);
}

function control(pos: Position, x1: number, y1: number, x2: number, y2: number, c: number): Pt {
  switch (pos) {
    case Position.Left:
      return { x: x1 - controlOffset(x1 - x2, c), y: y1 };
    case Position.Right:
      return { x: x1 + controlOffset(x2 - x1, c), y: y1 };
    case Position.Top:
      return { x: x1, y: y1 - controlOffset(y1 - y2, c) };
    default:
      return { x: x1, y: y1 + controlOffset(y2 - y1, c) };
  }
}

/**
 * Punto del trazo en `t` (0 = origen, 1 = destino), para ubicar la etiqueta donde no tape nada.
 * Null para las flechas en escalón (su etiqueta queda donde la pone ReactFlow).
 */
export function pointOnEdge(shape: EdgeShape, e: EdgeEnds, t: number): Pt | null {
  if (shape === 'step') return null;
  if (shape === 'straight')
    return {
      x: e.sourceX + (e.targetX - e.sourceX) * t,
      y: e.sourceY + (e.targetY - e.sourceY) * t,
    };
  const c1 = control(e.sourcePosition, e.sourceX, e.sourceY, e.targetX, e.targetY, CURVATURE);
  const c2 = control(e.targetPosition, e.targetX, e.targetY, e.sourceX, e.sourceY, CURVATURE);
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * e.sourceX + b * c1.x + c * c2.x + d * e.targetX,
    y: a * e.sourceY + b * c1.y + c * c2.y + d * e.targetY,
  };
}

// --- Recorrido acomodado a mano ------------------------------------------------------------------

/** Punto del borde que marca un anclaje (lado y posición sobre el lado), separado `gap` hacia afuera. */
export function anchorPoint(r: Rect, anchor: EdgeAnchor, gap = 3): { point: Pt; side: Position } {
  const at = anchor.at ?? 0.5;
  switch (anchor.side) {
    case 'top':
      return { point: { x: r.x + r.w * at, y: r.y - gap }, side: Position.Top };
    case 'bottom':
      return { point: { x: r.x + r.w * at, y: r.y + r.h + gap }, side: Position.Bottom };
    case 'left':
      return { point: { x: r.x - gap, y: r.y + r.h * at }, side: Position.Left };
    default:
      return { point: { x: r.x + r.w + gap, y: r.y + r.h * at }, side: Position.Right };
  }
}

/** Cuánto se aleja un anclaje de las esquinas (redondeadas) del nodo. */
const CORNER_MARGIN = 12;

/**
 * Anclaje que corresponde a un punto (el del mouse al arrastrar una punta): el lado más cercano y
 * la posición sobre ese lado. Dentro de `snap` se engancha en línea con `toward` (el punto hacia
 * el que va la flecha: el tramo sale derecho) o al medio del lado.
 */
export function nearestAnchor(r: Rect, p: Pt, toward?: Pt, snap = 0): EdgeAnchor {
  const clampX = Math.min(r.x + r.w, Math.max(r.x, p.x));
  const clampY = Math.min(r.y + r.h, Math.max(r.y, p.y));
  const distances: [EdgeAnchor['side'], number][] = [
    ['top', Math.hypot(p.x - clampX, p.y - r.y)],
    ['bottom', Math.hypot(p.x - clampX, p.y - (r.y + r.h))],
    ['left', Math.hypot(p.x - r.x, p.y - clampY)],
    ['right', Math.hypot(p.x - (r.x + r.w), p.y - clampY)],
  ];
  const side = distances.reduce((best, d) => (d[1] < best[1] ? d : best))[0];
  const horizontal = side === 'top' || side === 'bottom';
  const from = horizontal ? r.x : r.y;
  const length = horizontal ? r.w : r.h;
  if (length <= 0) return { side };
  const margin = Math.min(CORNER_MARGIN, length / 2);
  let v = Math.min(from + length - margin, Math.max(from + margin, horizontal ? p.x : p.y));
  const wanted = toward ? (horizontal ? toward.x : toward.y) : undefined;
  const middle = from + length / 2;
  if (wanted !== undefined && wanted >= from + margin && wanted <= from + length - margin && Math.abs(v - wanted) <= snap) v = wanted;
  else if (Math.abs(v - middle) <= snap) v = middle;
  const at = Math.round(((v - from) / length) * 1000) / 1000;
  return Math.abs(at - 0.5) < 0.001 ? { side } : { side, at };
}

/**
 * Extremos de una flecha. Una punta con anclaje queda fija en ese lugar del borde; una libre mira
 * hacia donde va la flecha: el punto más cercano del recorrido a mano o, si no hay, la otra punta.
 */
export function edgeEnds(source: Rect, target: Rect, opts: { from?: EdgeAnchor; to?: EdgeAnchor; points?: readonly Pt[] } = {}): EdgeEnds {
  const first = opts.points?.[0];
  const last = opts.points?.[opts.points.length - 1];
  const fixedA = opts.from ? anchorPoint(source, opts.from) : null;
  const fixedB = opts.to ? anchorPoint(target, opts.to, 6) : null;
  const a = fixedA ?? borderPoint(source, first ?? fixedB?.point ?? center(target));
  const b = fixedB ?? borderPoint(target, last ?? fixedA?.point ?? center(source), 6);
  return {
    sourceX: a.point.x,
    sourceY: a.point.y,
    sourcePosition: a.side,
    targetX: b.point.x,
    targetY: b.point.y,
    targetPosition: b.side,
  };
}

/** Radio con que se redondean los quiebres de una flecha recta o escalonada. */
const CORNER = 14;

/** Puntos de control de la curva suave (Catmull-Rom) entre `chain[i]` y `chain[i + 1]`. */
function splineControls(chain: readonly Pt[], i: number): [Pt, Pt] {
  const p0 = chain[i - 1] ?? chain[i]!;
  const p1 = chain[i]!;
  const p2 = chain[i + 1]!;
  const p3 = chain[i + 2] ?? p2;
  return [
    { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
    { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
  ];
}

const n = (v: number) => Math.round(v * 100) / 100;

/**
 * Trazo SVG por todos los puntos de `chain` (extremos incluidos): una curva suave para las flechas
 * curvas; tramos derechos con los quiebres redondeados para las rectas y las escalonadas.
 */
export function routedPath(shape: EdgeShape, chain: readonly Pt[]): string {
  const first = chain[0]!;
  let d = `M${n(first.x)},${n(first.y)}`;
  if (shape === 'curved') {
    for (let i = 0; i + 1 < chain.length; i++) {
      const [c1, c2] = splineControls(chain, i);
      const p = chain[i + 1]!;
      d += ` C${n(c1.x)},${n(c1.y)} ${n(c2.x)},${n(c2.y)} ${n(p.x)},${n(p.y)}`;
    }
    return d;
  }
  for (let i = 1; i < chain.length; i++) {
    const p = chain[i]!;
    const next = chain[i + 1];
    if (!next) {
      d += ` L${n(p.x)},${n(p.y)}`;
      break;
    }
    const prev = chain[i - 1]!;
    const inLen = Math.hypot(p.x - prev.x, p.y - prev.y);
    const outLen = Math.hypot(next.x - p.x, next.y - p.y);
    const r = Math.min(CORNER, inLen / 2, outLen / 2);
    if (r < 1) {
      d += ` L${n(p.x)},${n(p.y)}`;
      continue;
    }
    const a = { x: p.x - ((p.x - prev.x) / inLen) * r, y: p.y - ((p.y - prev.y) / inLen) * r };
    const b = { x: p.x + ((next.x - p.x) / outLen) * r, y: p.y + ((next.y - p.y) / outLen) * r };
    d += ` L${n(a.x)},${n(a.y)} Q${n(p.x)},${n(p.y)} ${n(b.x)},${n(b.y)}`;
  }
  return d;
}

/** Distancia de `p` al segmento `a`–`b`. */
export function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** Punto del tramo `i` del recorrido (entre `chain[i]` y `chain[i + 1]`) a la fracción `t`, sobre el trazo. */
export function routedPointAt(shape: EdgeShape, chain: readonly Pt[], i: number, t: number): Pt {
  const a = chain[i]!;
  const b = chain[i + 1]!;
  if (shape !== 'curved') return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  const [c1, c2] = splineControls(chain, i);
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
    y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
  };
}

/** Punto a una fracción del largo de un recorrido a mano (0 = origen, 1 = destino), sobre el trazo. */
export function routedPointAlong(shape: EdgeShape, chain: readonly Pt[], fraction: number): Pt {
  const lengths = chain.slice(0, -1).map((a, i) => Math.hypot(chain[i + 1]!.x - a.x, chain[i + 1]!.y - a.y));
  let rest = Math.min(1, Math.max(0, fraction)) * lengths.reduce((sum, l) => sum + l, 0);
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i]!;
    if (rest <= length || i === lengths.length - 1) return routedPointAt(shape, chain, i, length ? Math.min(1, rest / length) : 0);
    rest -= length;
  }
  return chain[chain.length - 1]!;
}

/** Tramo más largo del recorrido: ahí va la etiqueta, lejos de los puntos que se arrastran. */
export function longestSegment(chain: readonly Pt[]): number {
  let best = 0;
  let length = -1;
  for (let i = 0; i + 1 < chain.length; i++) {
    const len = Math.hypot(chain[i + 1]!.x - chain[i]!.x, chain[i + 1]!.y - chain[i]!.y);
    if (len > length) {
      length = len;
      best = i;
    }
  }
  return best;
}
