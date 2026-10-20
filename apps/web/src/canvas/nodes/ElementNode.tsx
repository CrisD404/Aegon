import { memo, type ReactNode } from 'react';
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react';
import { AppWindow, Cog, Globe, Layers, Link2, Monitor, Smartphone, Webhook, Workflow, Zap } from 'lucide-react';
import {
  BUS_TYPE_LABEL,
  CONTAINER_TYPE_LABEL,
  INFRA_TYPE_LABEL,
  KIND_LABEL,
  NODE_TYPE_LABEL,
  RISK_LABEL,
  findBroker,
  findEngine,
  findTechnology,
  type ContainerType,
  type Element,
  ADDRESS_ROW_HEIGHT,
  addressRows,
  networkLabels,
} from '@aegon/core';
import { TechIcon } from '@aegon/icons';
import type { ElementFlowNode } from '../derive.ts';
import { useLod } from '../lod.ts';
import { useNodeCost } from '../costs.ts';
import { moneyCompact } from '../../lib/money.ts';
import { INFRA_TYPE_ICON, NODE_TYPE_ICON } from './deployment-icons.tsx';

/** Costo mensual del nodo (propio + hijos) con la capa de costos activa. */
export function CostBadge({ id }: { id: string }) {
  const cost = useNodeCost(id);
  if (!cost) return null;
  return (
    <span className="c4-cost" data-heat={cost.heat} title="Costo mensual estimado (incluye lo que contiene)" data-testid={`cost-${id}`}>
      {moneyCompact(cost.total, cost.currency)}
    </span>
  );
}

const HANDLES = [
  { id: 't', position: Position.Top },
  { id: 'r', position: Position.Right },
  { id: 'b', position: Position.Bottom },
  { id: 'l', position: Position.Left },
] as const;

/** Altura a partir de la cual el nodo (redimensionado) muestra también la descripción. */
const DESCRIPTION_MIN_HEIGHT = 104;

const CONTAINER_ICON: Record<ContainerType, typeof Globe> = {
  web: Globe,
  mobile: Smartphone,
  desktop: Monitor,
  api: Webhook,
  service: Cog,
  worker: Workflow,
  function: Zap,
  other: AppWindow,
};

/** Ícono principal del elemento: motor de la DB, broker del bus o el glifo de su tipo. */
export function elementIcon(el: Element): { icon: string; label: string } {
  if (el.kind === 'store') {
    if (el.store.engine === 'other') return { icon: el.store.customIcon ?? 'glyph:store', label: el.store.customEngine ?? 'DB' };
    const engine = findEngine(el.store.engine);
    return { icon: engine?.icon ?? 'glyph:store', label: engine?.name ?? el.store.engine };
  }
  if (el.kind === 'bus') {
    if (el.bus.broker === 'other') return { icon: el.bus.customIcon ?? 'glyph:bus', label: el.bus.customBroker ?? 'Bus' };
    const broker = findBroker(el.bus.broker);
    return { icon: broker?.icon ?? 'glyph:bus', label: broker?.name ?? el.bus.broker };
  }
  return { icon: `glyph:${el.kind}`, label: KIND_LABEL[el.kind] };
}

/** Línea secundaria del nodo: qué es (tipo, motor, broker, rol) antes que su tecnología. */
export function kindCaption(el: Element, target?: Element): string {
  const external = el.scope === 'external';
  if (el.kind === 'infra') return INFRA_TYPE_LABEL[el.infra.type];
  if (el.kind === 'node') return NODE_TYPE_LABEL[el.node.type];
  if (el.kind === 'instance') {
    if (!target) return 'Instancia';
    const base = kindCaption(target);
    return target.name !== el.name ? `${target.name} · ${base}` : base;
  }
  if (el.kind === 'store') {
    const engine = el.store.engine === 'other' ? el.store.customEngine : findEngine(el.store.engine)?.name;
    return [external ? 'Base de datos externa' : 'Base de datos', engine].filter(Boolean).join(' · ');
  }
  if (el.kind === 'bus') {
    const broker = el.bus.broker === 'other' ? el.bus.customBroker : findBroker(el.bus.broker)?.name;
    const type = el.bus.type ? BUS_TYPE_LABEL[el.bus.type] : 'Bus';
    return [external ? `${type} externo` : type, broker].filter(Boolean).join(' · ');
  }
  if (el.kind === 'container' && el.containerType) {
    return `${CONTAINER_TYPE_LABEL[el.containerType]}${external ? ' externa' : ''}`;
  }
  if (el.kind === 'actor') return el.role ? `${external ? 'Externo' : 'Actor'} · ${el.role}` : external ? 'Actor externo' : 'Actor';
  const base = KIND_LABEL[el.kind];
  return external ? `${base} externo` : base;
}

export function technologyOf(el: Element, target?: Element): string[] {
  if (el.kind === 'instance') return target ? technologyOf(target) : [];
  return 'technology' in el ? (el.technology ?? []) : [];
}

