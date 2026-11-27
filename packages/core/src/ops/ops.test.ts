import { describe, expect, it } from 'vitest';
import { applyOp, OpError, type Op } from './index.ts';
import { AUTO_ROUTE, createElementOp, connectOp, duplicateOp, edgeStyleWith, ensureChildViewOp, hasManualRoute, reconnectOp, representativeInView, routeResetOps, shiftEdgeStyle } from './commands.ts';
import { sampleModel } from '../test-fixtures.ts';
import { deepEqual } from '../diff/index.ts';
import { childViewOf, descendantsOf } from '../model/index.ts';
import { EdgeStyle } from '../schema/index.ts';

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
    ['view.edge (recorrido a mano)', { type: 'view.edge', view: 'banking-containers', relation: 'web--api', style: { shape: 'step', points: [{ x: 40, y: -60 }, { x: 300, y: -60 }] } }],
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

describe('recorrido a mano de una relación', () => {
  const routed = () => {
    const model = sampleModel();
    const view = model.views['banking-containers']!;
    const style = edgeStyleWith(view, 'web--api', { points: [{ x: 40, y: -60 }, { x: 300, y: -60 }] });
    return applyOp(model, { type: 'view.edge', view: view.id, relation: 'web--api', style }).model;
  };

  it('cambiar un campo del estilo conserva los demás', () => {
    const view = routed().views['banking-containers']!;
    const before = view.edges!['web--api']!;
    expect(before.points).toHaveLength(2);
    // Cambiar la forma no borra el recorrido, y volver a la forma por defecto tampoco.
    expect(edgeStyleWith(view, 'web--api', { shape: 'straight' })).toEqual({ ...before, shape: 'straight' });
    const curved = edgeStyleWith(view, 'web--api', { shape: 'curved' })!;
    expect(curved.shape).toBeUndefined();
    expect(curved.points).toEqual(before.points);
  });

  it('sin nada distinto del default no queda entrada', () => {
    const view = sampleModel().views['banking-containers']!;
    expect(edgeStyleWith({ ...view, edges: {} }, 'web--api', { shape: 'curved', points: [], hidden: false })).toBeNull();
    expect(edgeStyleWith({ ...view, edges: { 'web--api': { points: [{ x: 1, y: 2 }] } } }, 'web--api', { points: null })).toBeNull();
  });

  it('el recorrido se corre entero con lo que une', () => {
    expect(shiftEdgeStyle({ shape: 'step', points: [{ x: 10, y: 20 }] }, 5, -5)).toEqual({ shape: 'step', points: [{ x: 15, y: 15 }] });
    const plain = { shape: 'step' as const };
    expect(shiftEdgeStyle(plain, 5, 5)).toBe(plain);
  });

  it('reordenar quita el recorrido de lo que se movió y deja el resto', () => {
    const model = routed();
    const view = model.views['banking-containers']!;
    expect(routeResetOps(model, view, new Set(['db']))).toEqual([]);
    const ops = routeResetOps(model, view, new Set(['web']));
    expect(ops).toHaveLength(1);
    const next = applyOp(model, ops[0]!).model.views['banking-containers']!;
    expect(next.edges?.['web--api']?.points).toBeUndefined();
    expect(routeResetOps(model, view)).toHaveLength(1);
  });
});

describe('puntas fijas de una relación', () => {
  const view = () => sampleModel().views['banking-containers']!;

  it('el medio del lado es el default y no se escribe', () => {
    expect(edgeStyleWith({ ...view(), edges: {} }, 'web--api', { to: { side: 'top', at: 0.5 } })).toEqual({ to: { side: 'top' } });
    expect(edgeStyleWith({ ...view(), edges: {} }, 'web--api', { from: { side: 'bottom', at: 0.25 } })).toEqual({ from: { side: 'bottom', at: 0.25 } });
  });

  it('una punta se fija o se suelta sin tocar la otra ni el recorrido', () => {
    const v = view();
    const style = edgeStyleWith(v, 'web--api', { from: { side: 'bottom' }, to: { side: 'left', at: 0.2 }, points: [{ x: 10, y: 90 }] })!;
    const with2 = { ...v, edges: { 'web--api': style } };
    expect(edgeStyleWith(with2, 'web--api', { to: null })).toEqual({ shape: 'straight', from: { side: 'bottom' }, points: [{ x: 10, y: 90 }] });
    expect(hasManualRoute(style)).toBe(true);
    // Volver al automático deja solo lo que no es recorrido (la forma).
    expect(edgeStyleWith(with2, 'web--api', AUTO_ROUTE)).toEqual({ shape: 'straight' });
    expect(hasManualRoute({ shape: 'straight' })).toBe(false);
    expect(hasManualRoute(undefined)).toBe(false);
  });

  it('la etiqueta movida a mano se guarda en el lienzo y vuelve sola con el resto', () => {
    const v = view();
    const style = edgeStyleWith(v, 'web--api', { labelAt: 0.25 })!;
    expect(style).toEqual({ shape: 'straight', labelAt: 0.25 });
    expect(hasManualRoute(style)).toBe(true);
    const moved = { ...v, edges: { 'web--api': { ...style, backLabelAt: 0.8 } } };
    // Volver al automático suelta también las etiquetas.
    expect(edgeStyleWith(moved, 'web--api', AUTO_ROUTE)).toEqual({ shape: 'straight' });
    // Fuera del trazo no hay etiqueta: el formato lo rechaza.
    expect(EdgeStyle.safeParse({ labelAt: 1.4 }).success).toBe(false);
    expect(EdgeStyle.safeParse({ labelAt: 0.4, backLabelAt: 0.9 }).success).toBe(true);
    expect(applyOp(sampleModel(), { type: 'view.edge', view: v.id, relation: 'web--api', style: { labelAt: 0.4 } }).model.views[v.id]!.edges!['web--api']).toEqual({ labelAt: 0.4 });
  });

  it('reordenar también suelta las puntas de lo que se movió', () => {
    const base = sampleModel();
    const model = applyOp(base, { type: 'view.edge', view: 'banking-containers', relation: 'web--api', style: { to: { side: 'top' } } }).model;
    const ops = routeResetOps(model, model.views['banking-containers']!, new Set(['api']));
    expect(ops).toHaveLength(1);
    expect(applyOp(model, ops[0]!).model.views['banking-containers']!.edges?.['web--api']).toBeUndefined();
  });
});

