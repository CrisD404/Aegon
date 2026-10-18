import { describe, expect, it } from 'vitest';
import { applyOp } from '../ops/index.ts';
import { viewEdges } from '../ops/commands.ts';
import { sampleModel } from '../test-fixtures.ts';
import { arrangeViewOp, freePositions } from './index.ts';

describe('layout', () => {
  it('arrangeViewOp ordena por capas y el grupo sigue envolviendo a sus miembros', () => {
    const model = sampleModel();
    const op = arrangeViewOp(model, 'landscape')!;
    expect(op.type).toBe('view.place');
    const next = applyOp(model, op).model.views.landscape!.nodes;
    // El actor arriba, el sistema que usa debajo, el externo más abajo.
    expect(next.customer!.y).toBeLessThan(next.banking!.y);
    expect(next.banking!.y).toBeLessThan(next.core!.y);
    expect(next.aws!.x).toBeLessThan(next.banking!.x);
    expect(next.aws!.x + next.aws!.w!).toBeGreaterThan(next.banking!.x + 220);
    expect(arrangeViewOp(model, 'nada')).toBeNull();
  });

  it('freePositions ubica a la derecha de lo que hay, o en grilla si el lienzo está vacío', () => {
    const model = sampleModel();
    const pos = freePositions(model, 'banking-containers', ['a', 'b']);
    expect(pos.a!.x).toBeGreaterThan(640 + 220);
    expect(pos.b!.y).toBeGreaterThan(pos.a!.y);
    const empty = applyOp(model, { type: 'view.add', view: { id: 'vacio', name: 'Vacío', level: 1, nodes: {} } }).model;
    expect(freePositions(empty, 'vacio', ['a', 'b'])).toEqual({ a: { x: 0, y: 0 }, b: { x: 320, y: 0 } });
  });

  it('viewEdges: directas, implícitas agrupadas y ocultas', () => {
    const model = sampleModel();
    const landscape = viewEdges(model, model.views.landscape!);
    expect(landscape.map((e) => `${e.from}>${e.to}:${e.implied}`)).toEqual(['banking>core:true', 'customer>banking:true']);
    const hidden = applyOp(model, { type: 'view.edge', view: 'banking-containers', relation: 'web--api', style: { hidden: true } }).model;
    expect(viewEdges(hidden, hidden.views['banking-containers']!).some((e) => e.relations[0]!.id === 'web--api')).toBe(false);
  });
});
