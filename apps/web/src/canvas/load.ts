import { create } from 'zustand';
import { isProductionEnvironment, type Id, type LoadNode, type LoadResult, type Model, type View } from '@aegon/core';

/**
 * Resultado de la simulación de carga que muestra el lienzo con el modo Simular activo. Cada nodo
 * se suscribe a su propia entrada: al mover el tráfico solo cambian los que cambian de valor.
 */
interface LoadOverlayState {
  result: LoadResult | null;
  /** Instancias del lienzo → lo que despliegan (se pintan con la carga de ese elemento). */
  alias: Readonly<Record<Id, Id>>;
}

export const useLoadOverlay = create<LoadOverlayState>(() => ({ result: null, alias: {} }));

/** Carga del nodo con la simulación activa (`undefined` si está apagada o no le llega tráfico). */
export function useNodeLoad(id: Id): LoadNode | undefined {
  return useLoadOverlay((s) => (s.result ? s.result.nodes[s.alias[id] ?? id] : undefined));
}

/** Sistema que se simula en un lienzo: el del lienzo (o el del contenedor abierto); en contexto, todo. */
export function loadScope(model: Model, view: View): Id | undefined {
  let scope = view.scope ? model.elements[view.scope] : undefined;
  while (scope && scope.kind !== 'system') scope = scope.parent ? model.elements[scope.parent] : undefined;
  return scope?.id;
}

/** Ambiente por defecto para simular: el productivo (es donde importa cuánto aguanta). */
export function defaultLoadEnvironment(model: Model): Id | undefined {
  const envs = model.workspace.environments ?? [];
  return envs.find((e) => isProductionEnvironment(model, e.id))?.id ?? envs[envs.length - 1]?.id;
}

const number = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

/** "1.250" o "12 mil": pedidos por segundo en pocas cifras. */
export function rpsText(rps: number): string {
  if (!Number.isFinite(rps)) return '∞';
  if (rps >= 100_000) return `${number.format(Math.round(rps / 1000))} mil`;
  if (rps >= 100) return number.format(Math.round(rps / 10) * 10);
  return number.format(Math.round(rps));
}

/** Uso como porcentaje ("85%", "+300%" si se va de escala). */
export function usageText(utilization: number | null): string {
  if (utilization === null) return 'sin límite';
  if (!Number.isFinite(utilization) || utilization > 9.99) return '+999%';
  return `${Math.round(utilization * 100)}%`;
}

// El control de tráfico es logarítmico: de 10 a 100.000 pedidos por segundo en un solo recorrido.
const MIN_EXP = 1;
const MAX_EXP = 5;

export function sliderToRps(position: number): number {
  const raw = 10 ** (MIN_EXP + ((MAX_EXP - MIN_EXP) * position) / 100);
  // Dos cifras significativas: 1.234 → 1.200.
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(raw)) - 1);
  return Math.round(raw / magnitude) * magnitude;
}

export function rpsToSlider(rps: number): number {
  const exp = Math.log10(Math.max(10, Math.min(100_000, rps)));
  return Math.round(((exp - MIN_EXP) * 100) / (MAX_EXP - MIN_EXP));
}
