import type { Model } from '../model/index.ts';
import type { Element, Id, View } from '../schema/index.ts';
import { OpError } from '../ops/index.ts';
import { KIND_LABEL, viewEdges } from '../ops/commands.ts';
import { aliasMap, edgeLabel, frameView, isExternalDeep, protocolsText, techText, viewsToExport } from './shared.ts';

/**
 * Exporta lienzos como diagramas de flujo de Mermaid (`flowchart`), que renderizan GitHub,
 * GitLab y la mayoría de los visores de Markdown. Un lienzo → un diagrama; varios → un Markdown
 * con un bloque ```mermaid por lienzo.
 */

const RESERVED = new Set(['end', 'graph', 'flowchart', 'subgraph', 'style', 'class', 'classdef', 'click', 'linkstyle', 'direction', 'default']);

const text = (s: string) => s.replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;').replace(/\r?\n/g, ' ');

function nodeLabel(el: Element): string {
  const tech = techText(el);
  const kind = tech ? `${KIND_LABEL[el.kind]}: ${tech}` : KIND_LABEL[el.kind];
  const parts = [`<b>${text(el.name)}</b>`, `[${text(kind)}]`];
  if (el.description) parts.push(`<small>${text(el.description)}</small>`);
  return parts.join('<br/>');
}

function nodeShape(el: Element, alias: string): string {
  const label = nodeLabel(el);
  switch (el.kind) {
    case 'actor':
      return `${alias}(["${label}"])`;
    case 'store':
      return `${alias}[("${label}")]`;
    case 'bus':
      return `${alias}[["${label}"]]`;
    default:
      return `${alias}["${label}"]`;
  }
}

export function viewToMermaid(model: Model, view: View, aliases = aliasMap(model, RESERVED)): string {
  const a = (id: Id) => aliases.get(id)!;
  const lines = ['---', `title: ${view.name.replace(/\r?\n/g, ' ')}`, '---', 'flowchart TB'];
  const framed = frameView(model, view);
  const node = (el: Element, indent: string) => lines.push(`${indent}${nodeShape(el, a(el.id))}`);

  if (framed.scope) {
    lines.push(`  subgraph ${a(framed.scope.element.id)}["${text(framed.scope.element.name)} · ${KIND_LABEL[framed.scope.element.kind]}"]`);
    for (const el of framed.scope.members) node(el, '    ');
    lines.push('  end');
  }
  for (const g of framed.groups) {
    lines.push(`  subgraph ${a(g.element.id)}["${text(g.element.name)}"]`);
    for (const el of g.members) node(el, '    ');
    lines.push('  end');
  }
  for (const el of framed.loose) node(el, '  ');

  const linkStyles: number[] = [];
  viewEdges(model, view).forEach((edge, i) => {
    const label = edgeLabel(edge);
    const protocols = protocolsText(edge.relations);
    const full = [label && text(label), protocols && `[${text(protocols)}]`].filter(Boolean).join('<br/>');
    const arrow = edge.implied ? (edge.bidirectional ? '<-.->' : '-.->') : edge.bidirectional ? '<-->' : '-->';
    lines.push(`  ${a(edge.from)} ${arrow}${full ? `|"${full}"|` : ''} ${a(edge.to)}`);
    if (edge.relations.some((r) => r.status === 'planned')) linkStyles.push(i);
  });

  const external = Object.keys(view.nodes)
    .map((id) => model.elements[id])
    .filter((el): el is Element => !!el && el.kind !== 'group' && isExternalDeep(model, el))
    .map((el) => a(el.id))
    .sort();
  lines.push('  classDef external fill:#e5e7eb,stroke:#6b7280,color:#111827');
  if (external.length) lines.push(`  class ${external.join(',')} external`);
  if (linkStyles.length) lines.push(`  linkStyle ${linkStyles.join(',')} stroke-dasharray: 6 4`);
  return `${lines.join('\n')}\n`;
}

export function toMermaid(model: Model, viewId?: Id): string {
  const views = viewsToExport(model, viewId);
  if (!views.length) throw new OpError('no-views', 'El workspace no tiene lienzos para exportar');
  const aliases = aliasMap(model, RESERVED);
  if (viewId || views.length === 1) return viewToMermaid(model, views[0]!, aliases);
  const parts = [`# ${model.workspace.name}`, ''];
  if (model.workspace.description) parts.push(model.workspace.description, '');
  for (const view of views) {
    parts.push(`## ${view.name}`, '');
    if (view.description) parts.push(view.description, '');
    parts.push('```mermaid', viewToMermaid(model, view, aliases).trimEnd(), '```', '');
  }
  return parts.join('\n');
}
