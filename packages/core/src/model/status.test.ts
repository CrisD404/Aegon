import { describe, expect, it } from 'vitest';
import { demoModel } from '../demo.ts';
import { applyOp, type Op } from '../ops/index.ts';
import { createElementOp, createViewOp } from '../ops/commands.ts';
import { createDeployedOp } from '../deployment/convert.ts';
import { validateModel } from '../rules/index.ts';
import type { Model } from './index.ts';
import { carriedStatus, mergedStatus, relationStatusOf, statusCounts, statusOf } from './status.ts';

const run = (model: Model, op: Op): Model => applyOp(model, op).model;
const mark = (model: Model, id: string, status: string | null): Model => run(model, { type: 'element.update', id, patch: { status } } as Op);

/** Un datacenter con una VM que corre un servicio de nombres, y un servidor de archivos que lo consulta. */
function infra(): { model: Model; viewId: string; dns: string } {
  let model = demoModel();
  const view = createViewOp(model, 'Despliegue Producción', 'deployment', undefined, 'prod');
  model = run(model, view.op);
  const add = (name: string, fields: Record<string, unknown>) => {
    const { op, id } = createElementOp(model, { kind: 'node', name, view: view.id, at: { x: 0, y: 0 }, fields });
    model = run(model, op);
    return id;
  };
  const dc = add('Datacenter principal', { node: { type: 'datacenter' } });
  add('VM de dominio', { node: { type: 'vm' }, parent: dc, addresses: ['10.0.20.10'] });
  add('Servidor de archivos', { node: { type: 'server' }, parent: dc, addresses: ['10.0.20.20'] });
  const deployed = createDeployedOp(model, view.id, { what: 'service', name: 'DNS', at: { x: 0, y: 0 }, parent: 'vm-de-dominio' })!;
  model = run(model, deployed.op);
  model = run(model, { type: 'relation.add', relation: { id: 'archivos--dns', from: 'servidor-de-archivos', to: deployed.id, label: 'Resuelve nombres', protocols: ['dns'], ports: [53] } });
  return { model, viewId: view.id, dns: deployed.id };
}

describe('estado efectivo', () => {
  it('sin marcas todo existe', () => {
    const { model, dns } = infra();
    expect(statusOf(model, 'vm-de-dominio')).toEqual({ status: 'live', from: 'default' });
    expect(statusOf(model, dns).status).toBe('live');
    expect(relationStatusOf(model, model.relations['archivos--dns']!).status).toBe('live');
    expect(statusCounts(model, Object.keys(model.elements), Object.keys(model.relations))).toEqual([]);
  });

  it('lo que está dentro de un servidor nuevo también es nuevo, y lo que se conecta con él', () => {
    const { model: base, dns } = infra();
    const model = mark(base, 'vm-de-dominio', 'planned');
    expect(statusOf(model, 'vm-de-dominio')).toEqual({ status: 'planned', from: 'own' });
    expect(statusOf(model, dns)).toEqual({ status: 'planned', from: 'ancestor', source: 'vm-de-dominio' });
    expect(statusOf(model, 'servidor-de-archivos').status).toBe('live');
    expect(statusOf(model, 'datacenter-principal').status).toBe('live');
    expect(relationStatusOf(model, model.relations['archivos--dns']!)).toEqual({ status: 'planned', from: 'end', source: dns });
    expect(validateModel(model).filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('«se modifica» no se contagia: cambia el servidor, no lo que corre adentro', () => {
    const { model: base, dns } = infra();
    const model = mark(base, 'vm-de-dominio', 'changing');
    expect(statusOf(model, 'vm-de-dominio').status).toBe('changing');
    expect(statusOf(model, dns).status).toBe('live');
    expect(relationStatusOf(model, model.relations['archivos--dns']!).status).toBe('live');
  });

  it('la marca propia manda sobre la heredada', () => {
    const { model: base, dns } = infra();
    let model = mark(base, 'datacenter-principal', 'planned');
    model = mark(model, dns, 'changing');
    expect(statusOf(model, 'vm-de-dominio')).toEqual({ status: 'planned', from: 'ancestor', source: 'datacenter-principal' });
    expect(statusOf(model, dns)).toEqual({ status: 'changing', from: 'own' });
    model = run(model, { type: 'relation.update', id: 'archivos--dns', patch: { status: 'deprecated' } });
    expect(relationStatusOf(model, model.relations['archivos--dns']!)).toEqual({ status: 'deprecated', from: 'own' });
  });

  it('una instancia sin marca se ve como lo que despliega', () => {
    const { model: base, dns } = infra();
    const logical = (base.elements[dns] as { instance: { of: string } }).instance.of;
    const model = mark(base, logical, 'changing');
    expect(statusOf(model, dns)).toEqual({ status: 'changing', from: 'target', source: logical });
    // Pero un servidor que se da de baja pesa más que lo que diga el software.
    const leaving = mark(model, 'vm-de-dominio', 'deprecated');
    expect(statusOf(leaving, dns)).toEqual({ status: 'deprecated', from: 'ancestor', source: 'vm-de-dominio' });
  });

  it('entre extremos con estados distintos gana lo que ya no está, después lo nuevo', () => {
    const { model: base, dns } = infra();
    let model = mark(base, 'servidor-de-archivos', 'planned');
    model = mark(model, 'vm-de-dominio', 'deprecated');
    expect(carriedStatus(model, ['servidor-de-archivos', dns])?.status).toBe('planned');
    model = mark(model, 'vm-de-dominio', 'retired');
    expect(carriedStatus(model, ['servidor-de-archivos', dns])).toEqual({ status: 'retired', from: 'end', source: dns });
  });

  it('una línea con relaciones en estados distintos «se modifica»', () => {
    expect(mergedStatus([])).toBe('live');
    expect(mergedStatus(['planned', 'planned'])).toBe('planned');
    expect(mergedStatus(['live', 'planned'])).toBe('changing');
  });

  it('cuenta lo marcado por estado, heredados incluidos', () => {
    const { model: base, viewId, dns } = infra();
    let model = mark(base, 'vm-de-dominio', 'planned');
    model = mark(model, 'servidor-de-archivos', 'changing');
    const counts = statusCounts(model, Object.keys(model.views[viewId]!.nodes), ['archivos--dns']);
    expect(counts.map((c) => [c.status, [...c.elements].sort(), c.relations])).toEqual([
      ['planned', ['vm-de-dominio', dns].sort(), ['archivos--dns']],
      ['changing', ['servidor-de-archivos'], []],
    ]);
  });
});
