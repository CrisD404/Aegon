import { describe, expect, it } from 'vitest';
import { applyOp } from '../ops/index.ts';
import { sizeOf } from '../ops/commands.ts';
import { validateModel } from '../rules/index.ts';
import { sampleModel } from '../test-fixtures.ts';
import { demoModel } from '../demo.ts';
import {
  BLOCK_VIEW,
  blockProblem,
  builtinTemplates,
  instantiateBlockOp,
  templateFromSelection,
  templateFromWorkspace,
  templateStats,
  workspaceFromTemplate,
} from './index.ts';

const errors = (m: Parameters<typeof validateModel>[0]) => validateModel(m).filter((d) => d.severity === 'error');

describe('templates incluidos', () => {
  it('son válidos y los bloques se insertan en L2', () => {
    const builtins = builtinTemplates();
    expect(builtins.map((t) => [t.id, t.kind])).toEqual([
      ['builtin:banca-digital', 'workspace'],
      ['builtin:api-gateway', 'block'],
      ['builtin:event-driven', 'block'],
      ['builtin:web-api-db', 'block'],
    ]);
    const model = demoModel();
    for (const t of builtins.filter((x) => x.kind === 'block')) {
      expect(templateStats(t).level).toBe(2);
      const { op, ids } = instantiateBlockOp(model, t, 'home-banking-containers', { x: 2000, y: 0 });
      const next = applyOp(model, op).model;
      expect(errors(next)).toEqual([]);
      for (const id of ids) expect(next.elements[id]!.parent).toBe('home-banking');
    }
  });
});

describe('instantiateBlockOp', () => {
  const gateway = builtinTemplates().find((t) => t.id === 'builtin:api-gateway')!;

  it('genera IDs nuevos sin pisar los existentes y centra el bloque en un lugar libre', () => {
    const model = demoModel();
    const at = { x: 4000, y: 4000 };
    const { op, ids } = instantiateBlockOp(model, gateway, 'home-banking-containers', at);
    const next = applyOp(model, op).model;
    // "API Gateway" ya existe en el demo → api-gateway-2.
    expect(ids).toContain('api-gateway-2');
    expect(next.elements['api-gateway']!.name).toBe('API Gateway');
    expect(next.relations['api-gateway-2--servicio-a']).toBeDefined();
    const placed = ids.map((id) => next.views['home-banking-containers']!.nodes[id]!);
    const xs = placed.map((p) => p.x);
    expect(Math.min(...xs) + Math.max(...xs) + 220).toBeCloseTo(2 * at.x, -1);
    // Insertarlo dos veces no choca.
    const again = applyOp(next, instantiateBlockOp(next, gateway, 'home-banking-containers', { x: 900, y: 0 }).op).model;
    expect(again.elements['api-gateway-3']).toBeDefined();
  });

  it('no pisa los nodos que ya están en el lienzo', () => {
    const model = demoModel();
    const view = model.views['home-banking-containers']!;
    const target = view.nodes['pagos-api']!;
    const { op, ids } = instantiateBlockOp(model, gateway, view.id, { x: target.x, y: target.y });
    const next = applyOp(model, op).model;
    const nodes = next.views[view.id]!.nodes;
    const box = (id: string) => ({ ...nodes[id]!, ...sizeOf(next.elements[id]!, nodes[id]) });
    const inserted = ids.map(box);
    const existing = Object.keys(view.nodes).map(box);
    for (const a of inserted) {
      for (const b of existing) {
        const overlaps = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlaps, `${JSON.stringify(a)} pisa ${JSON.stringify(b)}`).toBe(false);
      }
    }
  });

  it('no se inserta un bloque de contenedores en un lienzo L1', () => {
    const model = demoModel();
    expect(blockProblem(gateway, model.views.landscape!)).toMatch(/contenedores \(L2\)/);
    expect(() => instantiateBlockOp(model, gateway, 'landscape', { x: 0, y: 0 })).toThrow(/contenedores/);
  });
});

describe('templateFromSelection', () => {
  it('captura descendientes, relaciones internas, layout relativo y lienzos de detalle', () => {
    const model = sampleModel();
    // En L1: el sistema banking arrastra sus contenedores, componentes y el lienzo L2.
    const t = templateFromSelection(model, 'landscape', ['banking', 'customer'], { id: 'mi-template', name: 'Banca' });
    expect(t.kind).toBe('block');
    expect(Object.keys(t.model.elements).sort()).toEqual(['accounts', 'api', 'banking', 'customer', 'db', 'web']);
    expect(t.model.elements.banking!.groups).toBeUndefined(); // el grupo AWS no se seleccionó
    expect(Object.keys(t.model.relations).sort()).toEqual(['accounts--db', 'customer--web', 'web--api']);
    expect(t.model.views[BLOCK_VIEW]!.nodes).toEqual({ banking: { x: 0, y: 200 }, customer: { x: 0, y: 0 } });
    expect(t.model.views['banking-containers']!.nodes.core).toBeUndefined();

    // Al insertarlo en otro workspace se recrean el sistema, su jerarquía y su lienzo L2.
    const target = demoModel();
    const { op, ids } = instantiateBlockOp(target, t, 'landscape', { x: 0, y: 900 });
    const next = applyOp(target, op).model;
    expect(errors(next)).toEqual([]);
    expect(ids).toContain('home-banking-2');
    expect(next.elements.api!.parent).toBeDefined();
    const childView = Object.values(next.views).find((v) => v.scope === 'home-banking-2');
    expect(childView?.level).toBe(2);
  });

  it('sin selección válida es un error', () => {
    expect(() => templateFromSelection(sampleModel(), 'landscape', ['nope'], { id: 'x', name: 'X' })).toThrow(/al menos un elemento/);
  });
});

describe('templates de workspace', () => {
  it('un workspace nuevo desde un template conserva todo menos la identidad', () => {
    const t = templateFromWorkspace(demoModel(), { id: 'mi-base', name: 'Mi base' });
    const ws = workspaceFromTemplate(t, { id: 'nuevo', name: 'Proyecto nuevo' });
    expect(ws.workspace).toMatchObject({ id: 'nuevo', name: 'Proyecto nuevo', defaultView: 'landscape' });
    expect(Object.keys(ws.elements).length).toBe(Object.keys(demoModel().elements).length);
    expect(errors(ws)).toEqual([]);
  });
});
