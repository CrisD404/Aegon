import { describe, expect, it } from 'vitest';
import { applyOp, type Op } from '../ops/index.ts';
import type { Model } from '../model/index.ts';
import { placementProblem, validateModel } from '../rules/index.ts';
import { sampleModel } from '../test-fixtures.ts';
import { isExpandedInView, visualParentOf } from './index.ts';
import {
  collapseInViewOp,
  depthOf,
  depthsOf,
  expandInViewOp,
  fitExpandedOp,
  setDepthOp,
  unplaceWithNested,
} from './expand.ts';

const run = (model: Model, op: Op | null): Model => {
  expect(op).not.toBeNull();
  return applyOp(model, op!).model;
};

const rect = (model: Model, view: string, id: string) => {
  const l = model.views[view]!.nodes[id]!;
  return { x: l.x, y: l.y, w: l.w, h: l.h };
};

describe('abrir en el lugar', () => {
  it('convierte el sistema en un marco con sus hijos adentro', () => {
    const base = sampleModel();
    const model = run(base, expandInViewOp(base, 'landscape', 'banking'));
    const view = model.views.landscape!;
    expect(view.expanded).toEqual(['banking']);
    expect(isExpandedInView(view, 'banking')).toBe(true);
    // Entran los contenedores y la base, no los componentes ni lo de otros sistemas.
    expect(Object.keys(view.nodes).sort()).toEqual(['api', 'aws', 'banking', 'core', 'customer', 'db', 'web']);
    for (const id of ['web', 'api', 'db']) expect(visualParentOf(model, view, model.elements[id]!)).toBe('banking');
    // El marco conserva la esquina de la tarjeta y envuelve a sus hijos.
    const frame = rect(model, 'landscape', 'banking');
    expect(frame.x).toBe(0);
    expect(frame.y).toBe(0);
    for (const id of ['web', 'api', 'db']) {
      const l = view.nodes[id]!;
      expect(l.x).toBeGreaterThanOrEqual(frame.x + 40);
      expect(l.y).toBeGreaterThanOrEqual(frame.y + 64);
      expect(l.x + 220).toBeLessThanOrEqual(frame.x + frame.w! - 40);
      expect(l.y + 72).toBeLessThanOrEqual(frame.y + frame.h! - 40);
    }
  });

  it('usa la disposición del lienzo de detalle si existe', () => {
    const base = sampleModel();
    const view = run(base, expandInViewOp(base, 'landscape', 'banking')).views.landscape!;
    // En el L2: web (0,0), api (320,0), db (320,220).
    expect(view.nodes.api!.x - view.nodes.web!.x).toBe(320);
    expect(view.nodes.api!.y).toBe(view.nodes.web!.y);
    expect(view.nodes.db!.y - view.nodes.api!.y).toBe(220);
  });

  it('corre lo que estaba a la derecha y agranda el grupo que lo contiene', () => {
    const base = sampleModel();
    const model = run(base, expandInViewOp(base, 'landscape', 'banking'));
    const frame = rect(model, 'landscape', 'banking');
    const grown = frame.w! - 220;
    // Core estaba a la derecha (x=400), en la misma franja: se corre lo que creció el marco.
    expect(model.views.landscape!.nodes.core!.x).toBe(400 + grown);
    // El cliente estaba arriba: no se mueve.
    expect(model.views.landscape!.nodes.customer).toEqual({ x: 0, y: -200 });
    // El grupo AWS sigue conteniendo al sistema.
    const aws = rect(model, 'landscape', 'aws');
    expect(aws.x! + aws.w!).toBeGreaterThanOrEqual(frame.x + frame.w! + 40);
    expect(aws.y! + aws.h!).toBeGreaterThanOrEqual(frame.y + frame.h! + 40);
  });

  it('cerrar deja el lienzo como estaba y recuerda la disposición', () => {
    const base = sampleModel();
    const open = run(base, expandInViewOp(base, 'landscape', 'banking'));
    // El usuario mueve un hijo antes de cerrar.
    const moved = run(open, { type: 'view.place', view: 'landscape', nodes: { web: { x: open.views.landscape!.nodes.web!.x + 16, y: open.views.landscape!.nodes.web!.y } } });
    const closed = run(moved, collapseInViewOp(moved, 'landscape', 'banking'));
    const view = closed.views.landscape!;
    expect(view.expanded).toBeUndefined();
    expect(view.nodes).toEqual(base.views.landscape!.nodes);
    expect(Object.keys(view.folded!.banking!).sort()).toEqual(['api', 'db', 'web']);

    const again = run(closed, expandInViewOp(closed, 'landscape', 'banking')).views.landscape!;
    expect(again.folded).toBeUndefined();
    expect(again.nodes.api!.x - again.nodes.web!.x).toBe(320 - 16);
  });

  it('se deshace en un paso', () => {
    const base = sampleModel();
    const result = applyOp(base, expandInViewOp(base, 'landscape', 'banking')!);
    expect(applyOp(result.model, result.inverse).model.views).toEqual(base.views);
  });

  it('anida: un contenedor abierto dentro de un sistema abierto', () => {
    const base = sampleModel();
    const l2 = run(base, expandInViewOp(base, 'landscape', 'banking'));
    const l3 = run(l2, expandInViewOp(l2, 'landscape', 'api'));
    const view = l3.views.landscape!;
    expect(visualParentOf(l3, view, l3.elements.accounts!)).toBe('api');
    expect(visualParentOf(l3, view, l3.elements.api!)).toBe('banking');
    // El marco del sistema creció para contener al del contenedor.
    const sys = rect(l3, 'landscape', 'banking');
    const api = rect(l3, 'landscape', 'api');
    expect(api.x + api.w!).toBeLessThanOrEqual(sys.x + sys.w! - 40);
    expect(api.y + api.h!).toBeLessThanOrEqual(sys.y + sys.h! - 40);

    // Cerrar el sistema guarda todo; al reabrir, el contenedor vuelve abierto.
    const closed = run(l3, collapseInViewOp(l3, 'landscape', 'banking'));
    expect(Object.keys(closed.views.landscape!.nodes).sort()).toEqual(['aws', 'banking', 'core', 'customer']);
    const reopened = run(closed, expandInViewOp(closed, 'landscape', 'banking')).views.landscape!;
    expect(reopened.nodes.accounts).toBeDefined();
    expect(isExpandedInView(reopened, 'api')).toBe(true);
  });

  it('no abre actores, bases ni nada en un lienzo de despliegue', () => {
    const base = sampleModel();
    expect(expandInViewOp(base, 'landscape', 'customer')).toBeNull();
    expect(expandInViewOp(base, 'banking-containers', 'db')).toBeNull();
    expect(collapseInViewOp(base, 'landscape', 'banking')).toBeNull();
  });
});

