import { childViewOf, sortedValues, type Id, type Model, type View } from '@aegon/core';
import { useUi } from '../store/ui.ts';
import { defaultViewOf, useWorkspace } from '../store/workspace.ts';
import { openNewDeploymentView } from './flows.tsx';

/**
 * Modos de trabajo: qué se está haciendo sobre el mismo modelo. **Diseñar** es el modelo lógico
 * (contexto, contenedores, componentes), **Desplegar** es dónde corre cada parte en un ambiente,
 * **Simular** es cuánto tráfico aguanta y **Costos** es cuánto cuesta. Diseñar y Desplegar salen
 * del lienzo activo (un lienzo de despliegue es el modo Desplegar); Simular y Costos son una
 * mirada sobre el lienzo que esté abierto.
 */
export type Mode = 'design' | 'deploy' | 'simulate' | 'costs';

/** Último lienzo visto en cada modo, para volver al mismo lugar al cambiar de modo. */
const last: { design: Id | null; deploy: Id | null } = { design: null, deploy: null };

function remember(model: Model, viewId: Id | null) {
  const view = viewId ? model.views[viewId] : undefined;
  if (view) last[view.level === 'deployment' ? 'deploy' : 'design'] = view.id;
}

useUi.subscribe((s, prev) => {
  if (s.activeViewId !== prev.activeViewId) remember(useWorkspace.getState().model, s.activeViewId);
});

export function useMode(): Mode {
  const costs = useUi((s) => s.costOverlay);
  const simulate = useUi((s) => s.simulate);
  const viewId = useUi((s) => s.activeViewId);
  const deployment = useWorkspace((s) => (viewId ? s.model.views[viewId]?.level === 'deployment' : false));
  return simulate ? 'simulate' : costs ? 'costs' : deployment ? 'deploy' : 'design';
}

/** Sistema del que trata lo que se está mirando: el seleccionado, o el del lienzo abierto. */
function systemInFocus(model: Model, view: View | undefined): Id | undefined {
  const ui = useUi.getState();
  const selected = ui.selection.nodes.length === 1 ? model.elements[ui.selection.nodes[0]!] : undefined;
  if (selected?.kind === 'system' && selected.scope !== 'external') return selected.id;
  let scope = view?.scope ? model.elements[view.scope] : undefined;
  while (scope && scope.kind !== 'system') scope = scope.parent ? model.elements[scope.parent] : undefined;
  return scope?.kind === 'system' && scope.scope !== 'external' ? scope.id : undefined;
}

export function goToMode(mode: Mode) {
  const ui = useUi.getState();
  const model = useWorkspace.getState().model;
  const view = ui.activeViewId ? model.views[ui.activeViewId] : undefined;
  remember(model, ui.activeViewId);

  // Simular y Costos son miradas: una a la vez, sobre el lienzo que esté abierto.
  if (mode === 'costs' || mode === 'simulate') {
    if (ui.simulate !== (mode === 'simulate')) ui.setPref('simulate', mode === 'simulate');
    if (ui.costOverlay !== (mode === 'costs')) ui.setPref('costOverlay', mode === 'costs');
    ui.setRightTab(mode === 'costs' ? 'costs' : 'load');
    return;
  }
  if (ui.costOverlay) ui.setPref('costOverlay', false);
  if (ui.simulate) ui.setPref('simulate', false);
  // El panel de carga es del modo Simular: al salir, vuelve el inspector.
  if (ui.rightTab === 'load') useUi.setState({ rightTab: 'inspector' });

  if (mode === 'design') {
    if (view && view.level !== 'deployment') return;
    // De vuelta al diseño: el último lienzo lógico, o el de contenedores del sistema desplegado.
    const back = last.design && model.views[last.design] ? last.design : undefined;
    const ofSystem = view?.scope ? childViewOf(model, view.scope)?.id : undefined;
    const target = back ?? ofSystem ?? sortedValues(model.views).find((v) => v.level !== 'deployment')?.id ?? defaultViewOf(model);
    if (target) ui.openView(target, { transition: 'fade', focus: view?.scope && model.views[target]?.nodes[view.scope] ? view.scope : null });
    return;
  }

  if (view?.level === 'deployment') return;
  // Al despliegue del sistema en foco; si no tiene, al último que se vio; si no hay ninguno, a crearlo.
  const system = systemInFocus(model, view);
  const deployments = sortedValues(model.views).filter((v) => v.level === 'deployment');
  const order = (model.workspace.environments ?? []).map((e) => e.id);
  const rank = (v: View) => (v.environment ? order.indexOf(v.environment) : -1);
  const ofSystem = deployments.filter((v) => system && v.scope === system).sort((a, b) => rank(b) - rank(a));
  const remembered = last.deploy ? model.views[last.deploy] : undefined;
  const target =
    (remembered && (!system || remembered.scope === system) ? remembered : undefined) ??
    ofSystem[0] ??
    (system ? undefined : (remembered ?? deployments.sort((a, b) => rank(b) - rank(a))[0]));
  if (target) ui.openView(target.id, { transition: 'fade' });
  else void openNewDeploymentView(system);
}