function Handles() {
  return (
    <>
      {HANDLES.map((h) => (
        <Handle key={h.id} id={h.id} type="source" position={h.position} className="c4-handle" />
      ))}
    </>
  );
}

/** Chip del tipo: la forma (círculo, cilindro, píldora, cuadrado) dice qué es el elemento. */
export function KindChip({ el, size = 16, target }: { el: Element; size?: number; target?: Element }) {
  // Una instancia se ve como lo que despliega (mismo chip), con la marca de instancia.
  if (el.kind === 'instance' && target && target.kind !== 'instance') {
    return (
      <span className="c4-chip-wrap" data-instance>
        <KindChip el={target} size={size} />
      </span>
    );
  }
  let content: ReactNode;
  if (el.kind === 'infra') {
    const Icon = INFRA_TYPE_ICON[el.infra.type];
    content = <Icon size={size} strokeWidth={1.75} />;
  } else if (el.kind === 'node') {
    const Icon = NODE_TYPE_ICON[el.node.type];
    content = <Icon size={size} strokeWidth={1.75} />;
  } else if (el.kind === 'container' && el.containerType) {
    const Icon = CONTAINER_ICON[el.containerType];
    content = <Icon size={size} strokeWidth={1.75} />;
  } else {
    const { icon, label } = elementIcon(el);
    content = <TechIcon icon={icon} label={label} size={size} />;
  }
  return (
    <span className="c4-chip" data-kind={el.kind} aria-hidden>
      {content}
    </span>
  );
}

function ElementNodeImpl({ data, width, height, selected }: NodeProps<ElementFlowNode>) {
  const el = data.element;
  const target = data.target;
  const lod = useLod();
  const replicas = el.kind === 'instance' ? el.instance.replicas : undefined;
  const common = {
    // Una instancia toma el color de lo que despliega.
    'data-kind': el.kind === 'instance' ? (target?.kind ?? 'container') : el.kind,
    'data-instance': el.kind === 'instance' || undefined,
    'data-replicas': replicas && replicas > 1 ? replicas : undefined,
    'data-external': el.scope === 'external' || (el.kind === 'instance' && target?.scope === 'external') || undefined,
    'data-status': el.status,
    'data-testid': `node-${el.id}`,
  };
  if (lod === 'far') {
    // Vista lejana: franja + nombre (con escala compensada por CSS) y los handles.
    return (
      <div className="c4-node c4-node--far" {...common}>
        <span className="c4-node__stripe" />
        <div className="c4-node__name">{el.name}</div>
        <CostBadge id={el.id} />
        <Handles />
      </div>
    );
  }
  const technology = technologyOf(el, target);
  const risk = 'risk' in el ? el.risk : undefined;
  const network = el.kind === 'infra' || el.kind === 'instance' || el.kind === 'node' ? networkLabels(el) : [];
  const rows = network.length ? addressRows(network, width ?? undefined) : [];
  // Las direcciones ocupan su lugar: la descripción solo entra si el nodo es más alto todavía.
  const tall = (height ?? 0) >= DESCRIPTION_MIN_HEIGHT + rows.length * ADDRESS_ROW_HEIGHT;

  return (
    <div className="c4-node" {...common} data-tall={tall || undefined} data-new={data.fresh || undefined}>
      <NodeResizer isVisible={selected} minWidth={160} minHeight={60} />
      <span className="c4-node__stripe" />
      <KindChip el={el} target={target} />
      <div className="c4-node__body">
        <div className="c4-node__name">
          {el.name}
          {replicas && replicas > 1 ? <span className="c4-node__replicas" title={`${replicas} réplicas`}>×{replicas}</span> : null}
        </div>
        <div className="c4-node__metarow">
          <span className="c4-node__meta">
            {kindCaption(el, target)}
            {technology.length ? <span className="c4-node__tech"> · {technology.map((t) => findTechnology(t)?.name ?? t).join(', ')}</span> : null}
          </span>
          {data.viewCount > 1 ? (
            <span className="c4-node__badge" title={`Aparece en ${data.viewCount} lienzos`}>
              <Link2 size={10} />
              {data.viewCount}
            </span>
          ) : null}
          {data.canDrill ? (
            <span className="c4-node__badge c4-node__drill" title={`Doble click para abrir ${el.kind === 'system' ? 'los contenedores (L2)' : 'los componentes (L3)'}`}>
              <Layers size={10} />
              {data.childCount || (data.hasChildView ? '·' : '+')}
            </span>
          ) : null}
        </div>
        {rows.length ? (
          <div className="c4-node__addr" title={network.join('\n')}>
            {rows.map((row, i) => (
              <div key={i}>{row}</div>
            ))}
          </div>
        ) : null}
        {tall && el.description ? <p className="c4-node__desc">{el.description}</p> : null}
      </div>
      {risk ? <span className="c4-node__risk" data-risk={risk} title={`Riesgo ${RISK_LABEL[risk].toLowerCase()}`} /> : null}
      <CostBadge id={el.id} />
      <Handles />
    </div>
  );
}

export const ElementNode = memo(ElementNodeImpl);
