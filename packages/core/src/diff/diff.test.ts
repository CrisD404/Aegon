import { describe, expect, it } from 'vitest';
import { applyOp, applyOps, type Op } from '../ops/index.ts';
import { sampleModel } from '../test-fixtures.ts';
import { commitMessage, deepEqual, diffModels, revertChangeOp, summarizeChange } from './index.ts';

describe('diffModels', () => {
  it('sin cambios → lista vacía', () => {
    const model = sampleModel();
    expect(diffModels(model, model)).toEqual([]);
    expect(diffModels(model, structuredClone(model))).toEqual([]);
  });

  it('agregado y luego eliminado no es un cambio', () => {
    const base = sampleModel();
    const current = applyOps(base, [
      { type: 'element.add', element: { id: 'tmp', kind: 'system', name: 'Tmp' } },
      { type: 'element.remove', id: 'tmp' },
    ]).model;
    expect(diffModels(base, current)).toEqual([]);
  });

  it('detecta campos modificados, anidados y layout', () => {
    const base = sampleModel();
    const current = applyOps(base, [
      { type: 'element.update', id: 'api', patch: { name: 'API Core', risk: 'critical' } },
      { type: 'element.update', id: 'db', patch: { store: { engine: 'mysql', type: 'relational' } } },
      { type: 'view.place', view: 'landscape', nodes: { banking: { x: 50, y: 0 }, 'core-gw': { x: 0, y: 0 } } },
    ]).model;
    const changes = diffModels(base, current);
    const api = changes.find((c) => c.id === 'api')!;
    expect(api.fields.map((f) => f.path)).toEqual(['name', 'risk']);
    const db = changes.find((c) => c.id === 'db')!;
    expect(db.fields).toEqual([{ path: 'store.engine', before: 'postgresql', after: 'mysql' }]);
    const view = changes.find((c) => c.id === 'landscape')!;
    expect(view.layout).toEqual({ added: 1, removed: 0, moved: 1 });
    expect(summarizeChange(view)).toBe('Lienzo Landscape: 1 nodo movido, 1 nodo ubicado');
    expect(summarizeChange(api)).toBe('Actualizar contenedor API Core (name, risk)');
  });

  it('mensaje de commit con título y cuerpo', () => {
    const base = sampleModel();
    const current = applyOps(base, [
      { type: 'element.add', element: { id: 'x', kind: 'system', name: 'Pagos' } },
      { type: 'element.update', id: 'api', patch: { risk: 'low' } },
      { type: 'relation.remove', id: 'web--api' },
    ]).model;
    const msg = commitMessage(diffModels(base, current));
    // Quitar la relación también limpia su estilo en el lienzo L2 → 4 cambios.
    expect(msg.split('\n')[0]).toBe('4 cambios — Agregar sistema Pagos, Actualizar contenedor API (risk), +2');
    expect(msg).toContain('- Lienzo Home Banking · Contenedores: estilos de relaciones');
    expect(msg).toContain('- Eliminar relación Web → API');
  });
});

describe('revertChangeOp', () => {
  const edits: [string, Op][] = [
    ['agregado', { type: 'element.add', element: { id: 'x', kind: 'system', name: 'X' } }],
    ['modificado', { type: 'element.update', id: 'api', patch: { name: 'Otro', risk: null, owner: 'yo' } }],
    ['relación modificada', { type: 'relation.update', id: 'web--api', patch: { label: 'Invoca' } }],
    ['lienzo modificado', { type: 'view.place', view: 'landscape', nodes: { banking: { x: 9, y: 9 }, 'core-gw': { x: 1, y: 1 } } }],
    ['estilo de edge', { type: 'view.edge', view: 'banking-containers', relation: 'web--api', style: { shape: 'step' } }],
    ['lienzo eliminado', { type: 'view.remove', id: 'banking-containers' }],
    ['workspace', { type: 'workspace.update', patch: { name: 'Renombrado' } }],
  ];

  it.each(edits)('revierte un cambio %s', (_n, op) => {
    const base = sampleModel();
    const current = applyOp(base, op).model;
    let model = current;
    for (const change of diffModels(base, current)) {
      model = applyOp(model, revertChangeOp(base, model, change)!).model;
    }
    expect(diffModels(base, model)).toEqual([]);
  });

  it('restaurar un elemento eliminado repone ancestros, relaciones y ubicaciones', () => {
    const base = sampleModel();
    const current = applyOp(base, { type: 'element.remove', id: 'banking' }).model;
    const change = diffModels(base, current).find((c) => c.id === 'api')!;
    const restored = applyOp(current, revertChangeOp(base, current, change)!).model;
    expect(restored.elements.banking).toBeDefined();
    expect(restored.elements.api).toBeDefined();
    expect(restored.relations['api--core-gw']).toBeDefined();
    expect(restored.views.landscape!.nodes.banking).toEqual(base.views.landscape!.nodes.banking);
    expect(deepEqual(restored.elements.api, base.elements.api)).toBe(true);
  });
});