describe('profundidad', () => {
  it('lleva el lienzo a contenedores, componentes y de vuelta a contexto', () => {
    const base = sampleModel();
    expect(depthsOf(base.views.landscape!)).toEqual([1, 2, 3]);
    expect(depthsOf(base.views['banking-containers']!)).toEqual([2, 3]);
    expect(depthOf(base, base.views.landscape!)).toBe(1);

    const two = run(base, setDepthOp(base, 'landscape', 2));
    expect(depthOf(two, two.views.landscape!)).toBe(2);
    expect(two.views.landscape!.expanded!.sort()).toEqual(['banking', 'core']);

    const three = run(two, setDepthOp(two, 'landscape', 3));
    expect(depthOf(three, three.views.landscape!)).toBe(3);
    expect(three.views.landscape!.nodes.accounts).toBeDefined();

    const one = run(three, setDepthOp(three, 'landscape', 1));
    expect(depthOf(one, one.views.landscape!)).toBe(1);
    expect(one.views.landscape!.nodes).toEqual(base.views.landscape!.nodes);
    expect(setDepthOp(one, 'landscape', 1)).toBeNull();
  });

  it('en un lienzo de contenedores solo abre los contenedores', () => {
    const base = sampleModel();
    const three = run(base, setDepthOp(base, 'banking-containers', 3));
    expect(three.views['banking-containers']!.expanded).toEqual(['api']);
    expect(isExpandedInView(three.views['banking-containers']!, 'core')).toBe(false);
  });
});

describe('ajuste y limpieza', () => {
  it('el marco sigue a un hijo que se movió afuera', () => {
    const base = sampleModel();
    const open = run(base, expandInViewOp(base, 'landscape', 'banking'));
    const frame = rect(open, 'landscape', 'banking');
    const far = { x: frame.x + frame.w! + 200, y: open.views.landscape!.nodes.db!.y };
    const moved = run(open, { type: 'view.place', view: 'landscape', nodes: { db: far } });
    const fitted = run(moved, fitExpandedOp(moved, 'landscape'));
    const next = rect(fitted, 'landscape', 'banking');
    expect(next.x + next.w!).toBe(far.x + 220 + 40);
    expect(fitExpandedOp(fitted, 'landscape')).toBeNull();
  });

  it('quitar del lienzo un elemento abierto se lleva lo que contiene', () => {
    const base = sampleModel();
    const open = run(base, expandInViewOp(base, 'landscape', 'banking'));
    const out = unplaceWithNested(open, 'landscape', ['banking'])!;
    expect(out.ids.sort()).toEqual(['api', 'banking', 'db', 'web']);
    expect(out.expanded).toBeNull();
  });

  it('borrar un elemento limpia lo que los lienzos recordaban de él', () => {
    const base = sampleModel();
    const open = run(base, expandInViewOp(base, 'landscape', 'banking'));
    const closed = run(open, collapseInViewOp(open, 'landscape', 'banking'));
    const withoutDb = run(closed, { type: 'element.remove', id: 'db' });
    expect(Object.keys(withoutDb.views.landscape!.folded!.banking!).sort()).toEqual(['api', 'web']);
    const result = applyOp(open, { type: 'element.remove', id: 'banking' });
    expect(result.model.views.landscape!.expanded).toBeUndefined();
    expect(applyOp(result.model, result.inverse).model.views.landscape).toEqual(open.views.landscape);
  });
});

describe('reglas como avisos', () => {
  it('un lienzo de contexto acepta contenedores y componentes', () => {
    const model = sampleModel();
    const view = model.views.landscape!;
    expect(placementProblem(model, view, model.elements.api!)).toBeNull();
    expect(placementProblem(model, view, model.elements.accounts!)).toBeNull();
  });

  it('C4 estricto avisa la mezcla de niveles sin impedirla', () => {
    const base = sampleModel();
    const open = run(base, expandInViewOp(base, 'landscape', 'banking'));
    expect(validateModel(open).filter((d) => d.code === 'level-mix')).toEqual([]);
    const strict = run(open, { type: 'workspace.update', patch: { strictC4: true } });
    const mixes = validateModel(strict).filter((d) => d.code === 'level-mix');
    expect(mixes.length).toBe(2);
    expect(mixes.every((d) => d.severity === 'warning')).toBe(true);
  });
});
