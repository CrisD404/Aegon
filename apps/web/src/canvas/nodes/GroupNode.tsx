import { memo } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { findProvider } from '@aegon/core';
import { TechIcon } from '@aegon/icons';
import { boundaryCaption, groupDetail, type BoundaryFlowNode, type GroupFlowNode } from '../derive.ts';
import { CostBadge, elementIcon } from './ElementNode.tsx';

function GroupNodeImpl({ data, selected }: NodeProps<GroupFlowNode>) {
  const el = data.element;
  const provider = findProvider(el.group.provider);
  const detail = groupDetail(el);
  return (
    <div className="c4-group" data-provider={el.group.provider} data-frame-id={el.id} data-testid={`group-${el.id}`}>
      <NodeResizer isVisible={selected} minWidth={200} minHeight={120} />
      <div className="c4-group__edge" />
      <div className="c4-group__label">
        <TechIcon icon={provider?.icon ?? 'glyph:group'} label={provider?.name} size={14} />
        <span>{el.name}</span>
        {detail ? <span>{detail}</span> : null}
        <CostBadge id={el.id} />
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
        <small>{boundaryCaption(el)}</small>
        <CostBadge id={el.id} />
      </div>
    </div>
  );
}

export const BoundaryNode = memo(BoundaryNodeImpl);
