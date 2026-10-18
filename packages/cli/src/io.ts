import type { Diagnostic } from '@aegon/core';
import type { WritePlan } from '@aegon/format-yaml';

/** Entrada/salida de la CLI: inyectable para correr los comandos en tests sin procesos nuevos. */
export interface Io {
  cwd: string;
  stdout(text: string): void;
  stderr(text: string): void;
}

export const nodeIo: Io = {
  cwd: process.cwd(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

/** Error de uso (argumentos inválidos): sale con código 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

const MARK = { error: '✗', warning: '!', info: '·' } as const;
const WORD = { error: 'error', warning: 'aviso', info: 'info' } as const;

export function formatDiagnostic(d: Diagnostic): string {
  const where = d.file ?? (d.entity ? `${d.entity.type}:${d.entity.id}` : '');
  return `${MARK[d.severity]} ${WORD[d.severity].padEnd(5)} ${where ? `${where}  ` : ''}${d.message} [${d.code}]`;
}

export function countBySeverity(diagnostics: readonly Diagnostic[]) {
  return {
    errors: diagnostics.filter((d) => d.severity === 'error').length,
    warnings: diagnostics.filter((d) => d.severity === 'warning').length,
    infos: diagnostics.filter((d) => d.severity === 'info').length,
  };
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Resumen de archivos tocados: `2 archivos escritos, 1 borrado`. */
export function planSummary(plan: WritePlan): string {
  const parts = [plural(plan.writes.size, 'archivo escrito', 'archivos escritos')];
  if (plan.deletes.length) parts.push(plural(plan.deletes.length, 'borrado', 'borrados'));
  return parts.join(', ');
}

export function planJson(plan: WritePlan) {
  return { written: [...plan.writes.keys()].sort(), deleted: [...plan.deletes] };
}

export function json(io: Io, value: unknown) {
  io.stdout(`${JSON.stringify(value, null, 2)}\n`);
}

export function list(value: string | boolean | undefined): string[] | undefined {
  if (typeof value !== 'string') return undefined;
  const items = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}
