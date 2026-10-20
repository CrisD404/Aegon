import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ConnectionMode, ReactFlow, ReactFlowProvider, ViewportPortal, useReactFlow, type Node } from '@xyflow/react';
import type { Id, Model, View } from '@aegon/core';
import { deriveBoundary, deriveEdges, deriveNodes, type AegonNode, type RelationFlowEdge } from '../canvas/derive.ts';
import { ElementNode } from '../canvas/nodes/ElementNode.tsx';
import { BoundaryNode, GroupNode } from '../canvas/nodes/GroupNode.tsx';
import { DeploymentNode } from '../canvas/nodes/DeploymentNode.tsx';
import { EdgeMarkers, RelationEdge } from '../canvas/edges/RelationEdge.tsx';
import { CommentsLayer } from '../canvas/Comments.tsx';
import { LodContext } from '../canvas/lod.ts';
import type { SheetTone } from './ExportSheet.tsx';
import { withInlinedSvgStyles } from './svg-styles.ts';

const nodeTypes = { element: ElementNode, group: GroupNode, deployment: DeploymentNode, boundary: BoundaryNode };
const edgeTypes = { relation: RelationEdge };
const NONE: ReadonlySet<Id> = new Set();

export interface CanvasCapture {
  /** Imagen del diagrama (PNG en data URL) y su tamaño lógico en px del lienzo. */
  image: string;
  width: number;
  height: number;
}

interface Props {
  model: Model;
  view: View;
  tone: SheetTone;
  pixelRatio: number;
  comments: boolean;
  background: string;
  onCapture: (capture: CanvasCapture | null) => void;
}

/**
 * Lienzo propio para exportar, fuera de la pantalla: renderiza el diagrama entero con el máximo
 * detalle y con el tema de la exportación (`data-theme` solo en este contenedor), sin tocar el
 * lienzo que está usando la persona ni el tema de la app. Avisa con la captura cuando termina.
 */
export function ExportCanvas(props: Props) {
  return createPortal(
    <div
      data-theme={props.tone}
      aria-hidden
      // Fuera de la pantalla, pero renderizado y medido (con `display: none` o `visibility: hidden`
      // no habría layout ni estilos que capturar).
      style={{ position: 'fixed', left: -40000, top: 0, width: 1600, height: 1000, pointerEvents: 'none', contain: 'strict' }}
      data-testid="export-canvas"
    >
      <ReactFlowProvider>
        <ExportFlow {...props} />
      </ReactFlowProvider>
    </div>,
    document.body,
  );
}

