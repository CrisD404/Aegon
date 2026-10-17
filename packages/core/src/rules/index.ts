import { ancestorsOf, hasParentCycle, indexOf, sortedValues, type Model } from '../model/index.ts';
import type { Element, Id, View } from '../schema/index.ts';
import {
  KINDS_FOR_LEVEL,
  PARENT_KINDS,
  SCOPE_KIND_FOR_LEVEL,
  canHaveParent,
} from './hierarchy.ts';

export * from './hierarchy.ts';

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  /** Entidad afectada. */
  entity?: { type: 'element' | 'relation' | 'view' | 'workspace'; id: Id };
  /** Archivo de origen (lo completa el parser de YAML). */
  file?: string;
}

/** ¿Se puede ubicar este elemento en este lienzo? Devuelve el motivo si no. */
export function placementProblem(model: Model, view: View, el: Element): string | null {
  if (!KINDS_FOR_LEVEL[view.level].includes(el.kind)) {
    return `Un ${el.kind} no se puede ubicar en un lienzo de nivel ${view.level}`;
  }
  if (view.scope && el.id === view.scope) {
    return 'El elemento abierto ya es el marco del lienzo';
  }
  if (view.scope && ancestorsOf(model, view.scope).some((a) => a.id === el.id)) {
    return 'No se puede ubicar un ancestro del elemento abierto';
  }
  return null;
}

/** Elementos candidatos para agregar a un lienzo (los que todavía no están en él). */
export function placeableElements(model: Model, view: View): Element[] {
  return sortedValues(model.elements).filter(
    (el) => !view.nodes[el.id] && placementProblem(model, view, el) === null,
  );
}

/** Valida integridad referencial y reglas C4 de todo el modelo. */
export function validateModel(model: Model): Diagnostic[] {
  const out: Diagnostic[] = [];
  const idx = indexOf(model);

  for (const el of sortedValues(model.elements)) {
    const entity = { type: 'element' as const, id: el.id };
    if (el.parent) {
      const parent = model.elements[el.parent];
      if (!parent) {
        out.push({ severity: 'error', code: 'missing-parent', message: `"${el.name}" apunta a un padre inexistente "${el.parent}"`, entity });
      } else if (!canHaveParent(el.kind, parent.kind)) {
        out.push({ severity: 'error', code: 'invalid-parent', message: `Un ${el.kind} no puede estar dentro de un ${parent.kind} ("${el.name}")`, entity });
      }
      if (hasParentCycle(model, el.id)) {
        out.push({ severity: 'error', code: 'parent-cycle', message: `"${el.name}" forma un ciclo de padres`, entity });
      }
    } else if (el.kind === 'container' || el.kind === 'component') {
      const expected = PARENT_KINDS[el.kind].join(' o ');
      out.push({ severity: 'warning', code: 'orphan-child', message: `El ${el.kind} "${el.name}" no pertenece a ningún ${expected}`, entity });
    }
    for (const g of el.groups ?? []) {
      const group = model.elements[g];
      if (!group) out.push({ severity: 'error', code: 'missing-group', message: `"${el.name}" apunta a un grupo inexistente "${g}"`, entity });
      else if (group.kind !== 'group') out.push({ severity: 'error', code: 'invalid-group', message: `"${g}" no es un grupo`, entity });
    }
    if (!idx.viewsContaining.get(el.id)?.length && !idx.viewsByScope.get(el.id)?.length) {
      out.push({ severity: 'info', code: 'not-in-view', message: `"${el.name}" no aparece en ningún lienzo`, entity });
    }
  }

  const pairs = new Map<string, Id>();
  for (const rel of sortedValues(model.relations)) {
    const entity = { type: 'relation' as const, id: rel.id };
    const pair = [rel.from, rel.to].sort().join('|');
    const first = pairs.get(pair);
    if (first) {
      out.push({ severity: 'warning', code: 'duplicate-relation', message: `"${rel.id}" repite la relación "${first}": en C4 hay una sola por par (usá direction: bidirectional)`, entity });
    } else pairs.set(pair, rel.id);
    const from = model.elements[rel.from];
    const to = model.elements[rel.to];
    if (!from) out.push({ severity: 'error', code: 'missing-endpoint', message: `La relación "${rel.id}" sale de "${rel.from}", que no existe`, entity });
    if (!to) out.push({ severity: 'error', code: 'missing-endpoint', message: `La relación "${rel.id}" llega a "${rel.to}", que no existe`, entity });
    if (from && to && rel.from === rel.to) {
      out.push({ severity: 'warning', code: 'self-relation', message: `"${from.name}" se relaciona consigo mismo`, entity });
    }
    if (from && to && (from.kind === 'group' || to.kind === 'group')) {
      out.push({ severity: 'error', code: 'group-relation', message: `Los grupos no pueden tener relaciones ("${rel.id}")`, entity });
    }
  }

  for (const view of sortedValues(model.views)) {
    const entity = { type: 'view' as const, id: view.id };
    const scopeKind = SCOPE_KIND_FOR_LEVEL[view.level];
    if (scopeKind && !view.scope) {
      out.push({ severity: 'error', code: 'missing-scope', message: `El lienzo L${view.level} "${view.name}" necesita un ${scopeKind}`, entity });
    }
    if (view.scope) {
      const scope = model.elements[view.scope];
      if (!scope) out.push({ severity: 'error', code: 'missing-scope', message: `El lienzo "${view.name}" abre "${view.scope}", que no existe`, entity });
      else if (scopeKind && scope.kind !== scopeKind) {
        out.push({ severity: 'error', code: 'invalid-scope', message: `Un lienzo L${view.level} abre un ${scopeKind}, no un ${scope.kind}`, entity });
      }
    }
    for (const nodeId of Object.keys(view.nodes)) {
      const el = model.elements[nodeId];
      if (!el) {
        out.push({ severity: 'error', code: 'missing-node', message: `El lienzo "${view.name}" ubica "${nodeId}", que no existe`, entity });
        continue;
      }
      const problem = placementProblem(model, view, el);
      if (problem) out.push({ severity: 'warning', code: 'invalid-placement', message: `${problem} ("${el.name}" en "${view.name}")`, entity });
    }
  }

  if (model.workspace.defaultView && !model.views[model.workspace.defaultView]) {
    out.push({ severity: 'warning', code: 'missing-default-view', message: `El lienzo por defecto "${model.workspace.defaultView}" no existe`, entity: { type: 'workspace', id: model.workspace.id } });
  }
  return out;
}
