import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  ReactFlow,
  SelectionMode,
  ViewportPortal,
  applyNodeChanges,
  useNodesInitialized,
  useReactFlow,
  getViewportForBounds,
  useStore,
  type Connection,
  type FinalConnectionState,
  type Node,
  type NodeChange,
  type NodePositionChange,
  type EdgeChange,
} from '@xyflow/react';
import { canHaveParent, sizeOf, type Element, type ElementKind, type Id, type NodeLayout, type Op } from '@aegon/core';
import { useUi } from '../store/ui.ts';
import { useWorkspace } from '../store/workspace.ts';
import { connect, drillInto, placeExisting, revealElement } from '../lib/actions.ts';
import { computeGuides, contains, type GuideLine } from '../lib/geometry.ts';
import {
  BOUNDARY_PREFIX,
  FRAME_NODE_TYPES,
  absoluteRects,
  deriveBoundary,
  deriveEdges,
  deriveNodes,
  type AegonNode,
  type RelationFlowEdge,
} from './derive.ts';
import { ElementNode } from './nodes/ElementNode.tsx';
import { BoundaryNode, GroupNode } from './nodes/GroupNode.tsx';
import { DeploymentNode } from './nodes/DeploymentNode.tsx';
import { EdgeMarkers, RelationEdge } from './edges/RelationEdge.tsx';
import { GHOST_PANEL_WIDTH, GhostPicker } from './GhostPicker.tsx';
import { Rulers } from './Rulers.tsx';
import { CanvasContextMenu, type ContextTarget } from './CanvasContextMenu.tsx';
import { CanvasDock } from './CanvasDock.tsx';
import { CanvasNav } from './CanvasNav.tsx';
import { SelectionToolbar } from './SelectionToolbar.tsx';
import { EmptyHint } from './EmptyHint.tsx';
import { DRAG_MIME, canvasApi } from './api.ts';
import { LodContext, type Lod } from './lod.ts';
import { CanvasHighlight } from './Highlight.tsx';
import { CanvasSearch } from './CanvasSearch.tsx';
import { CostChip } from './CostChip.tsx';
import { FlowOverlay } from './FlowOverlay.tsx';
import { FlowPlayer } from './FlowPlayer.tsx';
import { CommentPlacer, CommentsLayer, StepPicker } from './Comments.tsx';

/** Color de cada nodo en el minimapa: el de su tipo (los grupos, solo el contorno del marco). */
function minimapColor(node: Node): string {
  if (node.type === 'boundary' || node.type === 'group' || node.type === 'deployment') return 'transparent';
  const kind = (node.data as { element?: { kind?: string } }).element?.kind ?? 'system';
  return `var(--kind-${kind})`;
}

const nodeTypes = { element: ElementNode, group: GroupNode, deployment: DeploymentNode, boundary: BoundaryNode };
const edgeTypes = { relation: RelationEdge };

const LOD_STEPS: [maxZoom: number, lod: string][] = [
  [0.2, 'far:2.6'],
  [0.28, 'far:2'],
  [0.4, 'far:1.5'],
  [0.62, 'mid:1'],
  [Infinity, 'near:1'],
];

/**
 * Nivel de detalle según el zoom, con histéresis: cerca de un umbral se mantiene el nivel previo,
 * así un zoom que va y viene sobre el límite no re-renderiza todos los nodos en cada paso.
 */
function lodOf(zoom: number, previous?: string): string {
  const index = LOD_STEPS.findIndex(([max]) => zoom < max);
  const prevIndex = previous ? LOD_STEPS.findIndex(([, lod]) => lod === previous) : -1;
  if (prevIndex >= 0 && prevIndex !== index) {
    const lower = prevIndex > 0 ? LOD_STEPS[prevIndex - 1]![0] : 0;
    const upper = LOD_STEPS[prevIndex]![0];
    const margin = 0.03;
    if (zoom >= lower - margin && zoom < upper + margin) return previous!;
  }
  return LOD_STEPS[index]![1];
}

/**
 * Estado de Shift: el ref se actualiza en el mismo evento (lo leen los callbacks de arrastre sin
 * esperar un re-render) y el estado sirve para las props (snap a grilla).
 */
