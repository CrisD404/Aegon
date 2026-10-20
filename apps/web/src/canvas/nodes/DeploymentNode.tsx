import { memo } from 'react';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { NODE_TYPE_LABEL, findTechnology } from '@aegon/core';
import { TechIcon } from '@aegon/icons';
import type { DeploymentFlowNode } from '../derive.ts';
import { CostBadge } from './ElementNode.tsx';
import { NODE_TYPE_ICON, nodeProvider, providerTone } from './deployment-icons.tsx';

const HANDLES = [
  { id: 't', position: Position.Top },
  { id: 'r', position: Position.Right },
  { id: 'b', position: Position.Bottom },
  { id: 'l', position: Position.Left },
] as const;

/**
 * Nodo de despliegue (C4 deployment node): un marco que aloja infraestructura, instancias y otros
 * nodos. A diferencia de un grupo, es infraestructura real: tiene tipo, tecnología, tamaño,
 * direcciones y se puede relacionar (por ejemplo, un enlace que llega a una VPC).
 */
function DeploymentNodeImpl({ data, selected }: NodeProps<DeploymentFlowNode>) {
  const el = data.element;
  const Icon = NODE_TYPE_ICON[el.node.type];
  const provider = nodeProvider(el.node.provider);
  const technology = (el.technology ?? []).map((t) => findTechnology(t)?.name ?? t);
  const caption = [NODE_TYPE_LABEL[el.node.type], ...technology, el.node.size, el.node.region].filter(Boolean).join(' · ');
  const ids = [el.resource, ...(el.addresses ?? []), el.node.account].filter(Boolean).join(' · ');
  return (
    <div
      className="c4-deploy"
      data-provider={providerTone(el.node.provider)}
      data-status={el.status}
      data-new={data.fresh || undefined}
      data-frame-id={el.id}
      data-testid={`deploy-${el.id}`}
    >
      <NodeResizer isVisible={selected} minWidth={240} minHeight={140} />
      <div className="c4-deploy__edge" />
      <div className="c4-deploy__head">
        <span className="c4-deploy__icon" aria-hidden>
          {provider && !provider.icon.startsWith('glyph:') ? <TechIcon icon={provider.icon} label={provider.name} size={15} /> : <Icon size={15} strokeWidth={1.75} />}
        </span>
        <div className="c4-deploy__text">
          <div className="c4-deploy__name">
            {el.name}
            {el.node.instances && el.node.instances > 1 ? <span className="c4-deploy__count" title={`${el.node.instances} nodos iguales`}>×{el.node.instances}</span> : null}
            <CostBadge id={el.id} />
          </div>
          <div className="c4-deploy__caption">{caption}</div>
          {ids ? <div className="c4-deploy__ids">{ids}</div> : null}
        </div>
      </div>
      {HANDLES.map((h) => (
        <Handle key={h.id} id={h.id} type="source" position={h.position} className="c4-handle c4-deploy__handle" />
      ))}
    </div>
  );
}

export const DeploymentNode = memo(DeploymentNodeImpl);
