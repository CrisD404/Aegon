import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { EXPORT_FORMATS, exportModel, flowToMermaid, flowToText, sortedValues, type ExportFormat } from '@aegon/core';
import { findFlow } from '../flows.ts';
import { UsageError, type Io } from '../io.ts';
import { resolveRef, type Workspace } from '../workspace.ts';

const ALIASES: Readonly<Record<string, ExportFormat>> = {
  mermaid: 'mermaid',
  mmd: 'mermaid',
  'plantuml-c4': 'plantuml-c4',
  plantuml: 'plantuml-c4',
  puml: 'plantuml-c4',
  structurizr: 'structurizr',
  dsl: 'structurizr',
  json: 'json',
};

export function resolveFormat(format: string | undefined): ExportFormat {
  const f = format ? ALIASES[format.toLowerCase()] : undefined;
  if (!f) throw new UsageError(`${format ? `Formato desconocido "${format}"` : 'Falta el formato'}: usá ${EXPORT_FORMATS.join(', ')}`);
  return f;
}

/** `aegon export <formato>`: a la salida estándar o a un archivo (`--output`). */
export async function exportCommand(io: Io, ws: Workspace, format: string | undefined, opts: { view?: string; output?: string }): Promise<number> {
  const fmt = resolveFormat(format);
  const view = opts.view ? resolveRef(sortedValues(ws.model.views), opts.view, 'lienzo').id : undefined;
  return emit(io, exportModel(ws.model, fmt, view ? { view } : {}), opts.output);
}

const FLOW_FORMATS: Readonly<Record<string, 'mermaid' | 'text'>> = { mermaid: 'mermaid', mmd: 'mermaid', text: 'text', txt: 'text' };

/** `aegon export flow <id> <mermaid|text>`: diagrama de secuencia de Mermaid o texto numerado. */
export async function exportFlowCommand(io: Io, ws: Workspace, ref: string, format: string | undefined, opts: { output?: string }): Promise<number> {
  const fmt = format ? FLOW_FORMATS[format.toLowerCase()] : undefined;
  if (!fmt) throw new UsageError(`${format ? `Formato de flujo desconocido "${format}"` : 'Falta el formato'}: usá mermaid o text`);
  const flow = findFlow(ws.model, ref);
  return emit(io, fmt === 'mermaid' ? flowToMermaid(ws.model, flow) : flowToText(ws.model, flow), opts.output);
}

async function emit(io: Io, text: string, output: string | undefined): Promise<number> {
  if (!output) {
    io.stdout(text);
    return 0;
  }
  const target = resolve(io.cwd, output);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text, 'utf8');
  io.stderr(`✓ Exportado a ${target}\n`);
  return 0;
}