function useShiftKey() {
  const [shift, setShift] = useState(false);
  const ref = useRef(false);
  useEffect(() => {
    const set = (value: boolean) => {
      ref.current = value;
      setShift(value);
    };
    const down = (e: KeyboardEvent) => e.key === 'Shift' && set(true);
    const up = (e: KeyboardEvent) => e.key === 'Shift' && set(false);
    const blur = () => set(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);
  return [shift, ref] as const;
}

export function Canvas() {
  const model = useWorkspace((s) => s.model);
  const viewId = useUi((s) => s.activeViewId);
  const view = viewId ? model.views[viewId] : undefined;
  const fresh = useUi((s) => s.fresh);
  const selection = useUi((s) => s.selection);
  const grid = useUi((s) => s.grid);
  const snap = useUi((s) => s.snap);
  const rulers = useUi((s) => s.rulers);
  const presenting = useUi((s) => !!s.player);
  const theme = useUi((s) => s.resolvedTheme);
  const transition = useUi((s) => s.transition);
  const focusId = useUi((s) => s.focusId);
  const ghost = useUi((s) => s.ghost);
  const rf = useReactFlow<AegonNode, RelationFlowEdge>();
  const [shift, shiftRef] = useShiftKey();
  // Solo el nivel (cambia en umbrales): suscribirse al zoom re-renderizaría el lienzo en cada frame.
  const lodRef = useRef<string | undefined>(undefined);
  const lod = useStore((s) => (lodRef.current = lodOf(s.transform[2], lodRef.current)));
  const shellRef = useRef<HTMLDivElement>(null);

  // --- Nodos: estado controlado + ref síncrona (fuente de verdad durante drags) ---------------
  const [nodes, setNodesState] = useState<AegonNode[]>([]);
  const nodesRef = useRef<AegonNode[]>([]);
  const setNodes = useCallback((next: AegonNode[]) => {
    nodesRef.current = next;
    setNodesState(next);
  }, []);

  const derived = useMemo(
    () => (view ? deriveNodes(model, view, fresh) : []),
    [model, view, fresh],
  );

  const withBoundary = useCallback(
    (list: AegonNode[]): AegonNode[] => {
      const prev = list.find((n) => n.type === 'boundary');
      const plain = prev ? list.filter((n) => n !== prev) : list;
      if (!view) return plain;
      let boundary = deriveBoundary(model, view, plain);
      // Mismo marco que antes → mismo objeto (ReactFlow no lo vuelve a procesar).
      if (
        boundary &&
        prev &&
        prev.id === boundary.id &&
        prev.data.element === boundary.data.element &&
        prev.position.x === boundary.position.x &&
        prev.position.y === boundary.position.y &&
        prev.width === boundary.width &&
        prev.height === boundary.height
      ) {
        boundary = prev as typeof boundary;
      }
      return boundary ? [boundary, ...plain] : plain;
    },
    [model, view],
  );

  const withBoundaryRef = useRef(withBoundary);
  withBoundaryRef.current = withBoundary;

  useLayoutEffect(() => {
    const prevById = new Map(nodesRef.current.map((n) => [n.id, n]));
    const selected = new Set(useUi.getState().selection.nodes);
    const merged = derived.map((n): AegonNode => {
      const prev = prevById.get(n.id);
      const out = { ...n, selected: selected.has(n.id) } as AegonNode;
      if (prev?.measured && prev.width === n.width && prev.height === n.height)
        out.measured = prev.measured;
      if (prev?.dragging) {
        out.position = prev.position;
        out.dragging = true;
      }
      return out;
    });
    setNodes(withBoundary(merged));
  }, [derived, withBoundary, setNodes]);

  // Selección externa (explorador, paleta) → flags de los nodos.
  useEffect(() => {
    const sel = new Set(selection.nodes);
    const current = nodesRef.current;
    if (current.every((n) => !!n.selected === sel.has(n.id))) return;
    setNodes(
      current.map((n) =>
        !!n.selected === sel.has(n.id) ? n : ({ ...n, selected: sel.has(n.id) } as AegonNode),
      ),
    );
  }, [selection.nodes, setNodes]);

  const edges = useMemo(
    () =>
      view
        ? deriveEdges(model, view, new Set(selection.nodes), new Set(selection.edges), fresh)
        : [],
    [model, view, selection, fresh],
  );

  /** Pasa al modelo las posiciones/tamaños actuales (absolutos) y la membresía a grupos. */
  const commitLayout = useCallback(
    (dragged: Node[]) => {
      const { model: m } = useWorkspace.getState();
      const v = viewId ? m.views[viewId] : undefined;
      if (!v) return;
      const current = nodesRef.current;
      const rects = absoluteRects(current);
      const placements: Record<Id, NodeLayout> = {};
      for (const n of current) {
        if (n.type === 'boundary') continue;
        const el = m.elements[n.id];
        const prev = v.nodes[n.id];
        const r = rects.get(n.id);
        if (!el || !prev || !r) continue;
        const def = sizeOf(el);
        const layout: NodeLayout = { x: Math.round(r.x), y: Math.round(r.y) };
        const w = n.width ?? r.w;
        const h = n.height ?? r.h;
        if (Math.round(w) !== def.w || prev.w !== undefined) layout.w = Math.round(w);
        if (Math.round(h) !== def.h || prev.h !== undefined) layout.h = Math.round(h);
        if (
          layout.x !== prev.x ||
          layout.y !== prev.y ||
          layout.w !== prev.w ||
          layout.h !== prev.h
        )
          placements[n.id] = layout;
      }
      const ops: Op[] = [];
      if (Object.keys(placements).length)
        ops.push({ type: 'view.place', view: v.id, nodes: placements });

      // Membresía: el marco más chico que contiene el centro del nodo soltado (un grupo, o un
      // nodo de despliegue para lo que se despliega).
      for (const d of dragged) {
        const el = m.elements[d.id];
        const r = rects.get(d.id);
        if (!el || !r) continue;
        const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
        const excluded = new Set([d.id]);
        if (FRAME_NODE_TYPES.has(d.type ?? ''))
          for (const n of current) if (isDescendant(current, n.id, d.id)) excluded.add(n.id);
        let best: { id: Id; area: number } | null = null;
        for (const g of current) {
          if (g.type !== frameTypeFor(el) || excluded.has(g.id)) continue;
          const gr = rects.get(g.id)!;
          if (contains(gr, c) && (!best || gr.w * gr.h < best.area))
            best = { id: g.id, area: gr.w * gr.h };
        }
        const target = best?.id;
        const currentParent = d.parentId;
        if (target === currentParent) continue;
        if (el.kind === 'group' || el.kind === 'node' || el.kind === 'infra' || el.kind === 'instance') {
          const parent = target ? m.elements[target] : undefined;
          if (parent && !canHaveParent(el.kind, parent.kind)) continue;
          // Un nodo fuera de todo marco conserva su padre si ese padre no está en este lienzo.
          if (!target && el.parent && !v.nodes[el.parent]) continue;
          ops.push({ type: 'element.update', id: el.id, patch: { parent: target ?? null } });
        } else {
          const kept = (el.groups ?? []).filter((g) => !v.nodes[g]);
          const groups = target ? [...kept, target] : kept;
          ops.push({
            type: 'element.update',
            id: el.id,
            patch: { groups: groups.length ? groups : null },
          });
        }
      }
      if (ops.length) {
        const label = dragged.length
          ? `Mover ${dragged.length === 1 ? (m.elements[dragged[0]!.id]?.name ?? '') : `${dragged.length} nodos`}`
          : 'Redimensionar';
        const ok = useWorkspace.getState().dispatch({ type: 'batch', ops, label });
        if (!ok) setNodes(withBoundary(derived));
      }
    },
    [viewId, derived, withBoundary, setNodes],
  );

  /**
   * Selección: el store de la UI es la única fuente de verdad. Solo los cambios "select" que
   * origina el usuario (click, marco de selección) la modifican; los flags `selected` de los
   * nodos se derivan del store. Así no hay eco entre ReactFlow y el store al cambiar de lienzo.
   */
  const applySelectChanges = useCallback(
    (changes: { type: string; id?: string; selected?: boolean }[], key: 'nodes' | 'edges') => {
      const selects = changes.filter((c) => c.type === 'select' && c.id);
      if (!selects.length) return;
      const ui = useUi.getState();
      const next = new Set(ui.selection[key]);
      for (const c of selects) {
        if (c.selected) next.add(c.id!);
        else next.delete(c.id!);
      }
      const list = [...next].filter((id) => !id.startsWith(BOUNDARY_PREFIX));
      ui.setSelection(
        key === 'nodes'
          ? { nodes: list, edges: ui.selection.edges }
          : { nodes: ui.selection.nodes, edges: list },
      );
    },
    [],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<RelationFlowEdge>[]) => applySelectChanges(changes, 'edges'),
    [applySelectChanges],
  );

  // --- Guías inteligentes (Shift + arrastrar) ------------------------------------------------
  const [guides, setGuides] = useState<GuideLine[]>([]);
  const [dropTarget, setDropTarget] = useState<Id | null>(null);

  const onNodesChange = useCallback(
    (changes: NodeChange<AegonNode>[]) => {
      // El marco (boundary) se calcula, no se mide ni se edita.
      changes = changes.filter((c) => !('id' in c) || !c.id.startsWith(BOUNDARY_PREFIX));
      if (!changes.length) return;
      let effective = changes;
      const moving = changes.filter(
        (c): c is NodePositionChange => c.type === 'position' && !!c.dragging && !!c.position,
      );
      if (moving.length === 1 && shiftRef.current) {
        const change = moving[0]!;
        const current = nodesRef.current;
        const rects = absoluteRects(current);
        const node = current.find((n) => n.id === change.id);
        const parentAbs = node?.parentId ? rects.get(node.parentId) : undefined;
        const own = rects.get(change.id);
        if (node && own && change.position) {
          const absPos = {
            x: change.position.x + (parentAbs?.x ?? 0),
            y: change.position.y + (parentAbs?.y ?? 0),
          };
          const others = current
            .filter(
              (n) =>
                n.id !== change.id &&
                n.type !== 'boundary' &&
                !isDescendant(current, n.id, change.id),
            )
            .map((n) => rects.get(n.id)!);
          const { dx, dy, lines } = computeGuides({ ...own, ...absPos }, others, 6 / rf.getZoom());
          setGuides(lines);
          effective = changes.map((c) =>
            c === change
              ? { ...change, position: { x: change.position!.x + dx, y: change.position!.y + dy } }
              : c,
          );
        }
      } else if (
        guides.length &&
        (moving.length || changes.some((c) => c.type === 'position' && !c.dragging))
      ) {
        // Se soltó Shift o terminó el arrastre (otros cambios, como la selección, no las borran).
        setGuides([]);
      }

      applySelectChanges(effective, 'nodes');
      const next = applyNodeChanges(effective, nodesRef.current);
      const geometryChanged = effective.some(
        (c) => c.type === 'position' || c.type === 'dimensions',
      );
      setNodes(geometryChanged ? withBoundary(next) : next);

      // Grupo destino al arrastrar (resalta el marco donde caería).
      if (moving.length) {
        const rects = absoluteRects(next);
        const first = rects.get(moving[0]!.id);
        const draggedEl = useWorkspace.getState().model.elements[moving[0]!.id];
        if (first && draggedEl) {
          const c = { x: first.x + first.w / 2, y: first.y + first.h / 2 };
          let best: { id: Id; area: number } | null = null;
          for (const n of next) {
            if (
              n.type !== frameTypeFor(draggedEl) ||
              moving.some((m) => m.id === n.id || isDescendant(next, n.id, m.id))
            )
              continue;
            const r = rects.get(n.id)!;
            if (contains(r, c) && (!best || r.w * r.h < best.area))
              best = { id: n.id, area: r.w * r.h };
          }
          setDropTarget(best?.id ?? null);
        }
      }

      if (effective.some((c) => c.type === 'dimensions' && c.resizing === false && c.setAttributes))
        commitLayout([]);
    },
    [shiftRef, rf, guides.length, withBoundary, setNodes, commitLayout, applySelectChanges],
  );

  const onNodeDragStop = useCallback(
    (_e: MouseEvent | TouchEvent, _node: AegonNode, dragged: AegonNode[]) => {
      setGuides([]);
      setDropTarget(null);
      commitLayout(dragged);
    },
    [commitLayout],
  );

  // --- Fantasma (doble click) ------------------------------------------------------------------
  const openGhost = useCallback(
    (clientX: number, clientY: number, extra: { connectFrom?: Id; kind?: ElementKind } = {}) => {
      const bounds = shellRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const flow = rf.screenToFlowPosition({ x: clientX, y: clientY });
      useUi.getState().setGhost({
        screen: { x: clientX - bounds.left, y: clientY - bounds.top },
        flow,
        ...extra,
      });
    },
    [rf],
  );

  const onDoubleClick = useCallback(
    (e: ReactMouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.classList.contains('react-flow__pane')) return;
      openGhost(e.clientX, e.clientY);
    },
    [openGhost],
  );

  const onNodeDoubleClick = useCallback(async (e: ReactMouseEvent, node: Node) => {
    // En el interior de un marco (nodo de despliegue o grupo) se crea adentro; en su encabezado, se renombra.
    if ((node.type === 'deployment' || node.type === 'group') && !(e.target as HTMLElement).closest('.c4-deploy__head, .c4-group__label')) {
      openGhost(e.clientX, e.clientY);
      return;
    }
    // Una instancia lleva a lo que despliega (su contenedor en el lienzo de contenedores).
    const el = (node.data as { element?: Element }).element;
    if (el?.kind === 'instance') {
      revealElement(el.instance.of);
      return;
    }
    if (node.type === 'element' && (node.data as { canDrill?: boolean }).canDrill) {
      await canvasApi.zoomToNode(node.id);
      drillInto(node.id);
      return;
    }
    if (node.type !== 'boundary') {
      useUi.getState().select([node.id]);
      useUi.getState().requestRename();
    }
  }, [openGhost]);

  // --- Conexiones ---------------------------------------------------------------------------
  const onConnect = useCallback((c: Connection) => {
    if (c.source && c.target) connect(c.source, c.target);
  }, []);

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid || !state.fromNode) return;
      const point = 'changedTouches' in event ? event.changedTouches[0]! : event;
      const hit = document
        .elementFromPoint(point.clientX, point.clientY)
        ?.closest('.react-flow__node');
      const hitId = hit?.getAttribute('data-id');
      if (
        hitId &&
        hitId !== state.fromNode.id &&
        !hitId.startsWith(BOUNDARY_PREFIX) &&
        !hit?.classList.contains('react-flow__node-group')
      ) {
        connect(state.fromNode.id, hitId);
        return;
      }
      if (
        hit &&
        !hit.classList.contains('react-flow__node-group') &&
        !hit.classList.contains('react-flow__node-boundary')
      )
        return;
      openGhost(point.clientX, point.clientY, { connectFrom: state.fromNode.id });
    },
    [openGhost],
  );

  // --- Arrastrar desde el explorador ----------------------------------------------------------
  const onDragOver = useCallback((e: DragEvent) => {
    if (e.dataTransfer.types.includes(DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'link';
    }
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      const id = e.dataTransfer.getData(DRAG_MIME);
      if (!id) return;
      e.preventDefault();
      placeExisting(id, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    },
    [rf],
  );

  // --- Menú contextual ------------------------------------------------------------------------
  const [ctx, setCtx] = useState<ContextTarget>({
    type: 'pane',
    flow: { x: 0, y: 0 },
    client: { x: 0, y: 0 },
  });
  const ctxAt = (e: ReactMouseEvent | MouseEvent) => ({
    flow: rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }),
    client: { x: e.clientX, y: e.clientY },
  });

  // --- API del lienzo y encuadre al cambiar de vista -------------------------------------------
  useEffect(() => {
    canvasApi.zoomToNode = async (id) => {
      const n = rf.getInternalNode(id);
      if (!n) return;
      const w = n.measured.width ?? 0;
      const h = n.measured.height ?? 0;
      await rf.setCenter(
        n.internals.positionAbsolute.x + w / 2,
        n.internals.positionAbsolute.y + h / 2,
        {
          zoom: Math.max(rf.getZoom() * 1.8, 1.4),
          duration: 240,
        },
      );
    };
    canvasApi.fit = () => void rf.fitView({ padding: 0.18, duration: 320, maxZoom: 1.2 });
    canvasApi.viewportCenter = () => {
      const b = shellRef.current?.getBoundingClientRect();
      return b
        ? rf.screenToFlowPosition({ x: b.left + b.width / 2, y: b.top + b.height / 2 })
        : { x: 0, y: 0 };
    };
    canvasApi.reveal = (ids) => {
      // Un frame después: los nodos recién agregados todavía no están en ReactFlow.
      requestAnimationFrame(() => {
        const b = shellRef.current?.getBoundingClientRect();
        const present = ids.filter((id) => rf.getInternalNode(id));
        if (!b || !present.length) return;
        const box = rf.getNodesBounds(present);
        // Margen para las reglas y la barra inferior.
        const tl = rf.screenToFlowPosition({ x: b.left + 48, y: b.top + 48 });
        const br = rf.screenToFlowPosition({ x: b.right - 48, y: b.bottom - 96 });
        const visible =
          box.x >= tl.x && box.y >= tl.y && box.x + box.width <= br.x && box.y + box.height <= br.y;
        if (!visible)
          void rf.setCenter(box.x + box.width / 2, box.y + box.height / 2, {
            zoom: rf.getZoom(),
            duration: 320,
          });
      });
    };
    canvasApi.animateTo = (targets) =>
      new Promise<void>((resolve) => {
        const start = nodesRef.current;
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        // Con muchos nodos, interpolar cuadro a cuadro cuesta más de lo que aporta: se salta.
        if (!Object.keys(targets).length || start.length > 600 || reduced) return resolve();
        const from = absoluteRects(start);
        const to = new Map<string, { x: number; y: number; w: number; h: number }>();
        for (const [id, r] of from) {
          const t = targets[id];
          to.set(id, t ? { x: t.x, y: t.y, w: t.w ?? r.w, h: t.h ?? r.h } : r);
        }
        const t0 = performance.now();
        const duration = 380;
        const step = (now: number) => {
          const k = 1 - Math.pow(1 - Math.min(1, (now - t0) / duration), 3);
          const abs = new Map<string, { x: number; y: number; w: number; h: number }>();
          for (const [id, f] of to) {
            const s = from.get(id)!;
            abs.set(id, {
              x: s.x + (f.x - s.x) * k,
              y: s.y + (f.y - s.y) * k,
              w: s.w + (f.w - s.w) * k,
              h: s.h + (f.h - s.h) * k,
            });
          }
          const next = nodesRef.current.map((n): AegonNode => {
            const a = n.type === 'boundary' ? undefined : abs.get(n.id);
            if (!a) return n;
            const p = n.parentId ? abs.get(n.parentId) : undefined;
            const position = { x: a.x - (p?.x ?? 0), y: a.y - (p?.y ?? 0) };
            return n.type === 'group' || n.type === 'deployment'
              ? ({ ...n, position, width: a.w, height: a.h } as AegonNode)
              : ({ ...n, position } as AegonNode);
          });
          setNodes(withBoundaryRef.current(next));
          if (k < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
    canvasApi.focusArea = (ids, opts) => {
      const shell = shellRef.current;
      const present = ids.filter((id) => rf.getInternalNode(id));
      if (!shell || !present.length) return;
      const { top = 0, right = 0, bottom = 0, left = 0 } = opts.insets ?? {};
      const width = Math.max(240, shell.clientWidth - left - right);
      const height = Math.max(180, shell.clientHeight - top - bottom);
      const vp = getViewportForBounds(rf.getNodesBounds(present), width, height, 0.12, opts.maxZoom ?? 1.25, opts.padding ?? 0.2);
      void rf.setViewport({ x: vp.x + left, y: vp.y + top, zoom: vp.zoom }, { duration: opts.duration ?? 600 });
    };
    canvasApi.centerOnPoint = (x, y) => void rf.setCenter(x, y, { zoom: Math.max(rf.getZoom(), 0.85), duration: 320 });
    canvasApi.screenToFlow = (x, y) => rf.screenToFlowPosition({ x, y });
    canvasApi.centerOn = (id) => {
      const n = rf.getInternalNode(id);
      if (!n) return;
      const w = n.measured.width ?? 0;
      const h = n.measured.height ?? 0;
      void rf.setCenter(
        n.internals.positionAbsolute.x + w / 2,
        n.internals.positionAbsolute.y + h / 2,
        {
          zoom: Math.max(rf.getZoom(), 0.7),
          duration: 280,
        },
      );
    };
    canvasApi.zoomIn = () => void rf.zoomIn({ duration: 180 });
    canvasApi.zoomOut = () => void rf.zoomOut({ duration: 180 });
    canvasApi.zoomReset = () => void rf.zoomTo(1, { duration: 220 });
    // "Agregar" (deck, N): el fantasma va al lugar libre más cercano al centro de la vista, sin
    // pisar elementos ni quedar bajo el deck. Si no hay lugar, al centro.
    canvasApi.ghostAtCenter = (kind) => {
      const b = shellRef.current?.getBoundingClientRect();
      if (!b) return;
      const zoom = rf.getZoom();
      const size = sizeOf({ kind: kind ?? 'system' });
      const w = size.w * zoom;
      const h = size.h * zoom;
      const gap = Math.max(12, 32 * zoom);
      const taken = rf
        .getNodes()
        .filter((n) => n.type === 'element')
        .map((n) => {
          const i = rf.getInternalNode(n.id);
          const p = rf.flowToScreenPosition(i?.internals.positionAbsolute ?? n.position);
          return { x: p.x, y: p.y, w: (i?.measured.width ?? 0) * zoom, h: (i?.measured.height ?? 0) * zoom };
        });
      const free = (cx: number, cy: number) =>
        cx - w / 2 >= b.left + 48 &&
        cx + w / 2 <= b.right - 48 &&
        cy - h / 2 >= b.top + 48 &&
        cy + h / 2 <= b.bottom - 96 &&
        taken.every((r) => cx + w / 2 + gap <= r.x || cx - w / 2 - gap >= r.x + r.w || cy + h / 2 + gap <= r.y || cy - h / 2 - gap >= r.y + r.h);
      // Mejor si además entra el menú al costado (así no tapa el fantasma).
      const besidePanel = (cx: number) => cx + w / 2 + 14 + GHOST_PANEL_WIDTH <= b.right - 12 || cx - w / 2 - 14 - GHOST_PANEL_WIDTH >= b.left + 12;
      const c = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      const STEP = 24;
      const nearest = (ok: (x: number, y: number) => boolean) => {
        for (let ring = 0; ring <= 40; ring++) {
          let best: { x: number; y: number; d: number } | null = null;
          for (let dx = -ring; dx <= ring; dx++) {
            for (let dy = -ring; dy <= ring; dy++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
              const x = c.x + dx * STEP;
              const y = c.y + dy * STEP;
              const d = Math.hypot(dx, dy);
              if ((!best || d < best.d) && ok(x, y)) best = { x, y, d };
            }
          }
          if (best) return best;
        }
        return null;
      };
      const spot = nearest((x, y) => free(x, y) && besidePanel(x)) ?? nearest(free) ?? c;
      openGhost(spot.x, spot.y, kind ? { kind } : {});
    };
  }, [rf, openGhost]);

  // Espacio = mano: mientras se mantiene, arrastrar mueve la vista aunque se empiece sobre un nodo
  // o una flecha (canvas.css les saca los eventos del mouse con `data-space`).
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const editable = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
    };
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || editable(e.target)) return;
      // Con el mouse sobre el lienzo, el espacio es la mano: no activa el botón que tenga el foco.
      if (shell.matches(':hover')) e.preventDefault();
      shell.setAttribute('data-space', '');
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') shell.removeAttribute('data-space');
    };
    const reset = () => shell.removeAttribute('data-space');
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', reset);
    };
  }, [viewId]);

  // Mientras se mueve la vista, los nodos no reciben hover (ver canvas.css).
  const onMoveStart = useCallback(() => shellRef.current?.setAttribute('data-moving', ''), []);
  const onMoveEnd = useCallback(() => shellRef.current?.removeAttribute('data-moving'), []);

  const framedView = useRef<string | null>(null);
  const isEmptyView = !!view && Object.keys(view.nodes).length === 0;
  // Encuadrar recién cuando ReactFlow midió los nodos: antes, fitView se encola y se aplica tarde.
  const nodesInitialized = useNodesInitialized();
  useEffect(() => {
    // Un lienzo vacío no tiene nada que encuadrar: queda listo enseguida (se decide por el lienzo,
    // no por `nodes`, que en el primer render todavía puede traer los del lienzo anterior).
    if (viewId && isEmptyView) {
      if (framedView.current !== `${viewId}:${focusId ?? ''}`) {
        framedView.current = `${viewId}:${focusId ?? ''}`;
        shellRef.current?.setAttribute('data-framed', viewId);
      }
      return;
    }
    if (
      !viewId ||
      !nodes.length ||
      !nodesInitialized ||
      framedView.current === `${viewId}:${focusId ?? ''}`
    )
      return;
    framedView.current = `${viewId}:${focusId ?? ''}`;
    requestAnimationFrame(() => {
      const target = focusId ? rf.getInternalNode(focusId) : undefined;
      let framing: Promise<unknown>;
      if (target) {
        const w = target.measured.width ?? target.width ?? 0;
        const h = target.measured.height ?? target.height ?? 0;
        framing = rf.setCenter(
          target.internals.positionAbsolute.x + w / 2,
          target.internals.positionAbsolute.y + h / 2,
          {
            zoom: Math.min(Math.max(rf.getZoom(), 0.8), 1.1),
            duration: transition === 'out' ? 0 : 300,
          },
        );
      } else {
        // fitView es asíncrono en ReactFlow 12: espera a que los nodos estén medidos.
        framing = rf.fitView({ padding: 0.18, maxZoom: 1.1, duration: 0 });
      }
      // Señal para tests y automatizaciones: encuadrado y con la animación de entrada terminada.
      void framing.then(() =>
        setTimeout(() => shellRef.current?.setAttribute('data-framed', viewId), 300),
      );
    });
  }, [viewId, focusId, nodes.length, nodesInitialized, rf, transition, isEmptyView]);

  useEffect(() => {
    if (!viewId) framedView.current = null;
  }, [viewId]);

  const [lodName, lodScale] = lod.split(':');
  const isEmpty = !!view && Object.keys(view.nodes).length === 0;

  return (
    <div
      ref={shellRef}
      className="canvas-shell relative h-full w-full overflow-hidden"
      data-transition={nodes.length < 400 ? (transition ?? undefined) : undefined}
      key={viewId ?? 'none'}
      onDoubleClick={onDoubleClick}
      onDragOver={onDragOver}
      onDrop={onDrop}
      data-testid="canvas"
    >
      <CanvasContextMenu target={ctx} onOpenGhost={(x, y) => openGhost(x, y)}>
        <LodContext.Provider value={lodName as Lod}>
          <ReactFlow<AegonNode, RelationFlowEdge>
            onMoveStart={onMoveStart}
            onMoveEnd={onMoveEnd}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onNodeDragStop={onNodeDragStop}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            onNodeDoubleClick={onNodeDoubleClick}
            onNodeContextMenu={(e, n) => {
              if (n.type === 'boundary') return setCtx({ type: 'pane', ...ctxAt(e) });
              if (!n.selected) useUi.getState().select([n.id]);
              setCtx({ type: 'node', id: n.id, ...ctxAt(e) });
            }}
            onEdgeContextMenu={(e, edge) => {
              useUi.getState().select([], [edge.id]);
              setCtx({ type: 'edge', id: edge.id, ...ctxAt(e) });
            }}
            onPaneContextMenu={(e) => setCtx({ type: 'pane', ...ctxAt(e) })}
            onSelectionContextMenu={(e) => setCtx({ type: 'selection', ...ctxAt(e) })}
            connectionMode={ConnectionMode.Loose}
            connectionRadius={28}
            colorMode={theme}
            zoomOnDoubleClick={false}
            deleteKeyCode={null}
            selectionKeyCode={null}
            multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
            selectionOnDrag
            panOnDrag={[1]}
            panActivationKeyCode="Space"
            panOnScroll
            zoomOnPinch
            selectionMode={SelectionMode.Partial}
            snapToGrid={snap && !shift}
            snapGrid={[16, 16]}
            minZoom={0.08}
            maxZoom={2.5}
            onlyRenderVisibleElements
            elevateNodesOnSelect={false}
            fitView={false}
            proOptions={{ hideAttribution: false }}
            attributionPosition="bottom-left"
            data-lod={lodName}
            style={{ ['--lod-scale' as string]: lodScale }}
          >
            {grid !== 'none' ? (
              <Background
                id="grid"
                variant={grid === 'dots' ? BackgroundVariant.Dots : BackgroundVariant.Lines}
                gap={grid === 'dots' ? 16 : 32}
                size={grid === 'dots' ? 1.3 : 1}
                color={grid === 'dots' ? 'var(--canvas-dot)' : 'var(--canvas-line)'}
              />
            ) : null}
            <ViewportPortal>
              {/* Dentro del viewport: así las flechas viajan con la imagen al exportar. */}
              <EdgeMarkers />
              <GuideLines guides={guides} />
            </ViewportPortal>
            <SelectionToolbar />
            <DropTargetMarker id={dropTarget} />
            {view ? <FlowOverlay view={view} /> : null}
            {view ? <CommentsLayer view={view} /> : null}
          </ReactFlow>
        </LodContext.Provider>
      </CanvasContextMenu>
      {rulers && !presenting ? <Rulers /> : null}
      {isEmpty ? <EmptyHint level={view.level} /> : null}
      {ghost && view ? <GhostPicker ghost={ghost} view={view} /> : null}
      {view && !presenting ? <CanvasHighlight view={view} edges={edges} /> : null}
      {view && !presenting ? <CanvasSearch view={view} /> : null}
      {view && !presenting ? <CostChip view={view} /> : null}
      {view ? <CommentPlacer view={view} /> : null}
      <StepPicker />
      <FlowPlayer />
      {!presenting ? <CanvasDock /> : null}
      {!presenting ? <CanvasNav nodeColor={minimapColor} /> : null}
    </div>
  );
}

