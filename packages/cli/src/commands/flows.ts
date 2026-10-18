import { flowToText, sortedValues } from '@aegon/core';
import { commentBrief, findFlow, flowBrief, flowDetail, listComments, type CommentFilter } from '../flows.ts';
import { formatDiagnostic, json, plural, type Io } from '../io.ts';
import type { Workspace } from '../workspace.ts';

/** `aegon flows`: lista los flujos del workspace. */
export function flows(io: Io, ws: Workspace, opts: { element?: string; json: boolean }): number {
  let items = sortedValues(ws.model.flows ?? {}).map(flowBrief);
  if (opts.element) {
    const id = ws.element(opts.element).id;
    items = items.filter((f) => f.elements.includes(id));
  }
  if (opts.json) {
    json(io, { total: items.length, flows: items });
    return 0;
  }
  if (!items.length) {
    io.stdout(opts.element ? 'Ningún flujo pasa por ese elemento\n' : 'Sin flujos. Se crean en la app o con el servidor MCP (create_flow).\n');
    return 0;
  }
  const width = Math.max(...items.map((f) => f.id.length));
  for (const f of items) {
    const where = f.view ? ` · lienzo ${f.view}` : '';
    io.stdout(`${f.id.padEnd(width)}  ${f.name} (${plural(f.steps, 'paso', 'pasos')}${where})\n`);
  }
  return 0;
}

/** `aegon flow <id>`: el flujo como texto, con los pasos numerados como en la app. */
export function flow(io: Io, ws: Workspace, ref: string, opts: { json: boolean }): number {
  const f = findFlow(ws.model, ref);
  const detail = flowDetail(ws.model, f);
  if (opts.json) {
    json(io, { ...detail, file: ws.fileOf('flow', f.id) ?? null });
    return 0;
  }
  io.stdout(flowToText(ws.model, f));
  if (detail.diagnostics.length) {
    io.stdout('\n');
    for (const d of detail.diagnostics) io.stdout(`${formatDiagnostic(d)}\n`);
  }
  return 0;
}

const day = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : iso);
const indent = (text: string, pad: string) => text.replace(/\n/g, `\n${pad}`);

/** `aegon comments`: comentarios de los lienzos con sus respuestas. */
export function comments(io: Io, ws: Workspace, filter: CommentFilter, opts: { json: boolean }): number {
  const items = listComments(ws.model, filter).map((c) => commentBrief(ws.model, c));
  const open = items.filter((c) => !c.resolved).length;
  if (opts.json) {
    json(io, { total: items.length, open, resolved: items.length - open, comments: items });
    return 0;
  }
  for (const c of items) {
    const where = `${c.viewName ?? c.view}${c.element ? ` › ${c.elementName ?? c.element}` : ''}`;
    io.stdout(`${c.resolved ? '✓' : '○'} ${c.id}  ${where}\n`);
    if (c.title) io.stdout(`  ${c.title}\n`);
    io.stdout(`  ${c.author}, ${day(c.at)}: ${indent(c.body, '    ')}\n`);
    for (const r of c.replies) io.stdout(`    ↳ ${r.author}, ${day(r.at)}: ${indent(r.body, '      ')}\n`);
  }
  const summary = `${plural(items.length, 'comentario', 'comentarios')} · ${plural(open, 'abierto', 'abiertos')} · ${plural(items.length - open, 'resuelto', 'resueltos')}`;
  io.stdout(`${items.length ? '\n' : ''}${summary}\n`);
  return 0;
}
