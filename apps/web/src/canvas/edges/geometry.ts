import { Position } from '@xyflow/react';
import type { EdgeShape } from '@aegon/core';

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
