import { useEffect, useMemo } from 'react';
import { STATUS_HINT, STATUS_LABEL, type Status } from '@aegon/core';
import { useUi } from '../store/ui.ts';
import { plural } from '../ui/primitives.tsx';
import { StatusDot } from '../ui/StatusPicker.tsx';
import type { AegonNode, RelationFlowEdge } from './derive.ts';

const ORDER = ['planned', 'changing', 'deprecated', 'retired'] as const satisfies readonly Status[];

/**
 * Leyenda de estados del lienzo: qué hay nuevo, qué se modifica y qué se da de baja, y cuánto de
 * cada cosa. Aparece sola cuando hay algo marcado. Un click en un estado deja a la vista solo eso
 * (el resto se atenúa); otro click lo suelta.
 */
export function StatusLegend({ nodes, edges }: { nodes: readonly AegonNode[]; edges: readonly RelationFlowEdge[] }) {
  const lens = useUi((s) => s.statusLens);
  const setLens = useUi((s) => s.setStatusLens);
  const counts = useMemo(() => {
    const by = new Map<Status, { elements: number; relations: number }>();
    const at = (status: Status) => {
      let entry = by.get(status);
      if (!entry) by.set(status, (entry = { elements: 0, relations: 0 }));
      return entry;
    };
    for (const n of nodes) if (n.type !== 'boundary' && n.data.status) at(n.data.status).elements++;
    for (const e of edges) if (e.data?.status && !e.data.implied) at(e.data.status).relations++;
    return ORDER.flatMap((status) => (by.has(status) ? [{ status, ...by.get(status)! }] : []));
  }, [nodes, edges]);

  // Si lo que se estaba mirando ya no está en el lienzo, se suelta.
  const lensGone = !!lens && !counts.some((c) => c.status === lens);
  useEffect(() => {
    if (lensGone) setLens(null);
  }, [lensGone, setLens]);

  if (!counts.length) return null;
  return (
    <div className="canvas-status animate-pop" role="group" aria-label="Estados en este lienzo" data-testid="status-legend">
      {counts.map(({ status, elements, relations }) => {
        const what = [elements ? plural(elements, 'elemento') : null, relations ? `${relations} ${relations === 1 ? 'relación' : 'relaciones'}` : null].filter(Boolean).join(' y ');
        const on = lens === status;
        return (
          <button
            key={status}
            type="button"
            data-status={status}
            aria-pressed={on}
            onClick={() => setLens(on ? null : status)}
            title={`${STATUS_LABEL[status]} (${STATUS_HINT[status].toLowerCase()}): ${what}. ${on ? 'Click para volver a ver todo' : 'Click para dejar a la vista solo esto'}`}
            data-testid={`status-legend-${status}`}
          >
            <StatusDot status={status} />
            {STATUS_LABEL[status]}
            <span className="canvas-status__count">{elements + relations}</span>
          </button>
        );
      })}
    </div>
  );
}
