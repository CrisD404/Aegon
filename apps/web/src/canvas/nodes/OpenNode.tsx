import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ChevronDown, SquareArrowOutUpRight } from 'lucide-react';
import { TechIcon } from '@aegon/icons';
import { drillInto, toggleExpand } from '../../lib/actions.ts';
import { openCaption, type OpenFlowNode } from '../derive.ts';
import { CostBadge, LoadBadge, StatusMark, elementIcon } from './ElementNode.tsx';

const HANDLES = [
  { id: 't', position: Position.Top },
  { id: 'r', position: Position.Right },
  { id: 'b', position: Position.Bottom },
  { id: 'l', position: Position.Left },
] as const;

/**
 * Sistema o contenedor abierto en el lugar: un marco con sus hijos adentro. Envuelve justo a su
 * contenido (no se redimensiona a mano) y se cierra desde su encabezado; el interior deja pasar los
 * clicks al lienzo, así un doble click adentro crea un hijo ahí.
 */
function OpenNodeImpl({ data }: NodeProps<OpenFlowNode>) {
  const el = data.element;
  const { icon, label } = elementIcon(el);
  return (
    <div
      className="c4-open"
      data-kind={el.kind}
      data-external={el.scope === 'external' || undefined}
      data-status={data.status}
      data-new={data.fresh || undefined}
      data-frame-id={el.id}
      data-testid={`open-${el.id}`}
    >
      <StatusMark status={data.status} show={data.statusMark} />
      <div className="c4-open__edge" />
      <div className="c4-open__head">
        <button
          type="button"
          className="c4-open__btn nodrag nopan"
          title="Cerrar (Enter)"
          aria-label={`Cerrar ${el.name}`}
          onClick={(e) => {
            e.stopPropagation();
            toggleExpand(el.id);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          data-testid={`collapse-${el.id}`}
        >
          <ChevronDown size={14} strokeWidth={2.25} />
        </button>
        <TechIcon icon={icon} label={label} size={15} />
        <span className="c4-open__name">{el.name}</span>
        <small>{openCaption(el, data.childCount)}</small>
        <CostBadge id={el.id} />
        <LoadBadge id={el.id} />
        <button
          type="button"
          className="c4-open__btn c4-open__detail nodrag nopan"
          title="Abrir en un lienzo aparte (Alt Enter)"
          aria-label={`Abrir ${el.name} en un lienzo aparte`}
          onClick={(e) => {
            e.stopPropagation();
            drillInto(el.id);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <SquareArrowOutUpRight size={12} />
        </button>
      </div>
      {HANDLES.map((h) => (
        <Handle key={h.id} id={h.id} type="source" position={h.position} className="c4-handle c4-open__handle" />
      ))}
    </div>
  );
}

export const OpenNode = memo(OpenNodeImpl);
