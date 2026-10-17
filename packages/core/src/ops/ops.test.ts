import { describe, expect, it } from 'vitest';
import { applyOp, OpError, type Op } from './index.ts';
import { createElementOp, connectOp, duplicateOp, ensureChildViewOp, representativeInView } from './commands.ts';
import { sampleModel } from '../test-fixtures.ts';
import { deepEqual } from '../diff/index.ts';
import { childViewOf, descendantsOf } from '../model/index.ts';

function roundtrip(op: Op) {
  const model = sampleModel();
  const { model: next, inverse } = applyOp(model, op);
  const { model: back } = applyOp(next, inverse);
  return { model, next, back };
}

describe('applyOp + inverse', () => {
  const cases: [string, Op][] = [
    ['element.add', { type: 'element.add', element: { id: 'new', kind: 'system', name: 'Nuevo' } }],
    ['element.update', { type: 'element.update', id: 'api', patch: { name: 'API v2', risk: null, tags: ['pci'] } }],
    ['element.remove (cascada)', { type: 'element.remove', id: 'banking' }],
    ['element.remove (grupo)', { type: 'element.remove', id: 'aws' }],
    ['relation.add', { type: 'relation.add', relation: { id: 'r', from: 'customer', to: 'core' } }],
    ['relation.update', { type: 'relation.update', id: 'web--api', patch: { label: null, direction: 'bidirectional' } }],
    ['relation.remove (con estilo)', { type: 'relation.remove', id: 'web--api' }],
    ['view.add', { type: 'view.add', view: { id: 'v2', name: 'Otro', level: 1, nodes: { core: { x: 1, y: 2 } } } }],
    ['view.update', { type: 'view.update', id: 'landscape', patch: { name: 'Mapa', description: 'x' } }],
    ['view.remove (default)', { type: 'view.remove', id: 'landscape' }],
    ['view.place', { type: 'view.place', view: 'landscape', nodes: { banking: { x: 10, y: 10 }, 'core-gw': { x: 5, y: 5 } } }],
    ['view.unplace', { type: 'view.unplace', view: 'landscape', ids: ['core', 'missing'] }],
    ['view.edge', { type: 'view.edge', view: 'banking-containers', relation: 'web--api', style: null }],
    ['workspace.update', { type: 'workspace.update', patch: { description: 'hola', defaultView: null } }],
  ];

  it.each(cases)('%s se deshace exactamente', (_name, op) => {
    const { model, next, back } = roundtrip(op);
    expect(deepEqual(next, model)).toBe(false);
    expect(deepEqual(back, model)).toBe(true);
  });

  it('remover un sistema cascada a hijos, relaciones, vistas de detalle y ubicaciones', () => {
    const model = sampleModel();
    const { model: next } = applyOp(model, { type: 'element.remove', id: 'banking' });
    for (const id of ['banking', 'web', 'api', 'db', 'accounts']) expect(next.elements[id]).toBeUndefined();
    expect(Object.keys(next.relations)).toEqual(['api--core-gw'].filter((r) => next.relations[r]));
    expect(next.relations['customer--web']).toBeUndefined();
    expect(next.views['banking-containers']).toBeUndefined();
    expect(next.views.landscape!.nodes.banking).toBeUndefined();
  });

  it('remover un grupo limpia la membresía', () => {
    const { model: next } = applyOp(sampleModel(), { type: 'element.remove', id: 'aws' });
    expect(next.elements.banking!.groups).toBeUndefined();
  });

  it('el modelo original no se muta', () => {
    const model = sampleModel();
    const snapshot = structuredClone(model);
    applyOp(model, { type: 'element.remove', id: 'banking' });
    expect(model).toEqual(snapshot);
  });
});

describe('validaciones', () => {
  const model = sampleModel();
  const bad: [string, Op, string][] = [
    ['ID duplicado', { type: 'element.add', element: { id: 'api', kind: 'system', name: 'x' } }, 'duplicate-id'],
    ['padre inválido', { type: 'element.add', element: { id: 'c', kind: 'component', name: 'x', parent: 'banking' } }, 'invalid-parent'],
    ['padre inexistente', { type: 'element.add', element: { id: 'c', kind: 'container', name: 'x', parent: 'nope' } }, 'missing-parent'],
    ['ciclo de grupos', { type: 'element.update', id: 'aws', patch: { parent: 'aws' } }, 'invalid-parent'],
    ['grupo inválido', { type: 'element.update', id: 'api', patch: { groups: ['banking'] } }, 'invalid-group'],
    ['cambiar kind', { type: 'element.update', id: 'api', patch: { kind: 'system' } as never }, 'immutable-field'],
    ['nombre vacío', { type: 'element.update', id: 'api', patch: { name: '' } }, 'invalid-element'],
    ['relación a grupo', { type: 'relation.add', relation: { id: 'r', from: 'api', to: 'aws' } }, 'invalid-endpoint'],
    ['relación colgante', { type: 'relation.add', relation: { id: 'r', from: 'api', to: 'nope' } }, 'missing-endpoint'],
    ['ubicar inexistente', { type: 'view.place', view: 'landscape', nodes: { nope: { x: 0, y: 0 } } }, 'missing-node'],
    ['vista inexistente', { type: 'view.unplace', view: 'nope', ids: [] }, 'not-found'],
  ];
  it.each(bad)('%s', (_name, op, code) => {
    expect(() => applyOp(model, op)).toThrowError(OpError);
    try {
      applyOp(model, op);
    } catch (e) {
      expect((e as OpError).code).toBe(code);
    }
  });

  it('un batch inválido no deja cambios a medias', () => {
    const op: Op = {
      type: 'batch',
      ops: [
        { type: 'element.add', element: { id: 'ok', kind: 'system', name: 'Ok' } },
        { type: 'element.add', element: { id: 'ok', kind: 'system', name: 'Dup' } },
      ],
    };
    expect(() => applyOp(model, op)).toThrow();
    expect(model.elements.ok).toBeUndefined();
  });
});