function ExportFlow({ model, view, tone, pixelRatio, comments, background, onCapture }: Props) {
  const rf = useReactFlow<AegonNode, RelationFlowEdge>();
  const shellRef = useRef<HTMLDivElement>(null);
  const nodes = useMemo(() => {
    const plain = deriveNodes(model, view, NONE);
    const boundary = deriveBoundary(model, view, plain);
    return boundary ? [boundary, ...plain] : plain;
  }, [model, view]);
  const edges = useMemo(() => deriveEdges(model, view, NONE, NONE, NONE), [model, view]);
  const done = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    // StrictMode monta, desmonta y vuelve a montar: la marca se repone en cada montaje.
    mounted.current = true;
    if (done.current) return () => void (mounted.current = false);
    done.current = true;
    // Se espera a que el DOM tenga los nodos y las relaciones (con sus etiquetas) antes de capturar;
    // como mucho ~3 s. El resultado se descarta solo si el lienzo oculto se desmontó.
    const started = performance.now();
    const ready = () => {
      const shell = shellRef.current;
      if (!shell) return false;
      const drawn = shell.querySelectorAll('.react-flow__node').length >= nodes.length && shell.querySelectorAll('.react-flow__edge').length >= edges.length;
      const hidden = [...shell.querySelectorAll<HTMLElement>('.react-flow__node')].some((n) => n.style.visibility === 'hidden');
      return drawn && !hidden;
    };
    const tick = () => {
      if (!mounted.current) return;
      if (!ready() && performance.now() - started < 3000) {
        requestAnimationFrame(tick);
        return;
      }
      // Un cuadro más para que ReactFlow ubique las etiquetas de las relaciones.
      requestAnimationFrame(() => {
        void captureViewport(shellRef.current, rf.getNodes(), { pixelRatio, background, comments })
          .then((capture) => mounted.current && onCapture(capture))
          .catch(() => mounted.current && onCapture(null));
      });
    };
    requestAnimationFrame(tick);
    return () => void (mounted.current = false);
  }, [nodes.length, edges.length, rf, pixelRatio, background, comments, onCapture]);

  return (
    <div ref={shellRef} style={{ width: '100%', height: '100%' }}>
      <LodContext.Provider value="near">
        <ReactFlow<AegonNode, RelationFlowEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          colorMode={tone}
          // Como en el lienzo: las relaciones se enganchan a cualquier punto del borde.
          connectionMode={ConnectionMode.Loose}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          minZoom={1}
          maxZoom={1}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag={false}
          zoomOnScroll={false}
          proOptions={{ hideAttribution: true }}
        >
          <ViewportPortal>
            <EdgeMarkers />
          </ViewportPortal>
          {comments ? <CommentsLayer view={view} /> : null}
        </ReactFlow>
      </LodContext.Provider>
    </div>
  );
}

/** Captura el viewport entero (todos los nodos y las etiquetas de las relaciones) con un margen. */
async function captureViewport(shell: HTMLElement | null, nodes: Node[], opts: { pixelRatio: number; background: string; comments: boolean; padding?: number }): Promise<CanvasCapture | null> {
  const viewport = shell?.querySelector<HTMLElement>('.react-flow__viewport');
  if (!shell || !viewport || !nodes.length) return null;
  const padding = opts.padding ?? 48;
  const origin = shell.getBoundingClientRect();
  // Con el viewport en (0, 0) y zoom 1, la posición en pantalla menos el origen es la del lienzo.
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  const extend = (r: DOMRect) => {
    x1 = Math.min(x1, r.left - origin.left);
    y1 = Math.min(y1, r.top - origin.top);
    x2 = Math.max(x2, r.right - origin.left);
    y2 = Math.max(y2, r.bottom - origin.top);
  };
  for (const el of viewport.querySelectorAll<HTMLElement>('.react-flow__node, .c4-edge-label')) extend(el.getBoundingClientRect());
  if (opts.comments) for (const el of viewport.querySelectorAll<HTMLElement>('.comment-pin')) extend(el.getBoundingClientRect());
  if (!Number.isFinite(x1)) return null;
  const width = Math.ceil(x2 - x1 + padding * 2);
  const height = Math.ceil(y2 - y1 + padding * 2);
  // Chromium no dibuja canvas de más de ~16k px por lado: se baja la densidad si hace falta.
  const ratio = Math.max(0.5, Math.min(opts.pixelRatio, 16000 / Math.max(width, height)));
  const { toCanvas } = await import('html-to-image');
  const canvas = await withInlinedSvgStyles(viewport, () =>
    toCanvas(viewport, {
      width,
      height,
      pixelRatio: ratio,
      backgroundColor: opts.background,
      style: { width: `${width}px`, height: `${height}px`, transform: `translate(${padding - x1}px, ${padding - y1}px) scale(1)` },
      filter: (node) => {
        if (!(node instanceof HTMLElement)) return true;
        // Ni puntos de conexión ni tarjetas de comentarios abiertas: solo el diagrama (y los pines).
        return !node.classList.contains('react-flow__handle') && !node.classList.contains('comment-card-pos') && !node.classList.contains('comment-card');
      },
    }),
  );
  return { image: canvas.toDataURL('image/png'), width, height };
}
