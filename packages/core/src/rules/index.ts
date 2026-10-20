import { ancestorsOf, hasParentCycle, indexOf, sortedValues, type Model } from '../model/index.ts';
import { INSTANCE_OF_KINDS, type Element, type FlowStep, type Id, type LeafStep, type View } from '../schema/index.ts';
import {
  KINDS_FOR_LEVEL,
  PARENT_KINDS,
  SCOPE_KIND_FOR_LEVEL,
  canHaveParent,
  levelLabel,
} from './hierarchy.ts';

export * from './hierarchy.ts';

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  /** Entidad afectada. */
  entity?: { type: 'element' | 'relation' | 'view' | 'workspace' | 'flow' | 'comment'; id: Id };
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
  if (view.level === 'deployment' && view.environment && el.environments && !el.environments.includes(view.environment)) {
    return `"${el.name}" no está desplegado en el ambiente de este lienzo`;
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
    } else if (el.kind === 'instance') {
      out.push({ severity: 'warning', code: 'orphan-instance', message: `La instancia "${el.name}" no está en ningún nodo de despliegue`, entity });
    }
    if (el.kind === 'instance') {
      const target = model.elements[el.instance.of];
      if (!target) out.push({ severity: 'error', code: 'missing-instance-target', message: `La instancia "${el.name}" despliega "${el.instance.of}", que no existe`, entity });
      else if (!(INSTANCE_OF_KINDS as readonly string[]).includes(target.kind)) {
        out.push({ severity: 'error', code: 'invalid-instance-target', message: `Una instancia despliega un contenedor, base, bus o sistema, no un ${target.kind} ("${el.name}")`, entity });
      }
    }
    // Un elemento de despliegue no puede valer para ambientes en los que su nodo no está.
    const host = el.parent ? model.elements[el.parent] : undefined;
    if (host?.kind === 'node' && host.environments && (!el.environments || el.environments.some((e) => !host.environments!.includes(e)))) {
      out.push({ severity: 'warning', code: 'environment-mismatch', message: `"${el.name}" está en ambientes donde su nodo "${host.name}" no existe`, entity });
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
    if (from && to && from.environments && to.environments && !from.environments.some((e) => to.environments!.includes(e))) {
      out.push({ severity: 'warning', code: 'cross-environment-relation', message: `"${from.name}" y "${to.name}" no comparten ningún ambiente ("${rel.id}")`, entity });
    }
  }

  for (const view of sortedValues(model.views)) {
    const entity = { type: 'view' as const, id: view.id };
    const scopeKind = SCOPE_KIND_FOR_LEVEL[view.level];
    if (scopeKind && !view.scope) {
      out.push({ severity: 'error', code: 'missing-scope', message: `El lienzo L${view.level} "${view.name}" necesita un ${scopeKind}`, entity });
    }
    if (view.level === 'deployment') {
      if (!view.environment) out.push({ severity: 'error', code: 'missing-environment', message: `El lienzo de despliegue "${view.name}" necesita un ambiente`, entity });
      else if (!(model.workspace.environments ?? []).some((e) => e.id === view.environment)) {
        out.push({ severity: 'warning', code: 'unknown-environment', message: `El lienzo "${view.name}" muestra el ambiente "${view.environment}", que no está definido en el workspace`, entity });
      }
      if (view.scope && model.elements[view.scope] && model.elements[view.scope]!.kind !== 'system') {
        out.push({ severity: 'error', code: 'invalid-scope', message: `Un lienzo de despliegue muestra un sistema, no un ${model.elements[view.scope]!.kind}`, entity });
      }
    } else if (view.environment) {
      out.push({ severity: 'warning', code: 'environment-on-c4-view', message: `Solo los lienzos de despliegue tienen ambiente ("${view.name}")`, entity });
    }
    if (view.scope) {
      const scope = model.elements[view.scope];
      if (!scope) out.push({ severity: 'error', code: 'missing-scope', message: `El lienzo "${view.name}" abre "${view.scope}", que no existe`, entity });
      else if (scopeKind && scope.kind !== scopeKind) {
        out.push({ severity: 'error', code: 'invalid-scope', message: `Un lienzo ${levelLabel(view.level)} abre un ${scopeKind}, no un ${scope.kind}`, entity });
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

  // Ambientes y costos: las referencias tienen que apuntar a ambientes del workspace.
  const wsEntity = { type: 'workspace' as const, id: model.workspace.id };
  const envIds = new Set<Id>();
  for (const env of model.workspace.environments ?? []) {
    if (envIds.has(env.id)) out.push({ severity: 'error', code: 'duplicate-environment', message: `El ambiente "${env.id}" está repetido`, entity: wsEntity });
    envIds.add(env.id);
  }
  for (const env of Object.keys(model.workspace.finops?.budgets ?? {})) {
    if (!envIds.has(env)) out.push({ severity: 'warning', code: 'unknown-environment', message: `Hay un presupuesto para "${env}", que no es un ambiente del workspace`, entity: wsEntity });
  }
  for (const el of sortedValues(model.elements)) {
    const entity = { type: 'element' as const, id: el.id };
    const refs = [...(el.environments ?? []), ...Object.keys(el.finops?.costs ?? {})];
    for (const env of new Set(refs)) {
      if (!envIds.has(env)) out.push({ severity: 'warning', code: 'unknown-environment', message: `"${el.name}" usa el ambiente "${env}", que no está definido en el workspace`, entity });
    }
    if (el.kind === 'actor' && el.finops?.costs) {
      out.push({ severity: 'warning', code: 'actor-cost', message: `Los actores no tienen costos ("${el.name}")`, entity });
    }
  }

  // Flujos: los pasos apuntan a elementos, relaciones y flujos que existan.
  for (const flow of sortedValues(model.flows ?? {})) {
    const entity = { type: 'flow' as const, id: flow.id };
    if (flow.view && !model.views[flow.view]) {
      out.push({ severity: 'warning', code: 'flow-missing-view', message: `El flujo "${flow.name}" se reproduce en "${flow.view}", que no existe`, entity });
    }
    const check = (step: FlowStep | LeafStep, label: string) => {
      const missing = (id: Id) => out.push({ severity: 'warning', code: 'flow-missing-element', message: `Paso ${label} de "${flow.name}": "${id}" no existe`, entity });
      if (step.type === 'message') {
        for (const id of [step.from, step.to]) if (!model.elements[id]) missing(id);
        if (step.relation && !model.relations[step.relation]) missing(step.relation);
      } else if (step.type === 'process') {
        if (!model.elements[step.element]) missing(step.element);
      } else if (step.type === 'goto') {
        if (!model.flows?.[step.flow]) missing(step.flow);
        else if (step.flow === flow.id) out.push({ severity: 'warning', code: 'flow-self-goto', message: `Paso ${label} de "${flow.name}": va al mismo flujo`, entity });
      } else if (step.type === 'paths') {
        step.paths.forEach((path, p) => path.steps.forEach((s, j) => check(s, `${label}${String.fromCharCode(65 + p)}.${j + 1}`)));
      }
    };
    flow.steps.forEach((step, i) => check(step, String(i + 1)));
  }
  for (const comment of sortedValues(model.comments ?? {})) {
    const entity = { type: 'comment' as const, id: comment.id };
    if (!model.views[comment.view]) {
      out.push({ severity: 'warning', code: 'comment-missing-view', message: `Un comentario está en el lienzo "${comment.view}", que no existe`, entity });
    }
    if (comment.element && !model.elements[comment.element]) {
      out.push({ severity: 'info', code: 'comment-missing-element', message: `Un comentario estaba anclado a "${comment.element}", que ya no existe`, entity });
    }
  }

  if (model.workspace.defaultView && !model.views[model.workspace.defaultView]) {
    out.push({ severity: 'warning', code: 'missing-default-view', message: `El lienzo por defecto "${model.workspace.defaultView}" no existe`, entity: { type: 'workspace', id: model.workspace.id } });
  }
  return out;
}
