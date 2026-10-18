import type { Model } from '../model/index.ts';
import type { Element, Id, View } from '../schema/index.ts';
import { OpError } from '../ops/index.ts';
import { viewEdges } from '../ops/commands.ts';
import { aliasMap, edgeLabel, frameView, isExternalDeep, protocolsText, techText, viewsToExport } from './shared.ts';

/**
 * Exporta lienzos a C4-PlantUML (biblioteca estándar `<C4/...>` de PlantUML). Cada lienzo es un
 * bloque `@startuml … @enduml`; PlantUML acepta varios en el mismo archivo.
 */

const str = (s: string | undefined) => `"${(s ?? '').replace(/"/g, "'").replace(/\r?\n/g, ' ')}"`;

/** Nivel C4 del elemento según su padre (una base de un container es de nivel componente). */
function c4Tier(model: Model, el: Element): 'system' | 'container' | 'component' {
  if (el.kind === 'component') return 'component';
  if (el.kind === 'container') return 'container';
  const parent = el.parent ? model.elements[el.parent] : undefined;
  if (!parent) return 'system';
  return parent.kind === 'container' ? 'component' : 'container';
}

function macro(model: Model, el: Element): string {
  const ext = isExternalDeep(model, el) ? '_Ext' : '';
  if (el.kind === 'actor') return `Person${ext}`;
  const tier = c4Tier(model, el);
  const base = tier === 'system' ? 'System' : tier === 'container' ? 'Container' : 'Component';
  const suffix = el.kind === 'store' ? 'Db' : el.kind === 'bus' ? 'Queue' : '';
  return `${base}${suffix}${ext}`;
}

function elementLine(model: Model, el: Element, alias: string): string {
  const m = macro(model, el);
  const description = el.kind === 'actor' ? (el.description ?? el.role) : el.description;
  // System(alias, label, descr) · Container/Component(alias, label, techn, descr)
  if (m.startsWith('Person') || m.startsWith('System')) return `${m}(${alias}, ${str(el.name)}, ${str(description)})`;
  return `${m}(${alias}, ${str(el.name)}, ${str(techText(el))}, ${str(description)})`;
}

export function viewToPlantUml(model: Model, view: View, aliases = aliasMap(model)): string {
  const a = (id: Id) => aliases.get(id)!;
  // C4_Component incluye todo (una base de un sistema puede aparecer en un lienzo L1).
  const lines = [`@startuml ${view.id}`, '!include <C4/C4_Component>', '', `title ${view.name.replace(/\r?\n/g, ' ')}`, ''];
  lines.push('AddRelTag("implicita", $lineStyle = DashedLine())', '');
  const framed = frameView(model, view);

  if (framed.scope) {
    const boundary = framed.scope.element.kind === 'container' ? 'Container_Boundary' : 'System_Boundary';
    lines.push(`${boundary}(${a(framed.scope.element.id)}, ${str(framed.scope.element.name)}) {`);
    for (const el of framed.scope.members) lines.push(`  ${elementLine(model, el, a(el.id))}`);
    lines.push('}');
  }
  for (const g of framed.groups) {
    const provider = g.element.kind === 'group' ? g.element.group.provider : '';
    lines.push(`Boundary(${a(g.element.id)}, ${str(g.element.name)}, ${str(provider)}) {`);
    for (const el of g.members) lines.push(`  ${elementLine(model, el, a(el.id))}`);
    lines.push('}');
  }
  for (const el of framed.loose) lines.push(elementLine(model, el, a(el.id)));

  const edges = viewEdges(model, view);
  if (edges.length) lines.push('');
  for (const edge of edges) {
    const fn = edge.bidirectional ? 'BiRel' : 'Rel';
    const tags = edge.implied ? ', $tags="implicita"' : '';
    lines.push(`${fn}(${a(edge.from)}, ${a(edge.to)}, ${str(edgeLabel(edge))}, ${str(protocolsText(edge.relations))}${tags})`);
  }
  lines.push('', '@enduml');
  return `${lines.join('\n')}\n`;
}

export function toPlantUml(model: Model, viewId?: Id): string {
  const views = viewsToExport(model, viewId);
  if (!views.length) throw new OpError('no-views', 'El workspace no tiene lienzos para exportar');
  const aliases = aliasMap(model);
  return views.map((v) => viewToPlantUml(model, v, aliases)).join('\n');
}
