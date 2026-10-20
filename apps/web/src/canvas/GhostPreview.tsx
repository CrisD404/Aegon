import { useEffect, useState } from 'react';
import { NODE_TYPE_LABEL, findProvider, findTechnology, sizeOf, type Element } from '@aegon/core';
import { TechIcon } from '@aegon/icons';
import { LayoutTemplate } from 'lucide-react';
import { KindChip, kindCaption, technologyOf } from './nodes/ElementNode.tsx';
import { NODE_TYPE_ICON, nodeProvider, providerTone } from './nodes/deployment-icons.tsx';

/** Lo que muestra el fantasma: el elemento que se va a crear o ubicar, o un bloque de template. */
export type GhostPreviewData =
  | {
      type: 'element';
      /** Identidad de la vista previa: cuando cambia, el contenido se reemplaza con una animación. */
      key: string;
      el: Element;
      /** Lo que despliega una instancia. */
      target?: Element;
      /** Sin nombre escrito, el nombre va rotando entre estos ejemplos. */
      examples?: readonly string[];
      tag: string;
    }
  | { type: 'template'; key: string; name: string; elements: number; tag: string };

/** Los marcos (grupo, nodo de despliegue) se previsualizan más chicos que su tamaño inicial. */
const FRAME_PREVIEW = { w: 320, h: 168 };
const TEMPLATE_PREVIEW = { w: 240, h: 72 };
const EXAMPLE_MS = 1700;

function previewSize(p: GhostPreviewData): { w: number; h: number } {
  if (p.type === 'template') return TEMPLATE_PREVIEW;
  if (p.el.kind === 'group' || p.el.kind === 'node') return FRAME_PREVIEW;
  return sizeOf(p.el);
}

/**
 * Fantasma del lienzo: una vista previa del nodo tal como va a quedar (mismo dibujo, al zoom
 * actual), centrada donde se hizo doble click. Sigue a la opción resaltada del menú: cambia de
 * tamaño con una transición, el contenido entra con un fundido y, si todavía no se escribió un
 * nombre, rota entre ejemplos del tipo.
 */
export function GhostPreview({
  preview,
  x,
  y,
  zoom,
  tagAlign = 'start',
}: {
  preview: GhostPreviewData;
  x: number;
  y: number;
  zoom: number;
  /** De qué lado del fantasma se alinea la etiqueta: del lado contrario al menú. */
  tagAlign?: 'start' | 'end';
}) {
  const size = previewSize(preview);
  const style = {
    left: x,
    top: y,
    ['--zoom' as string]: zoom,
    ['--ghost-w' as string]: `${size.w * zoom}px`,
    ['--ghost-h' as string]: `${size.h * zoom}px`,
  };
  return (
    <div
      className="ghost-preview"
      style={style}
      aria-hidden
      data-testid="ghost-preview"
      data-preview={preview.key}
    >
      <div className="ghost-preview__tag" data-align={tagAlign}>
        <span key={preview.tag}>{preview.tag}</span>
      </div>
      <div className="ghost-preview__box" style={{ width: size.w, height: size.h }}>
        <div key={preview.key} className="ghost-preview__swap">
          {preview.type === 'template' ? (
            <TemplatePreview name={preview.name} elements={preview.elements} />
          ) : (
            <ElementPreview el={preview.el} target={preview.target} examples={preview.examples} />
          )}
        </div>
      </div>
    </div>
  );
}

/** Índice del ejemplo que se muestra: avanza solo mientras haya varios y no se haya escrito nada. */
function useExample(examples: readonly string[] | undefined, active: boolean): number {
  const count = examples?.length ?? 0;
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active || count < 2) return;
    const timer = setInterval(() => setI((n) => (n + 1) % count), EXAMPLE_MS);
    return () => clearInterval(timer);
  }, [active, count]);
  return count ? i % count : 0;
}

function ElementPreview({
  el,
  target,
  examples,
}: {
  el: Element;
  target?: Element;
  examples?: readonly string[];
}) {
  const cycling = !el.name && !!examples?.length;
  const i = useExample(examples, cycling);
  const name = cycling ? (
    <span key={i} className="ghost-preview__example">
      {examples![i]}
    </span>
  ) : (
    el.name
  );

  if (el.kind === 'node') {
    const Icon = NODE_TYPE_ICON[el.node.type];
    const provider = nodeProvider(el.node.provider);
    return (
      <div className="c4-deploy" data-provider={providerTone(el.node.provider)}>
        <div className="c4-deploy__edge" />
        <div className="c4-deploy__head">
          <span className="c4-deploy__icon">
            {provider && !provider.icon.startsWith('glyph:') ? (
              <TechIcon icon={provider.icon} label={provider.name} size={15} />
            ) : (
              <Icon size={15} strokeWidth={1.75} />
            )}
          </span>
          <div className="c4-deploy__text">
            <div className="c4-deploy__name">{name}</div>
            <div className="c4-deploy__caption">{NODE_TYPE_LABEL[el.node.type]}</div>
          </div>
        </div>
      </div>
    );
  }
  if (el.kind === 'group') {
    const provider = findProvider(el.group.provider);
    return (
      <div className="c4-group" data-provider={el.group.provider}>
        <div className="c4-group__edge" />
        <div className="c4-group__label">
          <TechIcon icon={provider?.icon ?? 'glyph:group'} label={provider?.name} size={14} />
          <span>{name}</span>
        </div>
      </div>
    );
  }
  const technology = technologyOf(el, target);
  return (
    <div
      className="c4-node"
      data-kind={el.kind === 'instance' ? (target?.kind ?? 'container') : el.kind}
      data-instance={el.kind === 'instance' || undefined}
      data-external={el.scope === 'external' || undefined}
    >
      <span className="c4-node__stripe" />
      <KindChip el={el} target={target} />
      <div className="c4-node__body">
        <div className="c4-node__name">{name}</div>
        <div className="c4-node__metarow">
          <span className="c4-node__meta">
            {kindCaption(el, target)}
            {technology.length ? (
              <span className="c4-node__tech">
                {' '}
                · {technology.map((t) => findTechnology(t)?.name ?? t).join(', ')}
              </span>
            ) : null}
          </span>
        </div>
      </div>
    </div>
  );
}

function TemplatePreview({ name, elements }: { name: string; elements: number }) {
  return (
    <div className="ghost-preview__stack">
      <div className="c4-node" data-kind="container">
        <span className="c4-node__stripe" />
        <span className="c4-chip" data-kind="container">
          <LayoutTemplate size={16} strokeWidth={1.75} />
        </span>
        <div className="c4-node__body">
          <div className="c4-node__name">{name}</div>
          <div className="c4-node__metarow">
            <span className="c4-node__meta">Bloque · {elements} elementos</span>
          </div>
        </div>
      </div>
    </div>
  );
}