describe('llevar una flecha a otro elemento', () => {
  it('cambia ese extremo y conserva el ID y lo demás de la relación', () => {
    const base = sampleModel();
    const model = applyOp(base, { type: 'relation.update', id: 'web--api', patch: { label: 'Consulta', protocols: ['https'], ports: [443] } }).model;
    const result = reconnectOp(model, 'web--api', 'to', 'db');
    if (!result || 'problem' in result) throw new Error('se esperaba una operación');
    const { model: next, inverse } = applyOp(model, result.op);
    expect(next.relations['web--api']).toMatchObject({ id: 'web--api', from: 'web', to: 'db', label: 'Consulta', protocols: ['https'], ports: [443] });
    expect(deepEqual(applyOp(next, inverse).model, model)).toBe(true);
  });

  it('suelta lo acomodado a mano para el recorrido viejo, menos la punta que no se movió', () => {
    const base = sampleModel();
    const model = applyOp(base, {
      type: 'view.edge',
      view: 'banking-containers',
      relation: 'web--api',
      style: { shape: 'straight', from: { side: 'bottom' }, to: { side: 'top' }, points: [{ x: 10, y: 90 }] },
    }).model;
    const result = reconnectOp(model, 'web--api', 'to', 'db');
    if (!result || 'problem' in result) throw new Error('se esperaba una operación');
    expect(applyOp(model, result.op).model.views['banking-containers']!.edges!['web--api']).toEqual({ shape: 'straight', from: { side: 'bottom' } });
  });

  it('no deja dos relaciones para el mismo par ni una que vuelva sobre sí misma', () => {
    const model = sampleModel();
    // `customer` ya está conectado con `web`: llevar ahí la punta de `web--api` duplicaría el par.
    expect(reconnectOp(model, 'web--api', 'to', 'customer')).toMatchObject({ problem: expect.stringContaining('ya están conectados') });
    expect(reconnectOp(model, 'web--api', 'from', 'api')).toMatchObject({ problem: expect.stringContaining('dos extremos distintos') });
    expect(reconnectOp(model, 'web--api', 'to', 'aws')).toMatchObject({ problem: expect.stringContaining('grupo') });
    expect(reconnectOp(model, 'web--api', 'to', 'api')).toBeNull();
  });

  it('los pasos de flujos que van por esa relación siguen al extremo nuevo', () => {
    const base = sampleModel();
    const model = applyOp(base, {
      type: 'flow.add',
      flow: {
        id: 'saldo',
        name: 'Consulta de saldo',
        steps: [
          { type: 'message', from: 'web', to: 'api', relation: 'web--api' },
          { type: 'paths', mode: 'alternate', paths: [{ name: 'Con caché', steps: [{ type: 'message', from: 'api', to: 'web', relation: 'web--api' }, { type: 'process', element: 'api' }] }] },
        ],
      },
    }).model;
    const result = reconnectOp(model, 'web--api', 'to', 'core');
    if (!result || 'problem' in result) throw new Error('se esperaba una operación');
    const steps = applyOp(model, result.op).model.flows!.saldo!.steps;
    expect(steps[0]).toMatchObject({ from: 'web', to: 'core' });
    expect(steps[1]).toMatchObject({ paths: [{ steps: [{ from: 'core', to: 'web' }, { type: 'process', element: 'api' }] }] });
  });
});
