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
 * Una medida sobre el lienzo: la separación entre dos componentes vecinos de una fila o columna (el
 * tramo que los separa y cuánto mide) o, al redimensionar, el lado de un componente que quedó igual
 * al de otro.
 */
export interface GapMark {
  /** `h`: vecinos lado a lado (el tramo va de izquierda a derecha). `v`: uno arriba del otro. */
  axis: 'h' | 'v';
  from: number;
  to: number;
  /** Coordenada en el otro eje por donde pasa el tramo (el medio de lo que comparten). */
  at: number;
  size: number;
  /** Se repite: en la misma fila o columna hay otra separación igual. */
  equal: boolean;
}

export interface Guides {
  dx: number;
  dy: number;
  lines: GuideLine[];
  gaps: GapMark[];
}

/** Hasta dónde se mide la separación con un vecino: más lejos ya no es "el de al lado". */
const MAX_GAP = 480;
const EPS = 0.5;

type Axis = 'h' | 'v';
const start = (r: Rect, axis: Axis) => (axis === 'h' ? r.x : r.y);
const size = (r: Rect, axis: Axis) => (axis === 'h' ? r.w : r.h);
const end = (r: Rect, axis: Axis) => start(r, axis) + size(r, axis);
const cross = (axis: Axis): Axis => (axis === 'h' ? 'v' : 'h');
const edgesOf = (r: Rect, axis: Axis) => [start(r, axis), end(r, axis)];
const middle = (r: Rect, axis: Axis) => start(r, axis) + size(r, axis) / 2;

/** Vecinos de fila (eje `h`) o de columna (eje `v`): los que comparten franja con `m` en el otro eje. */
function mates(m: Rect, siblings: readonly Rect[], axis: Axis): Rect[] {
  const c = cross(axis);
  return siblings.filter((o) => start(o, c) < end(m, c) && end(o, c) > start(m, c)).sort((a, b) => start(a, axis) - start(b, axis));
}

/** Vecino inmediato de cada lado y las separaciones que ya hay entre los demás de la fila o columna. */
function neighborhood(m: Rect, siblings: readonly Rect[], axis: Axis, slack: number) {
  const row = mates(m, siblings, axis);
  let before: Rect | undefined;
  let after: Rect | undefined;
  for (const o of row) {
    if (end(o, axis) <= start(m, axis) + slack && (!before || end(o, axis) > end(before, axis))) before = o;
    if (start(o, axis) >= end(m, axis) - slack && (!after || start(o, axis) < start(after, axis))) after = o;
  }
  // Separaciones entre vecinos consecutivos, sin contar el hueco donde está parado `m`.
  const pairs: { a: Rect; b: Rect; gap: number }[] = [];
  for (let i = 0; i + 1 < row.length; i++) {
    const a = row[i]!;
    const b = row[i + 1]!;
    const gap = start(b, axis) - end(a, axis);
    // Más lejos que `MAX_GAP` ya no es un patrón que se vea: ni se mide ni se copia.
    if (gap > 0 && gap <= MAX_GAP && !(a === before && b === after)) pairs.push({ a, b, gap });
  }
  return { before, after, pairs };
}

/** Ajustes que dejan a `m` a la misma distancia que otros de su fila o columna, o centrado entre dos. */
function spacingDiffs(m: Rect, siblings: readonly Rect[], axis: Axis, threshold: number): number[] {
  const { before, after, pairs } = neighborhood(m, siblings, axis, threshold);
  const targets: number[] = [];
  for (const { gap } of pairs) {
    if (before) targets.push(end(before, axis) + gap);
    if (after) targets.push(start(after, axis) - gap - size(m, axis));
  }
  const room = before && after ? start(after, axis) - end(before, axis) - size(m, axis) : -1;
  if (before && after && room >= 0 && room / 2 <= MAX_GAP) targets.push(end(before, axis) + room / 2);
  return targets.map((t) => t - start(m, axis));
}

function gapMark(a: Rect, b: Rect, axis: Axis, equal: boolean): GapMark {
  const c = cross(axis);
  const lo = Math.max(start(a, c), start(b, c));
  const hi = Math.min(end(a, c), end(b, c));
  return { axis, from: end(a, axis), to: start(b, axis), at: (lo + hi) / 2, size: Math.round(start(b, axis) - end(a, axis)), equal };
}

/** Separaciones de `m` con sus vecinos inmediatos; las que se repiten en la fila o columna van marcadas, junto con sus pares. */
function spacingMarks(m: Rect, siblings: readonly Rect[], axis: Axis): GapMark[] {
  const { before, after, pairs } = neighborhood(m, siblings, axis, 0);
  const gapBefore = before ? start(m, axis) - end(before, axis) : undefined;
  const gapAfter = after ? start(after, axis) - end(m, axis) : undefined;
  const same = (a: number | undefined, b: number | undefined) => a !== undefined && b !== undefined && Math.abs(a - b) <= 1;
  const marks: GapMark[] = [];
  const repeated = new Set<{ a: Rect; b: Rect; gap: number }>();
  const own = [
    { gap: gapBefore, a: before, b: m, other: gapAfter },
    { gap: gapAfter, a: m, b: after, other: gapBefore },
  ];
  for (const { gap, a, b, other } of own) {
    if (gap === undefined || !a || !b || gap <= 0 || gap > MAX_GAP) continue;
    const twins = pairs.filter((p) => same(p.gap, gap));
    for (const t of twins) repeated.add(t);
    marks.push(gapMark(a, b, axis, twins.length > 0 || same(gap, other)));
  }
  for (const p of repeated) marks.push(gapMark(p.a, p.b, axis, true));
  return marks;
}

