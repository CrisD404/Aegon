import { useMemo } from 'react';
import { ViewportPortal, useStore, type InternalNode } from '@xyflow/react';
import {
  flowFrames,
  frameElements,
  representativeInView,
  stepElements,
  stepLabel,
  type Flow,
  type FlowStep,
  type Id,
  type LeafStep,
  type Model,
  type View,
} from '@aegon/core';
import { useUi, type StepPath } from '../store/ui.ts';
import { useWorkspace } from '../store/workspace.ts';
import { playerGo, selectStep } from '../lib/flow-actions.ts';
import { STEP_STYLE } from '../panels/FlowsPanel.tsx';

type MarkerState = 'idle' | 'selected' | 'past' | 'current';

interface Marked {
  key: string;
  label: string;
  step: LeafStep;
  state: MarkerState;
  onClick: () => void;
}

type Rect = { x: number; y: number; w: number; h: number; cx: number; cy: number };

function rectOf(n: InternalNode | undefined): Rect | null {
  if (!n) return null;
  const w = n.measured.width ?? n.width ?? 0;
  const h = n.measured.height ?? n.height ?? 0;
  const { x, y } = n.internals.positionAbsolute;
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

/** Punto del borde del rectángulo en dirección a `to`. */
function borderPoint(r: Rect, to: { x: number; y: number }, gap = 0) {
  const dx = to.x - r.cx;
  const dy = to.y - r.cy;
  if (!dx && !dy) return { x: r.cx, y: r.cy };
  const scale = Math.min(
    (r.w / 2 + gap) / Math.abs(dx || 1e-9),
    (r.h / 2 + gap) / Math.abs(dy || 1e-9),
  );
  return { x: r.cx + dx * scale, y: r.cy + dy * scale };
}

const byId = (ids: Iterable<string>) =>
  [...ids].map((id) => `[data-id="${CSS.escape(id)}"]`).join(',');

/** Todos los pasos (con caminos) y su ruta, para el editor. */
function allSteps(flow: Flow): { step: LeafStep; path: StepPath; label: string }[] {
  const out: { step: LeafStep; path: StepPath; label: string }[] = [];
  flow.steps.forEach((s: FlowStep, i) => {
    if (s.type !== 'paths') out.push({ step: s, path: [i], label: stepLabel(i) });
    else
      s.paths.forEach((p, pi) =>
        p.steps.forEach((inner, j) =>
          out.push({ step: inner, path: [i, pi, j], label: stepLabel(i, pi, j) }),
        ),
      );
  });
  return out;
}

/** Representante en el lienzo de cada extremo de un paso (null si no se puede mostrar). */
function endpoints(model: Model, view: View, step: LeafStep): { a: Id; b: Id | null } | null {
  if (step.type === 'message') {
    const a = representativeInView(model, view, step.from);
    const b = representativeInView(model, view, step.to);
    return a && b && a !== b ? { a, b } : null;
  }
  if (step.type === 'process') {
    const a = representativeInView(model, view, step.element);
    return a ? { a, b: null } : null;
  }
  return null;
}

/**
 * Pasos del flujo dibujados sobre el lienzo: en edición, un marcador numerado por paso (click =
 * seleccionarlo); al reproducir, el rastro de los pasos ya vistos, el actual resaltado (con su
 * relación animada en el sentido del mensaje) y el resto atenuado.
 */
export function FlowOverlay({ view }: { view: View }) {
  const model = useWorkspace((s) => s.model);
  const edit = useUi((s) => s.flowEdit);
  const player = useUi((s) => s.player);
  const flowId = player?.flow ?? edit?.id;
  const flow = flowId ? model.flows?.[flowId] : undefined;
  const zoom = useStore((s) => s.transform[2]);
  const lookup = useStore((s) => s.nodeLookup);
  const rfEdges = useStore((s) => s.edges);

  const { marks, frameIndex, frames } = useMemo(() => {
    if (!flow) return { marks: [] as Marked[], frameIndex: 0, frames: [] };
    if (player) {
      const frames = flowFrames(flow, player.choices);
      const marks: Marked[] = [];
      frames.forEach((f, i) => {
        const visible = player.index < 0 || player.index >= frames.length || i <= player.index;
        if (!visible || f.kind === 'paths') return;
        for (const s of f.steps) {
          marks.push({
            key: `${f.key}:${s.label}`,
            label: s.label,
            step: s.step,
            state: i === player.index ? 'current' : 'past',
            onClick: () => playerGo(i),
          });
        }
      });
      return { marks, frameIndex: player.index, frames };
    }
    const marks = allSteps(flow).map(({ step, path, label }) => ({
      key: path.join('-'),
      label,
      step,
      state: (edit?.step && edit.step.join('-') === path.join('-')
        ? 'selected'
        : 'idle') as MarkerState,
      onClick: () => selectStep(flow.id, path),
    }));
    return { marks, frameIndex: 0, frames: [] };
  }, [flow, player, edit]);

  if (!flow) return null;

  // Geometría de cada marcador en este lienzo.
  type Point = { x: number; y: number };
  type Placed = {
    m: Marked;
    ends: { a: Id; b: Id | null };
    at: Point;
    line: { p1: Point; p2: Point } | null;
  };
  const placed = marks.flatMap((m): Placed[] => {
    const ends = endpoints(model, view, m.step);
    if (!ends) return [];
    const ra = rectOf(lookup.get(ends.a));
    if (!ra) return [];
    if (!ends.b) return [{ m, ends, at: { x: ra.x, y: ra.y }, line: null }];
    const rb = rectOf(lookup.get(ends.b));
    if (!rb) return [];
    const p1 = borderPoint(ra, { x: rb.cx, y: rb.cy }, 4);
    const p2 = borderPoint(rb, { x: ra.cx, y: ra.cy }, 8);
    const t = 0.3;
    return [
      {
        m,
        ends,
        at: { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t },
        line: { p1, p2 },
      },
    ];
  });

  // Estilos: resaltado (y, al reproducir, atenuado del resto).
  const focusMarks = placed.filter((p) => p.m.state === 'current' || p.m.state === 'selected');
  const focusNodes = new Set(
    focusMarks.flatMap((p) => [p.ends.a, ...(p.ends.b ? [p.ends.b] : [])]),
  );
  const edgeFor = (a: Id, b: Id) =>
    rfEdges.find((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a));
  const rules: string[] = [];
  const scope = '.canvas-shell';
  const ring = `${scope} :is(${byId(focusNodes)}) .c4-node { border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft), 0 12px 32px color-mix(in srgb, var(--accent) 22%, transparent); }`;
  if (player) {
    const intro = frameIndex < 0 || frameIndex >= frames.length;
    const flowNodes = new Set(
      (intro
        ? frames.flatMap(frameElements)
        : frames.slice(0, frameIndex + 1).flatMap(frameElements)
      )
        .map((id) => representativeInView(model, view, id))
        .filter((x): x is Id => !!x),
    );
    rules.push(`${scope} .react-flow__node-element { opacity: 0.13; }`);
    rules.push(
      `${scope} :is(.react-flow__node-group, .react-flow__node-boundary) { opacity: 0.45; }`,
    );
    if (flowNodes.size)
      rules.push(
        `${scope} .react-flow__node-element:is(${byId(flowNodes)}) { opacity: ${intro ? 1 : 0.5}; }`,
      );
    if (focusNodes.size) {
      rules.push(`${scope} .react-flow__node-element:is(${byId(focusNodes)}) { opacity: 1; }`);
      rules.push(ring);
    }
    rules.push(`${scope} .react-flow__edge, ${scope} .c4-edge-label { opacity: 0.06; }`);
    const past = placed
      .filter((p) => p.ends.b && (p.m.state === 'past' || intro))
      .map((p) => edgeFor(p.ends.a, p.ends.b!)?.id)
      .filter((x): x is string => !!x);
    if (past.length)
      rules.push(
        `${scope} .react-flow__edge:is(${byId(past)}) { opacity: ${intro ? 0.85 : 0.45}; }`,
      );
    for (const p of focusMarks) {
      if (!p.ends.b) continue;
      const edge = edgeFor(p.ends.a, p.ends.b);
      if (!edge) continue;
      const id = CSS.escape(edge.id);
      const forward = edge.source === p.ends.a;
      rules.push(`${scope} .react-flow__edge[data-id="${id}"] { opacity: 1; }`);
      rules.push(
        `${scope} [data-testid="edge-label-${id}"] { opacity: 1; border-color: var(--accent-ring); }`,
      );
      rules.push(
        `${scope} .react-flow__edge[data-id="${id}"] .c4-edge-path { stroke: var(--accent); stroke-width: 2.5; stroke-dasharray: 7 6; animation: aegon-flow 0.7s linear infinite ${forward ? 'normal' : 'reverse'}; }`,
      );
    }
  } else if (focusNodes.size) {
    rules.push(ring);
  }

  // Mensajes sin relación visible en el lienzo: flecha temporal.
  const arrows = focusMarks.filter((p) => p.line && p.ends.b && !edgeFor(p.ends.a, p.ends.b));
  const scale = 1 / zoom;

  return (
    <>
      <style data-testid="flow-overlay-style">{rules.join('\n')}</style>
      <ViewportPortal>
        {arrows.map((p) => {
          const { p1, p2 } = p.line!;
          const x = Math.min(p1.x, p2.x) - 20;
          const y = Math.min(p1.y, p2.y) - 20;
          return (
            <svg
              key={`arrow-${p.m.key}`}
              className="pointer-events-none absolute overflow-visible"
              style={{ left: x, top: y, width: 1, height: 1 }}
              aria-hidden
            >
              <defs>
                <marker
                  id={`flow-arrow-${p.m.key}`}
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
                </marker>
              </defs>
              <line
                x1={p1.x - x}
                y1={p1.y - y}
                x2={p2.x - x}
                y2={p2.y - y}
                stroke="var(--accent)"
                strokeWidth={2.5}
                strokeDasharray="7 6"
                className="flow-temp-arrow"
                markerEnd={`url(#flow-arrow-${p.m.key})`}
              />
            </svg>
          );
        })}
        {placed.map((p) => (
          <button
            key={p.m.key}
            type="button"
            className="flow-marker"
            data-state={p.m.state}
            style={{
              left: p.at.x,
              top: p.at.y,
              transform: `translate(-50%, -50%) scale(${scale})`,
              ['--step-color' as string]: STEP_STYLE[p.m.step.type].color,
            }}
            onClick={(e) => {
              e.stopPropagation();
              p.m.onClick();
            }}
            title={`Paso ${p.m.label}`}
            data-testid={`flow-marker-${p.m.label}`}
          >
            {p.m.label}
          </button>
        ))}
      </ViewportPortal>
    </>
  );
}

/** Elementos de los pasos de un flujo (para encuadrar la portada). */
export function flowElementIds(flow: Flow): Id[] {
  return [...new Set(flow.steps.flatMap((s) => stepElements(s)))];
}
