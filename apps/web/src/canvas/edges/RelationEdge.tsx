import { memo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import {
  EdgeLabelRenderer,
  Position,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useInternalNode,
  useReactFlow,
  useStore,
  type EdgeProps,
  type InternalNode,
} from '@xyflow/react';
import { STATUS_MARK, edgeLabelParts, edgeLabelSizes, edgeStyleWith, type EdgeAnchor, type EdgeLabelBlock, type EdgeStyle } from '@aegon/core';
import { useUi } from '../../store/ui.ts';
import { useWorkspace } from '../../store/workspace.ts';
import { reconnect } from '../../lib/actions.ts';
import type { RelationFlowEdge } from '../derive.ts';
import { useLod } from '../lod.ts';
import {
  CURVATURE,
  edgeEnds,
  longestSegment,
  nearestAnchor,
  pointOnEdge,
  routedPath,
  routedPointAlong,
  routedPointAt,
  segmentDistance,
  type EdgeEnds,
  type Pt,
  type Rect,
} from './geometry.ts';

function rectOf(node: InternalNode): Rect {
  const { x, y } = node.internals.positionAbsolute;
  return {
    x,
    y,
    w: node.measured.width ?? node.width ?? 0,
    h: node.measured.height ?? node.height ?? 0,
  };
}

const centerOf = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/**
 * Corrimiento de un recorrido a mano mientras sus dos extremos se mueven juntos (se arrastra el
 * marco que los contiene, o los dos seleccionados): los puntos los acompañan en vivo. Si se mueve
 * uno solo, el recorrido queda donde estaba.
 */
function followShift(anchor: readonly [number, number, number, number], s: Rect, t: Rect): Pt | null {
  const dx = s.x - anchor[0];
  const dy = s.y - anchor[1];
  if (!dx && !dy) return null;
  return Math.abs(t.x - anchor[2] - dx) < 0.01 && Math.abs(t.y - anchor[3] - dy) < 0.01 ? { x: dx, y: dy } : null;
}

type End = 'from' | 'to';

/** Cuánto se mete en la línea el punto de una punta, en píxeles de pantalla. */
const END_INSET = 18;

/**
 * Nodo sobre el que está la punta que se arrastra, si es otro al que la flecha se puede mudar. Cerca
 * de su propio nodo (`slack`) no hay destino: se está eligiendo el lado. Tampoco cuentan el otro
 * extremo, los grupos ni los marcos que contienen a cualquiera de los dos extremos (se los atraviesa
 * para llegar a cualquier lado). Entre varios, el más chico: lo de adentro antes que su marco.
 */
function nodeUnder(
  rf: ReturnType<typeof useReactFlow>,
  p: Pt,
  { ownId, otherId, own, other, slack }: { ownId: string; otherId: string; own: Rect; other: Rect; slack: number },
): string | null {
  const inside = (r: Rect, q: Pt, pad = 0) => q.x >= r.x - pad && q.x <= r.x + r.w + pad && q.y >= r.y - pad && q.y <= r.y + r.h + pad;
  const holds = (outer: Rect, inner: Rect) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
  if (inside(own, p, slack)) return null;
  let best: { id: string; area: number } | null = null;
  for (const n of rf.getNodes()) {
    if (n.id === ownId || n.id === otherId || n.type === 'boundary' || n.type === 'group') continue;
    const internal = rf.getInternalNode(n.id);
    if (!internal) continue;
    const r = rectOf(internal);
    if (!inside(r, p) || holds(r, own) || holds(r, other)) continue;
    if (!best || r.w * r.h < best.area) best = { id: n.id, area: r.w * r.h };
  }
  return best?.id ?? null;
}

let connectTarget: Element | null = null;
/** Resalta el nodo al que se mudaría la flecha (un atributo en el DOM, sin re-renderizar nodos). */
function markConnectTarget(id: string | null) {
  const el = id ? document.querySelector(`.canvas-shell .react-flow__node[data-id="${CSS.escape(id)}"]`) : null;
  if (el === connectTarget) return;
  connectTarget?.removeAttribute('data-connect-target');
  el?.setAttribute('data-connect-target', '');
  connectTarget = el;
}

/** Tramos más cortos que esto no ofrecen un punto para agregar: no hay lugar donde agarrarlo. */
const MIN_SEGMENT = 44;

/**
 * Ida y vuelta: a qué altura del trazo va la etiqueta de cada sentido cuando no las ubicó el lienzo
 * (`[vuelta, ida]`: cada una del lado de la punta a la que apunta), y el aire que tiene que quedar
 * entre las dos para dibujarlas separadas. Si no entran, van apiladas en una sola etiqueta.
 */
const WAY_SPOTS: readonly [number, number] = [0.3, 0.7];
const WAY_AIR = 8;

/** Hasta dónde se puede llevar una etiqueta sobre su flecha: no llega a taparle las puntas. */
const LABEL_RANGE: readonly [number, number] = [0.06, 0.94];
/** Cuánto hay que mover el mouse para que sea un arrastre y no un click (que selecciona la flecha). */
const DRAG_START = 4;

let probe: SVGPathElement | null = null;
let probed = '';
/**
 * Punto a una fracción del largo de un trazo ya dibujado. Es para los escalonados, que no tienen una
 * fórmula propia como las curvas y las rectas: se mide el mismo trazo SVG que se ve.
 */
function pathPointAt(d: string, fraction: number): Pt | null {
  if (typeof document === 'undefined') return null;
  try {
    probe ??= document.createElementNS('http://www.w3.org/2000/svg', 'path');
    if (probed !== d) {
      probe.setAttribute('d', d);
      probed = d;
    }
    const length = probe.getTotalLength();
    if (!length) return null;
    const p = probe.getPointAtLength(length * Math.min(1, Math.max(0, fraction)));
    return { x: p.x, y: p.y };
  } catch {
    return null;
  }
}

/** Un sentido de la relación dentro de la etiqueta: la flechita que dice hacia dónde va y su texto. */
function WayBlock({ block, angle, mark, testId }: { block: EdgeLabelBlock; angle: number; mark?: string; testId?: string }) {
  return (
    <div className="c4-edge-way" data-testid={testId}>
      <span className="c4-edge-dir" style={{ transform: `rotate(${angle}deg)` }} data-angle={Math.round(angle)} aria-hidden>
        <ArrowRight size={10} strokeWidth={2.75} />
      </span>
      <div className="c4-edge-way__text">
        {mark ? <span className="c4-edge-mark">{mark}</span> : null}
        {block.label ? <span>{block.label}</span> : null}
        {block.techLines.map((line, i) => (
          <span key={i} className="tech">
            [{line}]
          </span>
        ))}
      </div>
    </div>
  );
}

function RelationEdgeImpl({ id, source, target, data, selected }: EdgeProps<RelationFlowEdge>) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  const lod = useLod();
  const rf = useReactFlow();
  // Recorrido mientras se arrastra uno de sus puntos (todavía no está en el modelo).
  const [draft, setDraft] = useState<Pt[] | null>(null);
  // Punta que se está arrastrando: por el borde de su nodo (`anchor`) o hacia otro nodo (`node`).
  const [draftEnd, setDraftEnd] = useState<{ which: End; anchor?: EdgeAnchor; node?: string } | null>(null);
  // Etiqueta que se está arrastrando por el trazo: a qué altura va (y la de la vuelta, si van separadas).
  const [placing, setPlacing] = useState<{ main?: number; back?: number } | null>(null);
  if (!s || !t || !data) return null;

  // Mientras la punta está sobre otro nodo, la flecha ya se dibuja hasta ese.
  const hovered = draftEnd?.node ? rf.getInternalNode(draftEnd.node) : undefined;
  const sr = rectOf(draftEnd?.which === 'from' && hovered ? hovered : s);
  const tr = rectOf(draftEnd?.which === 'to' && hovered ? hovered : t);
  const stored: Pt[] = data.points ? [...data.points] : [];
  const shift = stored.length && data.placedAt ? followShift(data.placedAt, sr, tr) : null;
  // Yendo a otro nodo, el recorrido a mano no cuenta: era para el destino anterior.
  const points: Pt[] = draftEnd?.node ? [] : (draft ?? (shift ? stored.map((p) => ({ x: p.x + shift.x, y: p.y + shift.y })) : stored));
  const fromAt = draftEnd?.which === 'from' ? draftEnd.anchor : data.fromAt;
  const toAt = draftEnd?.which === 'to' ? draftEnd.anchor : data.toAt;
  const routed = points.length > 0;

  const params: EdgeEnds = edgeEnds(sr, tr, { from: fromAt, to: toAt, points });
  let path: string;
  let labelX: number;
  let labelY: number;
  // Puntos del recorrido de punta a punta (con los extremos), solo si está acomodado a mano.
  let chain: Pt[] | null = null;
  // Tramo que lleva la etiqueta: el más largo, así no queda encima de un punto.
  let labelSegment = -1;
  if (routed) {
    chain = [{ x: params.sourceX, y: params.sourceY }, ...points, { x: params.targetX, y: params.targetY }];
    path = routedPath(data.shape, chain);
    labelSegment = longestSegment(chain);
    const mid = routedPointAt(data.shape, chain, labelSegment, 0.5);
    labelX = mid.x;
    labelY = mid.y;
  } else {
    const [d, midX, midY] =
      data.shape === 'straight'
        ? getStraightPath(params)
        : data.shape === 'step'
          ? getSmoothStepPath({ ...params, borderRadius: 14 })
          : getBezierPath({ ...params, curvature: CURVATURE });
    path = d;
    // La etiqueta va al medio salvo que ahí tape un nodo u otra etiqueta (ver `placeEdgeLabels`).
    const spot = data.labelT !== undefined ? pointOnEdge(data.shape, params, data.labelT) : null;
    labelX = spot?.x ?? midX;
    labelY = spot?.y ?? midY;
  }

  const active = selected || !!data.flow;
  const parts = edgeLabelParts(data);
  const { label, tech, techLines, back } = parts;
  const status = data.implied ? undefined : data.status;
  const mark = status && data.statusMark ? STATUS_MARK[status] : '';

  // --- Dónde va cada etiqueta --------------------------------------------------------------------
  // Punto del trazo a una fracción de su largo, y hacia dónde avanza ahí (en grados, de origen a
  // destino): la flechita de la ida apunta para ese lado y la de la vuelta, para el contrario.
  const along = (u: number): Pt | null => (chain ? routedPointAlong(data.shape, chain, u) : (pointOnEdge(data.shape, params, u) ?? pathPointAt(path, u)));
  // Lo que se movió a mano (o se está arrastrando ahora) manda sobre lo que elige el lienzo.
  const placed = placing ?? { main: data.labelAt, back: data.backLabelAt };
  const heading = (u: number): number => {
    const a = along(Math.max(0, u - 0.03));
    const b = along(Math.min(1, u + 0.03));
    const from = a ?? { x: params.sourceX, y: params.sourceY };
    const to = b ?? { x: params.targetX, y: params.targetY };
    return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
  };
  const hasMain = !!(label || techLines.length || mark);
  let split: { main: Pt; back: Pt; mainAngle: number; backAngle: number; mainT: number; backT: number } | null = null;
  if (back && hasMain) {
    const [autoBack, autoMain] = data.labelTs ?? WAY_SPOTS;
    const mainT = placed.main ?? autoMain;
    const backT = placed.back ?? autoBack;
    const mainAt = along(mainT);
    const backAt = along(backT);
    const sizes = edgeLabelSizes(data);
    const fit =
      !!mainAt &&
      !!backAt &&
      !!sizes.main &&
      !!sizes.back &&
      (Math.abs(mainAt.x - backAt.x) >= (sizes.main.width + sizes.back.width) / 2 + WAY_AIR ||
        Math.abs(mainAt.y - backAt.y) >= (sizes.main.height + sizes.back.height) / 2 + WAY_AIR);
    // Separadas a mano se quedan separadas; las que ubicó el lienzo ya se sabe que entran; el resto
    // se separa solo si no se pisan.
    const apart = !!mainAt && !!backAt && (placed.back !== undefined || (placed.main === undefined && !!data.labelTs) || fit);
    if (apart) split = { main: mainAt!, back: backAt!, mainAngle: heading(mainT), backAngle: heading(backT) + 180, mainT, backT };
  }
  // Una sola (o las dos apiladas): donde se la dejó a mano o, si no, donde la ubica el lienzo.
  const single: Pt = (!split && placed.main !== undefined ? along(placed.main) : null) ?? { x: labelX, y: labelY };
  const stackAngle = back && !split ? heading(placed.main ?? (chain ? 0.5 : (data.labelT ?? 0.5))) : 0;
  const marker = active
    ? 'url(#aegon-arrow-active)'
    : status
      ? `url(#aegon-arrow-${status})`
      : data.network
        ? 'url(#aegon-arrow-network)'
        : 'url(#aegon-arrow)';

  // --- Acomodar el recorrido a mano ---------------------------------------------------------------
  const routeKey = data.routeKey;
  const editable = selected && !!routeKey && lod !== 'far';

  const commitStyle = (patch: { [K in keyof EdgeStyle]?: EdgeStyle[K] | null }, label: string, key = routeKey) => {
    const viewId = useUi.getState().activeViewId;
    const { model, dispatch } = useWorkspace.getState();
    const view = viewId ? model.views[viewId] : undefined;
    if (!view || !key) return;
    dispatch({ type: 'view.edge', view: view.id, relation: key, style: edgeStyleWith(view, key, patch) }, { label });
  };

  // --- Mover la etiqueta a lo largo de la flecha -------------------------------------------------
  const labelKey = data.labelKey;
  const movable = !!labelKey && lod !== 'far';
  const moved = data.labelAt !== undefined || data.backLabelAt !== undefined;
  /** Altura del trazo (0 a 1) más cercana a un punto del lienzo: ahí va la etiqueta que se arrastra. */
  const nearestOnPath = (p: Pt): number => {
    const distance = (u: number) => {
      const q = along(u);
      return q ? Math.hypot(q.x - p.x, q.y - p.y) : Infinity;
    };
    const step = 0.025;
    let best = 0.5;
    let least = Infinity;
    for (let u = LABEL_RANGE[0]; u <= LABEL_RANGE[1] + 1e-9; u += step) {
      const d = distance(u);
      if (d < least) {
        least = d;
        best = u;
      }
    }
    // Entre los dos vecinos del mejor, se afina: así se desliza sin saltos.
    let lo = Math.max(LABEL_RANGE[0], best - step);
    let hi = Math.min(LABEL_RANGE[1], best + step);
    for (let i = 0; i < 14; i++) {
      const a = lo + (hi - lo) / 3;
      const b = hi - (hi - lo) / 3;
      if (distance(a) <= distance(b)) hi = b;
      else lo = a;
    }
    return Math.round(((lo + hi) / 2) * 1000) / 1000;
  };
  /** Arrastra una etiqueta por su flecha. Un click sin mover sigue seleccionando la flecha. */
  const beginLabelDrag = (e: ReactPointerEvent, which: 'main' | 'back') => {
    if (e.button !== 0 || !movable) return;
    const start = { x: e.clientX, y: e.clientY };
    // Separadas, se anotan las dos: la que no se toca no se junta con la otra cuando le pasa cerca.
    const base: { main?: number; back?: number } = split ? { main: split.mainT, back: split.backT } : {};
    let current = base;
    let dragging = false;
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_START) return;
      dragging = true;
      current = { ...base, [which]: nearestOnPath(rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY })) };
      setPlacing(current);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setPlacing(null);
      if (!dragging) return;
      // El click que cierra el arrastre no selecciona la flecha: si no, sus puntos aparecerían encima
      // de la etiqueta que se acaba de acomodar.
      const swallow = (ev: MouseEvent) => ev.stopPropagation();
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, true), 0);
      commitStyle({ labelAt: current.main ?? null, backLabelAt: current.back ?? null }, 'Mover la etiqueta', labelKey);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const commitRoute = (next: Pt[]) => commitStyle({ points: next.length ? next : null }, next.length ? 'Acomodar la flecha' : 'Enderezar la flecha');

  /**
   * Arrastra una punta. Cerca de su nodo se desliza por el borde: elige de qué lado toca y a qué
   * altura. Soltada sobre otro nodo, la flecha se muda a ese (la relación cambia de extremo).
   */
  const beginEndDrag = (e: ReactPointerEvent, which: End) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const rect = which === 'from' ? sr : tr;
    const otherRect = which === 'from' ? tr : sr;
    const ownId = which === 'from' ? source : target;
    const otherId = which === 'from' ? target : source;
    // Una relación proyectada se dibuja entre instancias que no son sus extremos: no se muda desde acá.
    const movable = !data.projected && !data.implied;
    // Hacia dónde va la flecha desde esta punta: en línea con eso, el primer tramo sale derecho.
    const other = which === 'from' ? (toAt ? { x: params.targetX, y: params.targetY } : centerOf(tr)) : fromAt ? { x: params.sourceX, y: params.sourceY } : centerOf(sr);
    const toward = (which === 'from' ? points[0] : points[points.length - 1]) ?? other;
    let anchor: EdgeAnchor | null = null;
    let over: string | null = null;
    const move = (ev: PointerEvent) => {
      const p = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      over = movable ? nodeUnder(rf, p, { ownId, otherId, own: rect, other: otherRect, slack: 28 / rf.getZoom() }) : null;
      markConnectTarget(over);
      if (over) {
        anchor = null;
        setDraftEnd({ which, node: over });
      } else {
        anchor = nearestAnchor(rect, p, toward, 7 / rf.getZoom());
        setDraftEnd({ which, anchor });
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      markConnectTarget(null);
      setDraftEnd(null);
      if (over && routeKey) reconnect(routeKey, which, over);
      else if (anchor) commitStyle({ [which]: anchor }, 'Acomodar la punta de la flecha');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Arrastra el punto `index` de `base` (uno que ya estaba o uno recién insertado ahí). */
  const beginDrag = (e: ReactPointerEvent, index: number, base: Pt[]) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const sc = centerOf(sr);
    const tc = centerOf(tr);
    const before = index > 0 ? base[index - 1]! : sc;
    const after = index < base.length - 1 ? base[index + 1]! : tc;
    let current = base;
    let moved = false;
    const move = (ev: PointerEvent) => {
      moved = true;
      const raw = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      // En línea con el punto anterior o el siguiente (o con el centro del nodo): tramos derechos.
      const near = 6 / rf.getZoom();
      const snap = (v: number, a: number, b: number) => (Math.abs(v - a) <= near ? a : Math.abs(v - b) <= near ? b : v);
      const p = { x: Math.round(snap(raw.x, before.x, after.x)), y: Math.round(snap(raw.y, before.y, after.y)) };
      current = base.map((q, i) => (i === index ? p : q));
      setDraft(current);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDraft(null);
      if (!moved) return;
      // Un punto que quedó en línea con sus vecinos no dobla nada: se quita (así se endereza).
      const p = current[index]!;
      const straight = segmentDistance(p, before, after) <= 5 / rf.getZoom();
      commitRoute(straight ? current.filter((_, i) => i !== index) : current);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Las puntas se agarran un poco adentro de la línea, no sobre el borde del nodo: ahí está el punto
  // del nodo desde el que se arrastra una conexión nueva, y no se tienen que pisar.
  const sourceEnd: Pt = { x: params.sourceX, y: params.sourceY };
  const targetEnd: Pt = { x: params.targetX, y: params.targetY };
  /** Hacia dónde sale el trazo desde una punta: hacia el punto siguiente, o perpendicular al lado si es curva o escalón. */
  const leaving = (end: Pt, next: Pt, side: Position): Pt => {
    if (!chain && data.shape !== 'straight') {
      return side === Position.Top ? { x: 0, y: -1 } : side === Position.Bottom ? { x: 0, y: 1 } : side === Position.Left ? { x: -1, y: 0 } : { x: 1, y: 0 };
    }
    const d = Math.hypot(next.x - end.x, next.y - end.y) || 1;
    return { x: (next.x - end.x) / d, y: (next.y - end.y) / d };
  };

  // Dónde se ofrece agregar un punto: al medio de cada tramo del recorrido o, si la flecha todavía
  // va sola, a un tercio y dos tercios (el medio es de la etiqueta).
  const lerp = (u: number): Pt => ({ x: params.sourceX + (params.targetX - params.sourceX) * u, y: params.sourceY + (params.targetY - params.sourceY) * u });
  const hasLabel = !!(label || tech || mark || back);
  const adds: { at: Pt; index: number }[] = !editable
    ? []
    : chain
      ? chain.flatMap((a, i) => {
          const b = chain[i + 1];
          if (!b || Math.hypot(b.x - a.x, b.y - a.y) < MIN_SEGMENT) return [];
          // En el tramo de la etiqueta, a un cuarto: el medio es de ella.
          return [{ at: routedPointAt(data.shape, chain, i, hasLabel && i === labelSegment ? 0.22 : 0.5), index: i }];
        })
      : // Con una etiqueta por sentido, las etiquetas ocupan esos lugares y queda libre el medio.
        (split ? [0.5] : [0.3, 0.7]).map((u) => ({ at: pointOnEdge(data.shape, params, u) ?? lerp(u), index: 0 }));

  return (
    <>
      <path
        d={path}
        className="c4-edge-path"
        data-implied={data.implied || undefined}
        data-network={data.network || undefined}
        data-projected={data.projected || undefined}
        data-flow={data.flow ?? undefined}
        data-status={status}
        data-routed={routed || undefined}
        data-anchored={fromAt || toAt ? [fromAt ? 'from' : '', toAt ? 'to' : ''].join(' ').trim() : undefined}
        data-new={data.fresh || undefined}
        pathLength={data.fresh ? 1 : undefined}
        markerEnd={marker}
        markerStart={data.bidirectional ? marker : undefined}
      />
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={18}
        className="react-flow__edge-interaction"
      />
      {lod !== 'far' && (label || tech || mark || back) ? (
        <EdgeLabelRenderer>
          {(split
            ? [
                { key: 'to', at: split.main, which: 'main' as const, testId: `edge-label-${id}` },
                { key: 'from', at: split.back, which: 'back' as const, testId: `edge-label-back-${id}` },
              ]
            : [{ key: 'both', at: single, which: 'main' as const, testId: `edge-label-${id}` }]
          ).map(({ key, at, which, testId }) => (
            <div
              key={key}
              className="c4-edge-label nodrag nopan"
              data-implied={data.implied || undefined}
              data-network={data.network || undefined}
              data-status={status}
              data-selected={selected || undefined}
              data-flow={data.flow ?? undefined}
              data-edge-label={id}
              data-way={back ? key : undefined}
              data-movable={movable || undefined}
              data-placed={moved || undefined}
              data-moving={placing ? '' : undefined}
              data-testid={testId}
              title={movable ? `Arrastrá para moverla a lo largo de la flecha${moved ? '. Doble click la devuelve a su lugar' : ''}` : undefined}
              style={{ transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)` }}
              onPointerDown={(e) => beginLabelDrag(e, which)}
              onDoubleClick={(e) => {
                if (!movable || !moved) return;
                e.stopPropagation();
                commitStyle({ labelAt: null, backLabelAt: null }, 'Etiqueta en su lugar', labelKey);
              }}
            >
              {!back ? (
                <>
                  {mark ? <span className="c4-edge-mark">{mark}</span> : null}
                  {label ? <span>{label}</span> : null}
                  {techLines.map((line, i) => (
                    <span key={i} className="tech">
                      [{line}]
                    </span>
                  ))}
                </>
              ) : split ? (
                key === 'to' ? (
                  <WayBlock block={parts} angle={split.mainAngle} mark={mark} />
                ) : (
                  <WayBlock block={back} angle={split.backAngle} />
                )
              ) : (
                <>
                  {hasMain ? <WayBlock block={parts} angle={stackAngle} mark={mark} /> : null}
                  <WayBlock block={back} angle={stackAngle + 180} testId={`edge-label-back-${id}`} />
                </>
              )}
            </div>
          ))}
        </EdgeLabelRenderer>
      ) : null}
      {editable ? (
        <EdgeLabelRenderer>
          <RouteHandles
            edgeId={id}
            points={points}
            adds={adds}
            ends={[
              { which: 'from', at: sourceEnd, along: leaving(sourceEnd, chain ? chain[1]! : targetEnd, params.sourcePosition), fixed: !!fromAt },
              { which: 'to', at: targetEnd, along: leaving(targetEnd, chain ? chain[chain.length - 2]! : sourceEnd, params.targetPosition), fixed: !!toAt },
            ]}
            onEnd={beginEndDrag}
            onEndReset={(which) => commitStyle({ [which]: null }, 'Punta automática')}
            onMove={(e, index) => beginDrag(e, index, stored)}
            onAdd={(e, index, at) => beginDrag(e, index, [...stored.slice(0, index), at, ...stored.slice(index)])}
            onRemove={(index) => commitRoute(stored.filter((_, i) => i !== index))}
          />
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const RelationEdge = memo(RelationEdgeImpl);

/**
 * Puntos de una flecha seleccionada: los llenos son por donde pasa (se arrastran; doble click los
 * quita) y los huecos, al medio de cada tramo, agregan uno nuevo al arrastrarlos. Los de las puntas
 * (cuadrados) se deslizan por el borde del nodo para elegir de qué lado toca; doble click devuelve
 * esa punta al lugar que elige el lienzo. Mantienen su tamaño en pantalla con cualquier zoom.
 */
function RouteHandles({
  edgeId,
  points,
  adds,
  ends,
  onEnd,
  onEndReset,
  onMove,
  onAdd,
  onRemove,
}: {
  edgeId: string;
  points: readonly Pt[];
  adds: readonly { at: Pt; index: number }[];
  ends: readonly { which: End; at: Pt; along: Pt; fixed: boolean }[];
  onEnd: (e: ReactPointerEvent, which: End) => void;
  onEndReset: (which: End) => void;
  onMove: (e: ReactPointerEvent, index: number) => void;
  onAdd: (e: ReactPointerEvent, index: number, at: Pt) => void;
  onRemove: (index: number) => void;
}) {
  const zoom = useStore((s) => s.transform[2]);
  const at = (p: Pt) => ({ transform: `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) scale(${1 / zoom})` });
  return (
    <>
      {ends.map(({ which, at: end, along, fixed }) => {
        const p = { x: end.x + (along.x * END_INSET) / zoom, y: end.y + (along.y * END_INSET) / zoom };
        return (
          <div
            key={which}
            className="c4-edge-point nodrag nopan"
            data-end={which}
            data-fixed={fixed || undefined}
            title={`Arrastrá por el borde para elegir de qué lado toca, o soltala sobre otro componente para llevar la flecha ahí${fixed ? '. Doble click la deja automática' : ''}`}
            style={at(p)}
            onPointerDown={(e) => onEnd(e, which)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (fixed) onEndReset(which);
            }}
            data-testid={`edge-end-${edgeId}-${which}`}
          />
        );
      })}
      {adds.map(({ at: p, index }, i) => (
        <div
          key={`a${i}`}
          className="c4-edge-point nodrag nopan"
          data-add
          title="Arrastrá para que la flecha pase por otro lado"
          style={at(p)}
          onPointerDown={(e) => onAdd(e, index, { x: Math.round(p.x), y: Math.round(p.y) })}
          onDoubleClick={(e) => e.stopPropagation()}
          data-testid={`edge-add-${edgeId}-${i}`}
        />
      ))}
      {points.map((p, i) => (
        <div
          key={`p${i}`}
          className="c4-edge-point nodrag nopan"
          title="Arrastrá para mover este punto; doble click lo quita"
          style={at(p)}
          onPointerDown={(e) => onMove(e, i)}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onRemove(i);
          }}
          data-testid={`edge-point-${edgeId}-${i}`}
        />
      ))}
    </>
  );
}

/** Marcadores de flecha compartidos (definidos una vez en el lienzo). */
export function EdgeMarkers() {
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden>
      <defs>
        <marker
          id="aegon-arrow"
          viewBox="0 0 12 12"
          refX="10"
          refY="6"
          markerWidth="12"
          markerHeight="12"
          markerUnits="userSpaceOnUse"
          orient="auto-start-reverse"
        >
          <path d="M2 2 L10 6 L2 10 z" className="c4-arrow" />
        </marker>
        <marker
          id="aegon-arrow-active"
          viewBox="0 0 12 12"
          refX="10"
          refY="6"
          markerWidth="12"
          markerHeight="12"
          markerUnits="userSpaceOnUse"
          orient="auto-start-reverse"
        >
          <path d="M2 2 L10 6 L2 10 z" className="c4-arrow-active" />
        </marker>
        <marker
          id="aegon-arrow-network"
          viewBox="0 0 12 12"
          refX="10"
          refY="6"
          markerWidth="12"
          markerHeight="12"
          markerUnits="userSpaceOnUse"
          orient="auto-start-reverse"
        >
          <path d="M2 2 L10 6 L2 10 z" className="c4-arrow-network" />
        </marker>
        {(['planned', 'changing', 'deprecated', 'retired'] as const).map((status) => (
          <marker
            key={status}
            id={`aegon-arrow-${status}`}
            viewBox="0 0 12 12"
            refX="10"
            refY="6"
            markerWidth="12"
            markerHeight="12"
            markerUnits="userSpaceOnUse"
            orient="auto-start-reverse"
          >
            <path d="M2 2 L10 6 L2 10 z" className="c4-arrow-status" data-status={status} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}