describe('comandos', () => {
  it('createElementOp genera un slug único y hereda el scope del lienzo', () => {
    const model = sampleModel();
    const { op, id } = createElementOp(model, { kind: 'container', name: 'API', view: 'banking-containers', at: { x: 5, y: 5 } });
    expect(id).toBe('api-2');
    const next = applyOp(model, op).model;
    expect(next.elements['api-2']).toMatchObject({ parent: 'banking', kind: 'container' });
    expect(next.views['banking-containers']!.nodes['api-2']).toEqual({ x: 5, y: 5 });
  });

  it('en L3 un store nuevo pertenece al sistema del container', () => {
    let model = sampleModel();
    const child = ensureChildViewOp(model, 'api')!;
    model = applyOp(model, child.op!).model;
    const { op, id } = createElementOp(model, { kind: 'store', name: 'Cache', view: child.viewId });
    model = applyOp(model, op).model;
    expect(model.elements[id]).toMatchObject({ parent: 'banking', store: { engine: 'other' } });
  });

  it('connectOp respeta una relación por par (C4)', () => {
    const model = sampleModel();
    expect(connectOp(model, 'web', 'core')).toMatchObject({ kind: 'created', id: 'web--core' });
    expect(connectOp(model, 'web', 'api')).toMatchObject({ kind: 'exists', id: 'web--api', op: null });
    const reverse = connectOp(model, 'api', 'web');
    expect(reverse).toMatchObject({ kind: 'bidirectional', id: 'web--api' });
    const next = applyOp(model, reverse.op!).model;
    expect(next.relations['web--api']!.direction).toBe('bidirectional');
    expect(connectOp(next, 'api', 'web').kind).toBe('exists');
  });

  it('el core rechaza relaciones repetidas o invertidas sobre el mismo par', () => {
    const model = sampleModel();
    expect(() => applyOp(model, { type: 'relation.add', relation: { id: 'otra', from: 'web', to: 'api' } })).toThrowError(/ya están conectados/);
    expect(() => applyOp(model, { type: 'relation.add', relation: { id: 'otra', from: 'api', to: 'web' } })).toThrowError(OpError);
    expect(() => applyOp(model, { type: 'relation.update', id: 'customer--web', patch: { to: 'api', from: 'web' } })).toThrowError(/ya están conectados/);
    // Invertir la propia relación sí está permitido.
    expect(applyOp(model, { type: 'relation.update', id: 'web--api', patch: { from: 'api', to: 'web' } }).model.relations['web--api']!.from).toBe('api');
  });

  it('ensureChildViewOp crea la vista L3 con hijos y externos representados', () => {
    const model = sampleModel();
    const result = ensureChildViewOp(model, 'api')!;
    expect(result.op).not.toBeNull();
    const next = applyOp(model, result.op!).model;
    const view = next.views[result.viewId]!;
    expect(view).toMatchObject({ level: 3, scope: 'api' });
    // accounts (hijo), db (contenedor hermano), web (hermano que llama a api), core-gw → sistema core
    expect(Object.keys(view.nodes).sort()).toEqual(['accounts', 'core', 'db', 'web']);
    expect(childViewOf(next, 'api')?.id).toBe(result.viewId);
    expect(ensureChildViewOp(next, 'api')!.op).toBeNull();
  });

  it('representativeInView sube hasta el ancestro ubicado', () => {
    const model = sampleModel();
    const l1 = model.views.landscape!;
    expect(representativeInView(model, l1, 'accounts')).toBe('banking');
    expect(representativeInView(model, l1, 'core-gw')).toBe('core');
    const l2 = model.views['banking-containers']!;
    expect(representativeInView(model, l2, 'accounts')).toBe('api');
    expect(representativeInView(model, l2, 'banking')).toBeUndefined();
  });

  it('duplicateOp copia elementos, relaciones internas y ubicación', () => {
    const model = sampleModel();
    const { op, ids } = duplicateOp(model, 'banking-containers', ['web', 'api']);
    const next = applyOp(model, op).model;
    expect(ids).toEqual(['web-copia', 'api-copia']);
    expect(next.relations['web-copia--api-copia']).toBeDefined();
    expect(next.views['banking-containers']!.nodes['api-copia']).toEqual({ x: 368, y: 48 });
    expect(descendantsOf(next, 'banking')).toContain('api-copia');
  });
});
