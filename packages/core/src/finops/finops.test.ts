import { describe, expect, it } from 'vitest';
import { applyOp, applyOps } from '../ops/index.ts';
import { validateModel } from '../rules/index.ts';
import { demoModel } from '../demo.ts';
import { costRollup, costSummary, costsCsv, finopsSettingsOps, ownCost, tagOf } from './index.ts';

describe('FinOps', () => {
  const model = demoModel();

  it('el costo propio respeta el ambiente y dónde está desplegado', () => {
    const cache = model.elements.cache!;
    expect(ownCost(model, cache, 'prod')).toBe(260);
    expect(ownCost(model, cache, 'dev')).toBe(0); // no está desplegado en dev
    expect(ownCost(model, cache, null)).toBe(30 + 90 + 260);
  });

  it('un sistema suma sus contenedores; un grupo, sus miembros sin contar dos veces', () => {
    const prod = costRollup(model, 'prod');
    const containers = ['web-app', 'app-movil', 'api-gateway', 'cuentas-api', 'pagos-api', 'banking-db', 'cache', 'eventos'];
    const sum = containers.reduce((acc, id) => acc + prod.get(id)!.own, 0);
    expect(prod.get('home-banking')!.total).toBe(sum);
    // AWS: costo propio + Home Banking (y todo lo de adentro) + Notificaciones.
    expect(prod.get('aws-us-east-1')!.total).toBe(640 + sum + 310);
  });

  it('el resumen ordena sistemas y grupos, compara con presupuestos y reparte por etiqueta', () => {
    const summary = costSummary(model, 'prod');
    expect(summary.currency).toBe('USD');
    expect(summary.bySystem[0]!.id).toBe('home-banking');
    expect(summary.byGroup.map((g) => g.id)).toEqual(['aws-us-east-1']);
    const prod = summary.byEnvironment.find((e) => e.id === 'prod')!;
    expect(prod.total).toBe(summary.total);
    expect(prod.budget).toBe(9000);
    const byCenter = Object.fromEntries(summary.byTag['cost-center']!.map((t) => [t.value, t.total]));
    // Los contenedores heredan el centro de costos de Home Banking.
    expect(byCenter['CC-1200']).toBe(costRollup(model, 'prod').get('home-banking')!.total);
    expect(byCenter['CC-0900']).toBe(640);
    expect(tagOf(model, model.elements['pagos-api']!, 'project')).toBe('home-banking');
  });

  it('exporta un CSV con una fila por elemento y ambiente', () => {
    const csv = costsCsv(model);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toContain('costo_mensual');
    expect(lines.some((l) => l.startsWith('pagos-api,Pagos API,container,home-banking,home-banking,prod,Producción,1450,USD,6,c6i.xlarge'))).toBe(true);
    // Cache no está en dev: no hay fila.
    expect(lines.some((l) => l.startsWith('cache,') && l.includes(',dev,'))).toBe(false);
  });

  it('avisa si un elemento usa un ambiente que no existe', () => {
    const next = applyOp(model, { type: 'element.update', id: 'web-app', patch: { environments: ['prod', 'staging'] } }).model;
    const codes = validateModel(next).map((d) => d.code);
    expect(codes).toContain('unknown-environment');
    expect(validateModel(model).filter((d) => d.code === 'unknown-environment')).toEqual([]);
  });

  it('quitar un ambiente limpia despliegues, costos y presupuestos que lo usaban', () => {
    const environments = model.workspace.environments!.filter((e) => e.id !== 'pre');
    const ops = finopsSettingsOps(model, { environments, currency: 'EUR', tagKeys: ['cost-center'], budgets: { prod: 9000, pre: 2500 } });
    const next = applyOps(model, ops).model;
    expect(next.workspace.environments!.map((e) => e.id)).toEqual(['dev', 'qa', 'prod']);
    expect(next.workspace.finops).toEqual({ currency: 'EUR', tagKeys: ['cost-center'], budgets: { prod: 9000 } });
    expect(next.elements.cache!.environments).toEqual(['qa', 'prod']);
    expect(next.elements['pagos-api']!.finops!.costs!.pre).toBeUndefined();
    expect(validateModel(next).filter((d) => d.code === 'unknown-environment')).toEqual([]);
    // Sin cambios: ninguna op.
    expect(finopsSettingsOps(model, { environments: [...model.workspace.environments!], currency: 'USD', tagKeys: ['cost-center', 'project'], budgets: { ...model.workspace.finops!.budgets } })).toEqual([]);
  });
});