/**
 * Guías inteligentes del rectángulo que se mueve: se alinea con los demás (borde con borde y centro
 * con centro; un centro contra un borde ajeno casi nunca es lo que se busca) y se acomoda a la
 * misma distancia que ya hay entre sus vecinos (`siblings`: los que comparten marco).
 * Devuelve el ajuste a aplicar, siempre a píxeles enteros para que lo que se ve al arrastrar sea lo
 * que queda al soltar, las líneas de alineación y las separaciones medidas.
 */
export function computeGuides(moving: Rect, others: readonly Rect[], threshold: number, siblings: readonly Rect[] = others): Guides {
  let bestX: number | null = null;
  let bestY: number | null = null;
  const tryX = (diff: number) => {
    if (Math.abs(diff) <= threshold && (bestX === null || Math.abs(diff) < Math.abs(bestX))) bestX = diff;
  };
  const tryY = (diff: number) => {
    if (Math.abs(diff) <= threshold && (bestY === null || Math.abs(diff) < Math.abs(bestY))) bestY = diff;
  };
  // Primero la alineación: ante un empate con una separación igual, gana.
  for (const o of others) {
    for (const mx of edgesOf(moving, 'h')) for (const ox of edgesOf(o, 'h')) tryX(ox - mx);
    for (const my of edgesOf(moving, 'v')) for (const oy of edgesOf(o, 'v')) tryY(oy - my);
    tryX(middle(o, 'h') - middle(moving, 'h'));
    tryY(middle(o, 'v') - middle(moving, 'v'));
  }
  for (const diff of spacingDiffs(moving, siblings, 'h', threshold)) tryX(diff);
  for (const diff of spacingDiffs(moving, siblings, 'v', threshold)) tryY(diff);

  const snapped = { ...moving, x: Math.round(moving.x + (bestX ?? 0)), y: Math.round(moving.y + (bestY ?? 0)) };
  const lines: GuideLine[] = [];
  // Una guía vertical alinea posiciones en x (eje `h`); una horizontal, en y.
  const line = (axis: Axis) => {
    const near = (v: number, at: number) => Math.abs(v - at) <= EPS;
    const edges = edgesOf(snapped, axis)
      .map((at) => ({ at, aligned: others.filter((o) => edgesOf(o, axis).some((v) => near(v, at))) }))
      .filter((l) => l.aligned.length);
    const mid = middle(snapped, axis);
    const centered = { at: mid, aligned: others.filter((o) => near(middle(o, axis), mid)) };
    // Con los dos bordes alineados, el centro no suma nada.
    const shown = edges.length === 2 ? edges : [...edges, centered].filter((l) => l.aligned.length);
    for (const { at, aligned } of shown) lines.push(guideLine(axis, at, [snapped, ...aligned]));
  };
  line('h');
  line('v');
  const gaps = [...spacingMarks(snapped, siblings, 'h'), ...spacingMarks(snapped, siblings, 'v')];
  return { dx: snapped.x - moving.x, dy: snapped.y - moving.y, lines, gaps };
}

/** Línea que une los bordes alineados en `at` sobre ese eje: cruza a todos los que coinciden, con un margen. */
function guideLine(axis: Axis, at: number, rects: readonly Rect[]): GuideLine {
  const c = cross(axis);
  return { orientation: axis === 'h' ? 'v' : 'h', at, from: Math.min(...rects.map((r) => start(r, c))) - 12, to: Math.max(...rects.map((r) => end(r, c))) + 12 };
}

/** Con qué se compara un componente mientras se lo redimensiona. */
export interface ResizeRefs {
  /** Todo lo demás del lienzo: sus bordes son referencia para alinear el que se arrastra. */
  others: readonly Rect[];
  /** Los que comparten marco: entre ellos se miden y se igualan las distancias. */
  siblings: readonly Rect[];
  /** Los de su misma clase (componentes con componentes, marcos con marcos): se iguala su ancho o alto. */
  peers: readonly Rect[];
}

export interface ResizeGuides {
  rect: Rect;
  lines: GuideLine[];
  gaps: GapMark[];
}

const NO_REFS: ResizeRefs = { others: [], siblings: [], peers: [] };
/** A cuánto del componente se dibuja la medida de su lado, y cuántos de los que miden igual la muestran. */
const SIZE_MARK_OFFSET = 12;
const SIZE_MARK_PEERS = 2;

type Side = 'start' | 'end';

