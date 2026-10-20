import { ancestorsOf, sortedValues, type Model } from '../model/index.ts';
import type { Element, Id, Relation, View } from '../schema/index.ts';
import { findBroker, findEngine, findTechnology, relationTechnology } from '../catalog/index.ts';
import { OpError } from '../ops/index.ts';
import { levelRank } from '../rules/hierarchy.ts';
import type { ViewEdge } from '../ops/commands.ts';

/** Identificadores seguros para otros lenguajes (`[A-Za-z0-9_]`, sin empezar con número), únicos. */
export function aliasMap(model: Model, reserved: ReadonlySet<string> = new Set()): Map<Id, string> {
  const out = new Map<Id, string>();
  const taken = new Set<string>();
  for (const el of sortedValues(model.elements)) {
    let base = el.id.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+(?=.)/, '');
    if (!base || /^[0-9]/.test(base)) base = `e_${base}`;
    if (reserved.has(base.toLowerCase())) base = `${base}_`;
    let alias = base;
    for (let n = 2; taken.has(alias); n++) alias = `${base}_${n}`;
    taken.add(alias);
    out.set(el.id, alias);
  }
  return out;
}

/** Externo si el elemento o alguno de sus ancestros es externo (los containers de un sistema externo). */
export function isExternalDeep(model: Model, el: Element): boolean {
  return el.scope === 'external' || ancestorsOf(model, el.id).some((a) => a.scope === 'external');
}

/** Tecnología para mostrar: lenguajes/frameworks, motor de la base o broker del bus. */
export function techText(el: Element): string {
  if (el.kind === 'store') {
    const name = el.store.engine === 'other' ? (el.store.customEngine ?? '') : (findEngine(el.store.engine)?.name ?? el.store.engine);
    return [name, el.store.version].filter(Boolean).join(' ');
  }
  if (el.kind === 'bus') {
    return el.bus.broker === 'other' ? (el.bus.customBroker ?? '') : (findBroker(el.bus.broker)?.name ?? el.bus.broker);
  }
  if ('technology' in el && el.technology?.length) {
    return el.technology.map((t) => findTechnology(t)?.name ?? t).join(', ');
  }
  return '';
}

export function protocolsText(relations: readonly Relation[]): string {
  return [...new Set(relations.map((r) => relationTechnology(r)).filter(Boolean))].join(', ');
}

/** Etiqueta de una relación del lienzo; las implícitas resumen las relaciones que agrupan. */
export function edgeLabel(edge: ViewEdge): string {
  const labels = [...new Set(edge.relations.map((r) => r.label).filter((l): l is string => !!l))];
  if (!edge.implied) return labels[0] ?? '';
  if (labels.length <= 2) return labels.join(' / ');
  return `${labels.slice(0, 2).join(' / ')} +${labels.length - 2}`;
}

/** Lienzos a exportar: uno (si se pide) o todos, con el lienzo por defecto primero. */
export function viewsToExport(model: Model, viewId?: Id): View[] {
  if (viewId) {
    const view = model.views[viewId];
    if (!view) throw new OpError('not-found', `No existe el lienzo "${viewId}"`);
    return [view];
  }
  const views = sortedValues(model.views).sort((a, b) => levelRank(a.level) - levelRank(b.level) || a.id.localeCompare(b.id));
  const first = model.workspace.defaultView;
  return first ? [...views.filter((v) => v.id === first), ...views.filter((v) => v.id !== first)] : views;
}

/**
 * Elementos de un lienzo agrupados para dibujarlos dentro de marcos: el elemento abierto
 * (scope) envuelve a sus descendientes ubicados; los grupos ubicados envuelven al resto de sus
 * miembros. Devuelve también los que quedan sueltos.
 */
export interface Framed {
  scope?: { element: Element; members: Element[] };
  groups: { element: Element; members: Element[] }[];
  loose: Element[];
}

export function frameView(model: Model, view: View): Framed {
  const placed = Object.keys(view.nodes)
    .map((id) => model.elements[id])
    .filter((el): el is Element => !!el)
    .sort((a, b) => a.id.localeCompare(b.id));
  const groupIds = new Set(placed.filter((el) => el.kind === 'group').map((el) => el.id));
  const scopeEl = view.scope ? model.elements[view.scope] : undefined;
  const inScope = (el: Element) => !!scopeEl && ancestorsOf(model, el.id).some((a) => a.id === scopeEl.id);

  const framed: Framed = { groups: [], loose: [] };
  if (scopeEl) framed.scope = { element: scopeEl, members: [] };
  const byGroup = new Map<Id, Element[]>();
  for (const el of placed) {
    if (el.kind === 'group') continue;
    if (framed.scope && inScope(el)) {
      framed.scope.members.push(el);
      continue;
    }
    const group = el.groups?.find((g) => groupIds.has(g));
    if (group) byGroup.set(group, [...(byGroup.get(group) ?? []), el]);
    else framed.loose.push(el);
  }
  for (const el of placed) {
    if (el.kind !== 'group') continue;
    const members = byGroup.get(el.id);
    if (members?.length) framed.groups.push({ element: el, members });
  }
  return framed;
}

/** Árbol de un lienzo de despliegue: cada elemento ubicado bajo su nodo ubicado más cercano. */
export interface DeploymentTreeNode {
  element: Element;
  children: DeploymentTreeNode[];
}

export function deploymentTree(model: Model, view: View): DeploymentTreeNode[] {
  const placed = Object.keys(view.nodes)
    .map((id) => model.elements[id])
    .filter((el): el is Element => !!el)
    .sort((a, b) => a.id.localeCompare(b.id));
  const nodes = new Map<Id, DeploymentTreeNode>(placed.map((el) => [el.id, { element: el, children: [] }]));
  const roots: DeploymentTreeNode[] = [];
  for (const el of placed) {
    const host = ancestorsOf(model, el.id).find((a) => nodes.has(a.id) && a.kind === 'node');
    (host ? nodes.get(host.id)!.children : roots).push(nodes.get(el.id)!);
  }
  return roots;
}

/** Texto de los detalles de despliegue (direcciones, recurso, tamaño). */
export function deploymentDetails(el: Element): string {
  const parts: string[] = [];
  if (el.kind === 'node') {
    if (el.node.size) parts.push(el.node.size);
    if (el.node.instances && el.node.instances > 1) parts.push(`x${el.node.instances}`);
  }
  if (el.kind === 'instance' && el.instance.replicas && el.instance.replicas > 1) parts.push(`x${el.instance.replicas}`);
  if ('addresses' in el && el.addresses?.length) parts.push(el.addresses.join(', '));
  if ('resource' in el && el.resource) parts.push(el.resource);
  return parts.join(' · ');
}
