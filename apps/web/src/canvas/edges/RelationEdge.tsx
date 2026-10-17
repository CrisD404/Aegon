import { memo } from 'react';
import {
  EdgeLabelRenderer,
  Position,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useInternalNode,
  type EdgeProps,
  type InternalNode,
} from '@xyflow/react';
import { findProtocol } from '@aegon/core';
import type { RelationFlowEdge } from '../derive.ts';
import { useLod } from '../lod.ts';

type Pt = { x: number; y: number };

function rectOf(node: InternalNode) {
  const { x, y } = node.internals.positionAbsolute;
  const w = node.measured.width ?? node.width ?? 0;
  const h = node.measured.height ?? node.height ?? 0;
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

/** Punto donde la recta entre centros corta el borde del nodo (edges "flotantes"). */
function intersection(node: InternalNode, toward: Pt, gap = 3): { point: Pt; side: Position } {
  const r = rectOf(node);
  const dx = toward.x - r.cx;
  const dy = toward.y - r.cy;
  const hw = r.w / 2 + gap;
  const hh = r.h / 2 + gap;
  if (dx === 0 && dy === 0) return { point: { x: r.cx, y: r.y }, side: Position.Top };
  const scale = Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
  const point = { x: r.cx + dx * scale, y: r.cy + dy * scale };
  const onVertical = Math.abs(Math.abs(point.x - r.cx) - hw) < 0.5;
  const side = onVertical ? (dx > 0 ? Position.Right : Position.Left) : dy > 0 ? Position.Bottom : Position.Top;
  return { point, side };
}

function RelationEdgeImpl({ id, source, target, data, selected }: EdgeProps<RelationFlowEdge>) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  const lod = useLod();
  if (!s || !t || !data) return null;

  const sr = rectOf(s);
  const tr = rectOf(t);
  const a = intersection(s, { x: tr.cx, y: tr.cy });
  const b = intersection(t, { x: sr.cx, y: sr.cy }, 6);

  const params = {
    sourceX: a.point.x,
    sourceY: a.point.y,
    sourcePosition: a.side,
    targetX: b.point.x,
    targetY: b.point.y,
    targetPosition: b.side,
  };
  const [path, labelX, labelY] =
    data.shape === 'straight'
      ? getStraightPath(params)
      : data.shape === 'step'
        ? getSmoothStepPath({ ...params, borderRadius: 14 })
        : getBezierPath({ ...params, curvature: 0.3 });

  const rel = data.relations[0]!;
  const active = selected || !!data.flow;
  const label = data.implied
    ? data.relations.length > 1
      ? `${data.relations.length} relaciones`
      : (rel.label ?? 'Relación implícita')
    : rel.label;
  const protocols = data.implied ? [] : (rel.protocols ?? []);
  const marker = active ? 'url(#aegon-arrow-active)' : 'url(#aegon-arrow)';

  return (
    <>
      <path
        d={path}
        className="c4-edge-path"
        data-implied={data.implied || undefined}
        data-flow={data.flow ?? undefined}
        data-status={data.implied ? undefined : rel.status}
        data-new={data.fresh || undefined}
        pathLength={data.fresh ? 1 : undefined}
        markerEnd={marker}
        markerStart={data.bidirectional ? marker : undefined}
      />
      <path d={path} fill="none" stroke="transparent" strokeWidth={18} className="react-flow__edge-interaction" />
      {lod !== 'far' && (label || protocols.length) ? (
        <EdgeLabelRenderer>
          <div
            className="c4-edge-label nodrag nopan"
            data-implied={data.implied || undefined}
            data-selected={selected || undefined}
            data-flow={data.flow ?? undefined}
            data-testid={`edge-label-${id}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {label ? <span>{label}</span> : null}
            {protocols.length ? <span className="tech">[{protocols.map((x) => findProtocol(x)?.name ?? x).join(', ')}]</span> : null}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const RelationEdge = memo(RelationEdgeImpl);

/** Marcadores de flecha compartidos (definidos una vez en el lienzo). */
export function EdgeMarkers() {
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden>
      <defs>
        <marker id="aegon-arrow" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
          <path d="M2 2 L10 6 L2 10 z" className="c4-arrow" />
        </marker>
        <marker id="aegon-arrow-active" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
          <path d="M2 2 L10 6 L2 10 z" className="c4-arrow-active" />
        </marker>
      </defs>
    </svg>
  );
}