/** Borde que se está arrastrando en ese eje, comparando con el rectángulo de cuando empezó. */
function movingSide(initial: Rect, raw: Rect, axis: Axis): Side | undefined {
  if (Math.abs(end(raw, axis) - end(initial, axis)) > 0.01) return 'end';
  if (Math.abs(start(raw, axis) - start(initial, axis)) > 0.01) return 'start';
  return undefined;
}

/** Dónde tendría que quedar el borde que se arrastra para repetir una distancia de su fila o columna. */
function resizeSpacingTargets(m: Rect, siblings: readonly Rect[], axis: Axis, side: Side, slack: number): number[] {
  const { before, after, pairs } = neighborhood(m, siblings, axis, slack);
  const usable = (gap: number) => gap > 0 && gap <= MAX_GAP;
  const targets: number[] = [];
  if (side === 'end' && after) {
    for (const { gap } of pairs) targets.push(start(after, axis) - gap);
    // La misma distancia de los dos lados.
    if (before && usable(start(m, axis) - end(before, axis))) targets.push(start(after, axis) - (start(m, axis) - end(before, axis)));
  }
  if (side === 'start' && before) {
    for (const { gap } of pairs) targets.push(end(before, axis) + gap);
    if (after && usable(start(after, axis) - end(m, axis))) targets.push(end(before, axis) + (start(after, axis) - end(m, axis)));
  }
  return targets;
}

/** Medida del lado de `r` en ese eje, dibujada apenas afuera del componente. */
function sizeMark(r: Rect, axis: Axis): GapMark {
  return { axis, from: start(r, axis), to: end(r, axis), at: end(r, cross(axis)) + SIZE_MARK_OFFSET, size: Math.round(size(r, axis)), equal: true };
}

/**
 * Guías al redimensionar. `initial` es el rectángulo al empezar y `raw` el que pide el mouse: de la
 * diferencia sale qué bordes se están arrastrando; los otros no se tocan. El borde que se mueve se
 * acomoda (en este orden, ante un empate) al borde de otro componente, al ancho o alto de uno de su
 * misma clase, o a la distancia que ya se repite entre sus vecinos de marco.
 *
 * Siempre devuelve bordes en píxeles enteros y nunca por debajo de `min`. Con `threshold` en 0 solo
 * redondea: es lo que se usa sin Shift, para que el tamaño que se ve sea el que queda al soltar.
 */
export function computeResizeGuides(
  initial: Rect,
  raw: Rect,
  threshold: number,
  refs: ResizeRefs = NO_REFS,
  min: { w: number; h: number } = { w: 1, h: 1 },
): ResizeGuides {
  const guided = threshold > 0;
  const resolve = (axis: Axis) => {
    const side = movingSide(initial, raw, axis);
    if (!side) return { lo: start(initial, axis), hi: end(initial, axis), side };
    const fixed = side === 'end' ? start(initial, axis) : end(initial, axis);
    const edge = side === 'end' ? end(raw, axis) : start(raw, axis);
    const targets: number[] = [];
    if (guided) {
      for (const o of refs.others) targets.push(...edgesOf(o, axis));
      for (const p of refs.peers) targets.push(side === 'end' ? fixed + size(p, axis) : fixed - size(p, axis));
      targets.push(...resizeSpacingTargets(raw, refs.siblings, axis, side, threshold));
    }
    let diff = 0;
    let found = Infinity;
    for (const target of targets) {
      const distance = Math.abs(target - edge);
      if (distance <= threshold && distance < found) {
        found = distance;
        diff = target - edge;
      }
    }
    const least = axis === 'h' ? min.w : min.h;
    const snapped = Math.round(edge + diff);
    return side === 'end' ? { lo: fixed, hi: Math.max(snapped, fixed + least), side } : { lo: Math.min(snapped, fixed - least), hi: fixed, side };
  };
  const h = resolve('h');
  const v = resolve('v');
  const rect: Rect = { x: h.lo, y: v.lo, w: h.hi - h.lo, h: v.hi - v.lo };
  const lines: GuideLine[] = [];
  const gaps: GapMark[] = [];
  if (!guided) return { rect, lines, gaps };

  const middleOf = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  const own = middleOf(rect);
  for (const [axis, side] of [['h', h.side], ['v', v.side]] as const) {
    if (!side) continue;
    const at = side === 'end' ? end(rect, axis) : start(rect, axis);
    const aligned = refs.others.filter((o) => edgesOf(o, axis).some((value) => Math.abs(value - at) <= EPS));
    if (aligned.length) lines.push(guideLine(axis, at, [rect, ...aligned]));
    gaps.push(...spacingMarks(rect, refs.siblings, axis));
    // Mide igual que otros de su clase: se marca en él y en los más cercanos que coinciden.
    const twins = refs.peers
      .filter((p) => Math.abs(size(p, axis) - size(rect, axis)) <= EPS)
      .map((p) => ({ p, away: Math.hypot(middleOf(p).x - own.x, middleOf(p).y - own.y) }))
      .sort((a, b) => a.away - b.away)
      .slice(0, SIZE_MARK_PEERS);
    if (twins.length) gaps.push(sizeMark(rect, axis), ...twins.map(({ p }) => sizeMark(p, axis)));
  }
  return { rect, lines, gaps };
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
