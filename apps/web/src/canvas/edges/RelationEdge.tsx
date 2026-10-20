import { memo } from 'react';
import {
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useInternalNode,
  type EdgeProps,
  type InternalNode,
} from '@xyflow/react';
import { edgeLabelParts } from '@aegon/core';
import type { RelationFlowEdge } from '../derive.ts';
import { useLod } from '../lod.ts';
import { CURVATURE, floatingEnds, pointOnEdge, type Rect } from './geometry.ts';

function rectOf(node: InternalNode): Rect {
  const { x, y } = node.internals.positionAbsolute;
  return {
    x,
    y,
    w: node.measured.width ?? node.width ?? 0,
    h: node.measured.height ?? node.height ?? 0,
  };
}

function RelationEdgeImpl({ id, source, target, data, selected }: EdgeProps<RelationFlowEdge>) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  const lod = useLod();
  if (!s || !t || !data) return null;

  const params = floatingEnds(rectOf(s), rectOf(t));
  const [path, midX, midY] =
    data.shape === 'straight'
      ? getStraightPath(params)
      : data.shape === 'step'
        ? getSmoothStepPath({ ...params, borderRadius: 14 })
        : getBezierPath({ ...params, curvature: CURVATURE });
  // La etiqueta va al medio salvo que ahí tape un nodo u otra etiqueta (ver `placeEdgeLabels`).
  const spot = data.labelT !== undefined ? pointOnEdge(data.shape, params, data.labelT) : null;
  const labelX = spot?.x ?? midX;
  const labelY = spot?.y ?? midY;

  const rel = data.relations[0]!;
  const active = selected || !!data.flow;
  const { label, tech } = edgeLabelParts(data);
  const marker = active
    ? 'url(#aegon-arrow-active)'
    : data.network
      ? 'url(#aegon-arrow-network)'
      : 'url(#aegon-arrow)';

  return (
    <>
      <path
        d={path}
        className="c4-edge-path"
        data-implied={data.implied || undefined}
        data-network={data.network || undefined}
        data-projected={data.projected || undefined}
        data-flow={data.flow ?? undefined}
        data-status={data.implied ? undefined : rel.status}
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
      {lod !== 'far' && (label || tech) ? (
        <EdgeLabelRenderer>
          <div
            className="c4-edge-label nodrag nopan"
            data-implied={data.implied || undefined}
            data-network={data.network || undefined}
            data-selected={selected || undefined}
            data-flow={data.flow ?? undefined}
            data-testid={`edge-label-${id}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {label ? <span>{label}</span> : null}
            {tech ? <span className="tech">[{tech}]</span> : null}
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
      </defs>
    </svg>
  );
}
