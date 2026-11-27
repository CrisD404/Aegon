import { describe, expect, it } from 'vitest';
import { demoModel } from '../demo.ts';
import type { Model } from '../model/index.ts';
import { applyOp, type Op } from '../ops/index.ts';
import { assumedCapacity, replicasIn, simulateLoad } from './index.ts';

const run = (model: Model, ...ops: Op[]): Model => ops.reduce((m, op) => applyOp(m, op).model, model);
const HB = { scope: 'home-banking', environment: 'prod' } as const;

describe('simulador de carga', () => {
  it('reparte el tráfico que entra por las relaciones del modelo', () => {
    const result = simulateLoad(demoModel(), { ...HB, rps: 100 });
    // El cliente entra por la web y por la app; el operador de soporte no es de este sistema.
    expect(result.entries).toEqual([
      { id: 'app-movil', rps: 50 },
      { id: 'web-app', rps: 50 },
    ]);
    const load = (id: string) => result.nodes[id]!.load;
    expect(load('api-gateway')).toBe(100);
    expect(load('cuentas-api')).toBe(100);
    expect(load('pagos-api')).toBe(100);
    // A la base le llegan Cuentas API y el repositorio de Pagos API (un componente cuenta para su contenedor).
    expect(load('banking-db')).toBe(200);
    expect(load('core-bancario')).toBe(200);
    // Los componentes no se simulan por separado.
    expect(result.nodes['pagos-repo']).toBeUndefined();
    expect(result.nodes.operador).toBeUndefined();
  });

  it('lo que consume de un bus recibe lo que el bus entrega', () => {
    const result = simulateLoad(demoModel(), { ...HB, rps: 100 });
    expect(result.nodes.eventos!.load).toBe(100);
    expect(result.nodes.notificaciones!.load).toBe(100);
    expect(result.edges.find((e) => e.relation === 'notificaciones--eventos')).toMatchObject({ from: 'eventos', to: 'notificaciones', async: true });
    expect(result.notes.some((n) => n.includes('consume de'))).toBe(true);
  });

  it('toma las réplicas del despliegue y supone la capacidad por tipo', () => {
    const model = demoModel();
    expect(replicasIn(model, 'pagos-api', 'prod')).toBe(6);
    // En QA no hay despliegue: valen las réplicas de los costos, o una.
    expect(replicasIn(model, 'pagos-api', 'pre')).toBe(2);
    expect(replicasIn(model, 'pagos-api', 'qa')).toBe(1);
    expect(assumedCapacity(model.elements['banking-db']!)).toBe(1000);
    expect(assumedCapacity(model.elements['core-bancario']!)).toBeNull();
    const node = simulateLoad(model, { ...HB, rps: 100 }).nodes['pagos-api']!;
    expect(node).toMatchObject({ replicas: 6, perReplica: 300, capacity: 1800, assumed: true, state: 'ok' });
    // La app móvil corre en el celular y el core es de otro: sin límite conocido.
    expect(simulateLoad(model, { ...HB, rps: 100 }).nodes['app-movil']).toMatchObject({ capacity: null, utilization: null, assumed: false });
  });

  it('dice cuánto aguanta y qué satura primero', () => {
    const model = demoModel();
    const result = simulateLoad(model, { ...HB, rps: 100 });
    // Lo primero en saturar es Notificaciones (una réplica, 300 por segundo), que recibe todo por
    // el bus: se atrasa, no hace fallar a nadie.
    expect(result.limit).toEqual({ rps: 300, bottleneck: 'notificaciones', backlog: true });
    // Lo primero que falla en línea es Banking DB: 2 réplicas × 1.000 = 2.000 y recibe el doble
    // del tráfico de entrada.
    expect(result.failureLimit).toEqual({ rps: 1000, bottleneck: 'banking-db' });
    expect(result.saturated).toEqual([]);
    // Justo en el límite todavía no satura; un poco más, sí.
    expect(simulateLoad(model, { ...HB, rps: 1000 }).nodes['banking-db']!.state).toBe('busy');
    const over = simulateLoad(model, { ...HB, rps: 1100 });
    expect(over.saturated).toEqual(['notificaciones', 'banking-db']);
    expect(over.nodes['banking-db']).toMatchObject({ load: 2200, served: 2000, state: 'saturated' });
  });

  it('lo saturado frena a quien lo llama en línea, no a lo que pasa por un bus', () => {
    const over = simulateLoad(demoModel(), { ...HB, rps: 1100 });
    // Cuentas API y Pagos API llaman a la base; el gateway y las apps los llaman a ellos.
    for (const id of ['cuentas-api', 'pagos-api', 'api-gateway', 'web-app', 'app-movil']) expect(over.nodes[id]!.affectedBy).toEqual(['banking-db']);
    for (const id of ['eventos', 'notificaciones', 'cache']) expect(over.nodes[id]!.affectedBy).toEqual([]);
  });

  it('un cuello de botella protege a lo que tiene detrás', () => {
    // El gateway con una sola réplica y poca capacidad: más allá de eso, nada pasa.
    const model = run(demoModel(), { type: 'element.update', id: 'api-gateway', patch: { load: { capacity: 100 } } });
    const result = simulateLoad(model, { scope: 'home-banking', environment: 'qa', rps: 500 });
    expect(result.limit).toEqual({ rps: 100, bottleneck: 'api-gateway', backlog: false });
    expect(result.failureLimit).toEqual({ rps: 100, bottleneck: 'api-gateway' });
    expect(result.nodes['api-gateway']).toMatchObject({ load: 500, served: 100, assumed: false, state: 'saturated' });
    expect(result.nodes['cuentas-api']!.load).toBe(100);
    expect(result.nodes['banking-db']!.state).toBe('ok');
  });

  it('un consumidor lento acumula sin afectar a quien publica', () => {
    const model = run(demoModel(), { type: 'element.update', id: 'notificaciones', patch: { load: { capacity: 40 } } });
    const result = simulateLoad(model, { ...HB, rps: 100 });
    expect(result.nodes.notificaciones).toMatchObject({ load: 100, served: 40, backlog: 60, state: 'saturated' });
    expect(result.nodes.eventos!.affectedBy).toEqual([]);
    expect(result.nodes['pagos-api']!.affectedBy).toEqual([]);
  });

  it('las llamadas por pedido de una relación escalan lo que llega', () => {
    const model = run(demoModel(), { type: 'relation.update', id: 'api-gateway--cuentas-api', patch: { calls: 0.25 } });
    const result = simulateLoad(model, { ...HB, rps: 100 });
    expect(result.nodes['cuentas-api']!.load).toBe(25);
    // La base ahora recibe 25 de Cuentas y 100 de Pagos.
    expect(result.nodes['banking-db']!.load).toBe(125);
  });

  it('sin actores entra por lo que nadie llama, y los ciclos no se cuentan dos veces', () => {
    const model = run(
      demoModel(),
      { type: 'relation.remove', id: 'cliente--web-app' },
      { type: 'relation.remove', id: 'cliente--app-movil' },
      { type: 'relation.add', relation: { id: 'cuentas-api--api-gateway', from: 'cuentas-api', to: 'web-app' } },
    );
    const result = simulateLoad(model, { ...HB, rps: 100 });
    expect(result.entries.map((e) => e.id)).toEqual(['app-movil']);
    expect(Number.isFinite(result.nodes['api-gateway']!.load)).toBe(true);
    expect(result.nodes['web-app']!.load).toBe(100);
  });

  it('sin tráfico todo queda en reposo', () => {
    const result = simulateLoad(demoModel(), { ...HB, rps: 0 });
    expect(Object.values(result.nodes).every((n) => n.state === 'idle')).toBe(true);
    expect(result.failureLimit).toEqual({ rps: 1000, bottleneck: 'banking-db' });
  });
});
