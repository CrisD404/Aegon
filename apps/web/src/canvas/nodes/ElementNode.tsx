import { memo, type ReactNode } from 'react';
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react';
import { AppWindow, Cog, Globe, Layers, Link2, Monitor, Smartphone, Webhook, Workflow, Zap } from 'lucide-react';
import {
  BUS_TYPE_LABEL,
  CONTAINER_TYPE_LABEL,
  KIND_LABEL,
  RISK_LABEL,
  findBroker,
  findEngine,
  findTechnology,
  type ContainerType,
  type Element,
} from '@aegon/core';
import { TechIcon } from '@aegon/icons';
import type { ElementFlowNode } from '../derive.ts';
import { useLod } from '../lod.ts';

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
export function kindCaption(el: Element): string {
  const external = el.scope === 'external';
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

export function technologyOf(el: Element): string[] {
  return el.kind === 'system' || el.kind === 'container' || el.kind === 'component' ? (el.technology ?? []) : [];
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
export function KindChip({ el, size = 16 }: { el: Element; size?: number }) {
  let content: ReactNode;
  if (el.kind === 'container' && el.containerType) {
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

function ElementNodeImpl({ data, height, selected }: NodeProps<ElementFlowNode>) {
  const el = data.element;
  const lod = useLod();
  const common = {
    'data-kind': el.kind,
    'data-external': el.scope === 'external' || undefined,
    'data-status': el.status,
    'data-testid': `node-${el.id}`,
  };
  if (lod === 'far') {
    // Vista lejana: franja + nombre (con escala compensada por CSS) y los handles.
    return (
      <div className="c4-node c4-node--far" {...common}>
        <span className="c4-node__stripe" />
        <div className="c4-node__name">{el.name}</div>
        <Handles />
      </div>
    );
  }
  const technology = technologyOf(el);
  const risk = 'risk' in el ? el.risk : undefined;
  const tall = (height ?? 0) >= DESCRIPTION_MIN_HEIGHT;

  return (
    <div className="c4-node" {...common} data-tall={tall || undefined} data-new={data.fresh || undefined}>
      <NodeResizer isVisible={selected} minWidth={160} minHeight={60} />
      <span className="c4-node__stripe" />
      <KindChip el={el} />
      <div className="c4-node__body">
        <div className="c4-node__name">{el.name}</div>
        <div className="c4-node__metarow">
          <span className="c4-node__meta">
            {kindCaption(el)}
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
        {tall && el.description ? <p className="c4-node__desc">{el.description}</p> : null}
      </div>
      {risk ? <span className="c4-node__risk" data-risk={risk} title={`Riesgo ${RISK_LABEL[risk].toLowerCase()}`} /> : null}
      <Handles />
    </div>
  );
}

export const ElementNode = memo(ElementNodeImpl);
