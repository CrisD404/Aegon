import { useMemo } from 'react';
import { deployedIn, type View } from '@aegon/core';
import { useUi } from '../store/ui.ts';
import { useWorkspace } from '../store/workspace.ts';
import type { RelationFlowEdge } from './derive.ts';
import { focusSet, searchMatches } from './search.ts';

const byId = (ids: Iterable<string>) =>
  [...ids].map((id) => `[data-id="${CSS.escape(id)}"]`).join(',');
const labels = (ids: Iterable<string>) =>
  [...ids].map((id) => `[data-testid="edge-label-${CSS.escape(id)}"]`).join(',');

/**
 * Resaltado del lienzo con una hoja de estilos generada (sin re-renderizar nodos): la búsqueda
 * marca las coincidencias y el modo foco atenúa todo lo que no es dependencia directa de la
 * selección. La búsqueda abierta tiene prioridad.
 */
export function CanvasHighlight({
  view,
  edges,
}: {
  view: View;
  edges: readonly RelationFlowEdge[];
}) {
  const model = useWorkspace((s) => s.model);
  const focusMode = useUi((s) => s.focusMode);
  const selected = useUi((s) => s.selection.nodes);
  const search = useUi((s) => s.search);
  const costOverlay = useUi((s) => s.costOverlay);
  const costEnv = useUi((s) => s.costEnv);

  const css = useMemo(() => {
    const scope = '.canvas-shell';
    // Capa de costos con un ambiente elegido: lo que no está desplegado ahí queda atenuado.
    const envRules: string[] = [];
    if (costOverlay && costEnv && model.workspace.environments?.some((e) => e.id === costEnv)) {
      const absent = Object.keys(view.nodes).filter((id) => {
        const el = model.elements[id];
        return el && el.kind !== 'group' && el.kind !== 'actor' && !deployedIn(el, costEnv);
      });
      if (absent.length) {
        envRules.push(`${scope} .react-flow__node-element:is(${byId(absent)}) { opacity: 0.3; }`);
        envRules.push(`${scope} :is(${byId(absent)}) .c4-node { border-style: dashed; }`);
      }
    }
    const withEnv = (rules: string) => [rules, ...envRules].filter(Boolean).join('\n');
    if (search.open && search.query.trim()) {
      const matches = searchMatches(model, view, search.query);
      if (!matches.length) return withEnv('');
      const current = matches[Math.min(search.index, matches.length - 1)]!;
      return withEnv(
        [
          `${scope} .react-flow__node-element:not(:is(${byId(matches)})) { opacity: 0.22; }`,
          `${scope} .react-flow__edge, ${scope} .c4-edge-label { opacity: 0.15; }`,
          `${scope} :is(${byId(matches)}) .c4-node { outline: 2px solid var(--warn); outline-offset: 3px; }`,
          `${scope} [data-id="${CSS.escape(current)}"] .c4-node { outline: 3px solid var(--accent); outline-offset: 3px; }`,
        ].join('\n'),
      );
    }
    if (focusMode && selected.length) {
      const keep = focusSet(selected, edges);
      const rules = [
        `${scope} .react-flow__node-element:not(:is(${byId(keep.nodes)})) { opacity: 0.16; }`,
      ];
      if (keep.edges.size) {
        rules.push(`${scope} .react-flow__edge:not(:is(${byId(keep.edges)})) { opacity: 0.07; }`);
        rules.push(`${scope} .c4-edge-label:not(:is(${labels(keep.edges)})) { opacity: 0.1; }`);
      } else {
        rules.push(`${scope} .react-flow__edge, ${scope} .c4-edge-label { opacity: 0.07; }`);
      }
      return withEnv(rules.join('\n'));
    }
    return withEnv('');
  }, [model, view, edges, focusMode, selected, search, costOverlay, costEnv]);

  return css ? <style data-testid="canvas-highlight">{css}</style> : null;
}
