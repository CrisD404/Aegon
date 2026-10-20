import type { ElementKind, Level } from '../schema/index.ts';

/** Qué tipos pueden ser padre de cada tipo de elemento en la jerarquía C4. */
export const PARENT_KINDS: Readonly<Record<ElementKind, readonly ElementKind[]>> = {
  actor: [],
  system: [],
  container: ['system'],
  component: ['container'],
  store: ['system', 'container'],
  bus: ['system'],
  group: ['group'],
  // Despliegue: todo cuelga de nodos (datacenter > clúster > namespace…).
  node: ['node'],
  infra: ['node'],
  instance: ['node'],
};

export function canHaveParent(child: ElementKind, parent: ElementKind): boolean {
  return PARENT_KINDS[child].includes(parent);
}

/** Tipo de elemento que se "abre" en cada nivel (scope de la vista). */
export const SCOPE_KIND_FOR_LEVEL: Readonly<Record<Level, ElementKind | null>> = {
  1: null,
  2: 'system',
  3: 'container',
  // Opcional: el sistema cuyo despliegue se muestra.
  deployment: null,
};

/** Nivel de la vista de detalle de un elemento (doble click), si tiene. */
export function childLevelOf(kind: ElementKind): Level | null {
  if (kind === 'system') return 2;
  if (kind === 'container') return 3;
  return null;
}

/**
 * Tipos que se pueden ubicar en un lienzo de cada nivel. El primero de cada lista es el
 * "protagonista" del nivel (lo que se crea por defecto).
 */
export const KINDS_FOR_LEVEL: Readonly<Record<Level, readonly ElementKind[]>> = {
  1: ['system', 'actor', 'store', 'bus', 'group'],
  2: ['container', 'store', 'bus', 'system', 'actor', 'group'],
  3: ['component', 'container', 'store', 'bus', 'system', 'actor', 'group'],
  // Los sistemas externos (un proveedor de identidad, un SaaS) se ubican directo, sin instancia.
  deployment: ['instance', 'node', 'infra', 'actor', 'system'],
};

/** Tipos que se crean *dentro* del scope de la vista (heredan `parent`). */
export const SCOPED_KINDS_FOR_LEVEL: Readonly<Record<Level, readonly ElementKind[]>> = {
  1: [],
  2: ['container', 'store', 'bus'],
  3: ['component'],
  deployment: [],
};

/** Etiqueta corta del nivel ("L2", "Despliegue"). */
export function levelLabel(level: Level): string {
  return level === 'deployment' ? 'Despliegue' : `L${level}`;
}

/** Orden para listar y navegar: L1, L2, L3 y después despliegue. */
export function levelRank(level: Level): number {
  return level === 'deployment' ? 4 : level;
}
