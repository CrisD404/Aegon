import { KIND_LABEL, fitFramesOp } from '@aegon/core';
import { planAddElement, planConnect, planLayout, type AddElementInput, type ConnectInput } from '../edit.ts';
import { json, planJson, planSummary, type Io } from '../io.ts';
import type { Workspace } from '../workspace.ts';

function warn(io: Io, warnings: readonly string[]) {
  for (const w of warnings) io.stderr(`! ${w}\n`);
}

/** `aegon add <kind> <nombre>` */
export async function add(io: Io, ws: Workspace, input: AddElementInput, opts: { json: boolean }): Promise<number> {
  const plan = planAddElement(ws.model, input);
  const { plan: written } = await ws.apply(plan.op);
  const element = ws.model.elements[plan.id]!;
  if (opts.json) {
    json(io, { id: plan.id, element, view: plan.view ?? null, position: plan.position ?? null, warnings: plan.warnings, ...planJson(written) });
    return 0;
  }
  warn(io, plan.warnings);
  const parent = element.parent ? ` dentro de ${element.parent}` : '';
  io.stdout(`✓ ${KIND_LABEL[element.kind]} "${element.name}" agregado (${plan.id})${parent}\n`);
  if (plan.view && plan.position) io.stdout(`  ubicado en ${plan.view} (${plan.position.x}, ${plan.position.y})\n`);
  io.stdout(`  ${planSummary(written)}\n`);
  return 0;
}

const RESULT_TEXT = {
  created: 'Relación creada',
  bidirectional: 'Relación bidireccional (ya existía en sentido contrario)',
  updated: 'Relación actualizada (ya estaban conectados)',
  exists: 'Sin cambios (ya estaban conectados)',
} as const;

/** `aegon connect <desde> <hasta>` */
export async function connect(io: Io, ws: Workspace, input: ConnectInput, opts: { json: boolean }): Promise<number> {
  const plan = planConnect(ws.model, input);
  const written = plan.op ? (await ws.apply(plan.op)).plan : null;
  const relation = ws.model.relations[plan.id]!;
  if (opts.json) {
    json(io, { result: plan.result, id: plan.id, relation, warnings: plan.warnings, suggestions: plan.suggestions, ...(written ? planJson(written) : { written: [], deleted: [] }) });
    return 0;
  }
  warn(io, plan.warnings);
  const from = ws.model.elements[relation.from]!.name;
  const to = ws.model.elements[relation.to]!.name;
  const arrow = relation.direction === 'bidirectional' ? '↔' : '→';
  io.stdout(`✓ ${RESULT_TEXT[plan.result]}: ${from} ${arrow} ${to} (${plan.id})\n`);
  if (plan.suggestions.length && !relation.protocols?.length) {
    io.stdout(`  Sin protocolo. Sugeridos para "${to}": ${plan.suggestions.join(', ')} (--protocols)\n`);
  }
  if (written) io.stdout(`  ${planSummary(written)}\n`);
  return 0;
}

/** `aegon layout <lienzo>` */
export async function layout(io: Io, ws: Workspace, viewRef: string, opts: { ids?: string[]; json: boolean; fitFrames?: boolean }): Promise<number> {
  if (opts.fitFrames) {
    const view = ws.view(viewRef);
    const op = fitFramesOp(ws.model, view.id);
    const written = op ? (await ws.apply(op)).plan : null;
    if (opts.json) json(io, { view: view.id, ...(written ? planJson(written) : { written: [], deleted: [] }) });
    else io.stdout(written ? `✓ Marcos de ${view.id} ajustados a su contenido\n  ${planSummary(written)}\n` : `✓ Los marcos de ${view.id} ya envuelven a su contenido\n`);
    return 0;
  }
  const plan = await planLayout(ws.model, viewRef, opts.ids);
  const written = plan.op ? (await ws.apply(plan.op)).plan : null;
  if (opts.json) {
    json(io, { view: plan.view, moved: plan.moved, ...(written ? planJson(written) : { written: [], deleted: [] }) });
    return 0;
  }
  if (!written) io.stdout(`✓ El lienzo ${plan.view} ya está ordenado (o tiene menos de dos elementos)\n`);
  else io.stdout(`✓ Lienzo ${plan.view} ordenado: ${plan.moved} ${plan.moved === 1 ? 'nodo movido' : 'nodos movidos'}\n  ${planSummary(written)}\n`);
  return 0;
}