/** Guías de alineación: líneas de 1 px en pantalla (su grosor depende del zoom). */
function GuideLines({ guides }: { guides: GuideLine[] }) {
  const zoom = useStore((s) => s.transform[2]);
  return guides.map((g, i) =>
    g.orientation === 'v' ? (
      <div
        key={i}
        className="guide-line"
        style={{ left: g.at, top: g.from, width: 1 / zoom, height: g.to - g.from }}
      />
    ) : (
      <div
        key={i}
        className="guide-line"
        style={{ top: g.at, left: g.from, height: 1 / zoom, width: g.to - g.from }}
      />
    ),
  );
}

function isDescendant(nodes: readonly Node[], id: string, ancestor: string): boolean {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let current = byId.get(id)?.parentId;
  let guard = 0;
  while (current && guard++ < 50) {
    if (current === ancestor) return true;
    current = byId.get(current)?.parentId;
  }
  return false;
}

/** Tipo de marco donde puede caer un elemento: nodos de despliegue o grupos. */
function frameTypeFor(el: Element): 'group' | 'deployment' {
  return el.kind === 'node' || el.kind === 'infra' || el.kind === 'instance' ? 'deployment' : 'group';
}

/** Marca el marco donde caerá el nodo arrastrado (atributo en el DOM, sin re-render de nodos). */
function DropTargetMarker({ id }: { id: Id | null }) {
  useEffect(() => {
    if (!id) return;
    const el = document.querySelector(`[data-frame-id="${CSS.escape(id)}"]`);
    el?.setAttribute('data-drop-target', '');
    return () => el?.removeAttribute('data-drop-target');
  }, [id]);
  return null;
}
