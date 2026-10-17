import { memo } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { findProvider } from '@aegon/core';
import { TechIcon } from '@aegon/icons';
import type { BoundaryFlowNode, GroupFlowNode } from '../derive.ts';
import { elementIcon } from './ElementNode.tsx';

function GroupNodeImpl({ data, selected }: NodeProps<GroupFlowNode>) {
  const el = data.element;
  const provider = findProvider(el.group.provider);
  const detail = [el.group.region, el.group.account, el.group.cidr].filter(Boolean).join(' · ');
  return (
    <div className="c4-group" data-provider={el.group.provider} data-testid={`group-${el.id}`}>
      <NodeResizer isVisible={selected} minWidth={200} minHeight={120} />
      <div className="c4-group__edge" />
      <div className="c4-group__label">
        <TechIcon icon={provider?.icon ?? 'glyph:group'} label={provider?.name} size={14} />
        <span>{el.name}</span>
        {detail ? <span>{detail}</span> : null}
      </div>
    </div>
  );
}

export const GroupNode = memo(GroupNodeImpl);

function BoundaryNodeImpl({ data, width, height }: NodeProps<BoundaryFlowNode>) {
  const el = data.element;
  const { icon, label } = elementIcon(el);
  return (
    <div className="c4-boundary" data-kind={el.kind} style={{ width, height }}>
      <div className="c4-boundary__label">
        <TechIcon icon={icon} label={label} size={15} />
        {el.name}
        <small>{el.kind === 'system' ? 'Sistema · contenedores' : 'Contenedor · componentes'}</small>
      </div>
    </div>
  );
}

export const BoundaryNode = memo(BoundaryNodeImpl);
