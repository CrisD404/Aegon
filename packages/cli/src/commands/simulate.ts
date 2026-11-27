import { isProductionEnvironment, simulateLoad, type LoadNode } from '@aegon/core';
import { json, type Io } from '../io.ts';
import { WorkspaceError, type Workspace } from '../workspace.ts';
import { workspaceJson } from './check.ts';

const number = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const MARK: Record<LoadNode['state'], string> = { idle: ' ', ok: '✓', busy: '!', saturated: '✗' };

/**
 * `aegon simulate`: cuánto tráfico le llega a cada parte y qué se queda sin margen primero. El
 * mismo cálculo que el modo Simular de la app (es un modelo, no una medición).
 */
export function simulate(io: Io, ws: Workspace, opts: { rps: number; env?: string; system?: string; strict: boolean; json: boolean }): number {
  const model = ws.model;
  const environments = model.workspace.environments ?? [];
  if (opts.env && !environments.some((e) => e.id === opts.env)) {
    throw new WorkspaceError('not-found', `No existe el ambiente "${opts.env}".${environments.length ? ` Hay: ${environments.map((e) => e.id).join(', ')}` : ''}`);
  }
  // Por defecto, el ambiente productivo: es donde importa cuánto aguanta.
  const environment = opts.env ?? environments.find((e) => isProductionEnvironment(model, e.id))?.id;
  const scope = opts.system ? ws.element(opts.system) : undefined;
  if (scope && scope.kind !== 'system') throw new WorkspaceError('invalid-scope', `"${scope.name}" no es un sistema: --system espera un sistema`);
  const result = simulateLoad(model, { rps: opts.rps, environment, scope: scope?.id });
  const ok = !result.saturated.length;

  if (opts.json) {
    json(io, { ok, workspace: workspaceJson(ws), rps: opts.rps, environment: environment ?? null, system: scope?.id ?? null, ...result });
    return opts.strict && !ok ? 1 : 0;
  }

  const name = (id: string) => model.elements[id]?.name ?? id;
  const envName = environments.find((e) => e.id === environment)?.name;
  io.stdout(`Simulación · ${number.format(opts.rps)} pedidos por segundo${envName ? ` · ${envName}` : ''}${scope ? ` · ${scope.name}` : ''}\n`);
  if (!result.entries.length) {
    io.stdout('No hay tráfico que seguir: ningún actor llega a lo simulado.\n');
    return 0;
  }
  io.stdout(`Entra por: ${result.entries.map((e) => `${name(e.id)} (${number.format(e.rps)})`).join(', ')}\n\n`);

  const rows = Object.values(result.nodes).sort((a, b) => (b.utilization ?? -1) - (a.utilization ?? -1) || b.load - a.load || a.id.localeCompare(b.id));
  for (const node of rows) {
    const usage = node.utilization === null ? 'sin límite' : `${Math.round(node.utilization * 100)}%`;
    const of = node.capacity === null ? '' : ` de ${number.format(node.capacity)}`;
    const capacity = node.perReplica === null ? '' : `  ${node.replicas} × ${number.format(node.perReplica)}${node.assumed ? ' (supuesto)' : ''}`;
    const extra = node.backlog > 0 ? `  se acumulan ${number.format(node.backlog)}` : node.affectedBy.length && node.state !== 'saturated' ? `  lo frena ${name(node.affectedBy[0]!)}` : '';
    io.stdout(`  ${MARK[node.state]} ${name(node.id)} (${node.id})  ${usage}  ${number.format(node.load)}${of}${capacity}${extra}\n`);
  }

  io.stdout('\n');
  if (result.limit) {
    const first = `${result.limit.backlog ? 'se atrasa' : 'satura'} ${name(result.limit.bottleneck)}`;
    const fails = result.limit.backlog && result.failureLimit ? `; falla desde ${number.format(result.failureLimit.rps)} (${name(result.failureLimit.bottleneck)})` : '';
    io.stdout(`${ok ? '✓' : '✗'} Aguanta hasta ${number.format(result.limit.rps)} pedidos por segundo: primero ${first}${fails}\n`);
  } else {
    io.stdout('✓ Nada de lo que recorre el tráfico tiene un límite conocido\n');
  }
  if (!ok) io.stdout(`  Saturado con este tráfico: ${result.saturated.map(name).join(', ')}\n`);
  for (const note of result.notes) io.stdout(`  · ${note}\n`);
  return opts.strict && !ok ? 1 : 0;
}
